import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { serveBrowserEditor } from '../src/browser-editor.ts';

test('a browser editor can save its own draft, while its isolated preview and other origins cannot', async t => {
  const pack = await mkdtemp(join(tmpdir(), 'figure-browser-test-'));
  t.after(() => rm(pack, { recursive: true, force: true }));
  await mkdir(join(pack, 'models'));
  await writeFile(join(pack, 'models', 'profile.js'), 'export default {}');
  await writeFile(join(pack, 'native-library.json'), '{}');
  const data = { token: randomUUID(), title: 'Figure' };
  const saves = [];
  let staged, complete;
  const editor = await serveBrowserEditor({
    data, pack, language: 'en',
    theme: { mode:'dark', colors:{accent:'#aabbee', sheet:'url(https://example.com)', extra:'#fff000'} },
    workbench: fileURLToPath(new URL('../workbench/', import.meta.url)),
    setDraft(value) { staged = value; },
    keepAlive() {},
    async save(bindings, wardrobe) {
      saves.push({ bindings, wardrobe });
      return new Promise(resolve => { complete = () => resolve({ buildId: 'figure' }); });
    },
    async skipImages() { return { ok: true }; },
    async close() {},
  });
  t.after(() => { complete?.(); return editor.stop(); });
  const base = new URL(editor.url);
  const get = path => fetch(new URL(path, base));
  const send = (path, origin, data, owner) => fetch(new URL(path, base), {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...(owner ? { authorization: `Bearer ${owner}` } : {}) }, body: JSON.stringify(data),
  });
  const claim = async (resume) => send('claim', base.origin, { resume });
  const stream = async owner => {
    const controller = new AbortController();
    const response = await fetch(new URL('events', base), {
      headers: { authorization: `Bearer ${owner}` }, signal: controller.signal,
    });
    assert.equal(response.status, 200);
    void response.body.pipeTo(new WritableStream()).catch(() => {});
    return controller;
  };
  const first = await (await claim()).json();
  assert.deepEqual(first.data, {...data, theme:{mode:'dark', colors:{accent:'#aabbee'}}});
  assert.equal((await claim(first.resume)).status, 409);
  const connection = await stream(first.owner);
  assert.equal((await claim()).status, 409);
  assert.equal((await claim(first.resume)).status, 409);
  assert.equal((await get('events')).status, 410);
  assert.equal((await send('close', base.origin, {}, randomUUID())).status, 410);
  assert.equal((await get('/different/session')).status, 404);
  const scene = await get('scene/');
  assert.match(scene.headers.get('content-security-policy'), /^sandbox allow-scripts;/);
  const model = await get('scene/pack/models/profile.js');
  assert.equal(model.headers.get('access-control-allow-origin'), 'null');
  assert.equal(await model.text(), 'export default {}');
  assert.equal((await get('scene/pack/models/..%2fnative-library.json')).status, 404);
  const draft = { bindings: [{ word: 'happy', resource: 'smile', overlays: ['blush'] }], wardrobe: [] };
  assert.equal((await send('save', 'null', draft)).status, 403);
  assert.equal((await send('save', 'https://example.invalid', draft)).status, 403);
  assert.equal((await send('draft', base.origin, { revision: 2, draft }, first.owner)).status, 200);
  assert.equal((await send('draft', base.origin, { revision: 1, draft: null }, first.owner)).status, 200);
  assert.deepEqual(staged, draft);
  connection.abort();
  let resumed;
  for (let attempt = 0; attempt < 10 && !resumed; attempt++) {
    const response = await claim(first.resume);
    if (response.ok) resumed = await response.json();
    else await delay(25);
  }
  assert.notEqual(resumed?.owner, first.owner);
  assert.deepEqual(resumed?.data.draft, draft);
  const continued = await stream(resumed.owner);
  assert.equal((await send('close', base.origin, {}, first.owner)).status, 410);
  assert.equal((await send('detach', base.origin, {}, first.owner)).status, 410);
  assert.equal(saves.length, 0);
  const body = { ...draft, id: randomUUID() };
  const pending = send('save', base.origin, body, resumed.owner);
  for (let attempt = 0; attempt < 10 && !editor.isSaving(); attempt++) await delay(25);
  assert(editor.isSaving());
  assert.equal((await send('close', base.origin, {}, resumed.owner)).status, 409);
  const retry = send('save', base.origin, body, resumed.owner);
  assert.equal((await send('save', base.origin, { ...body, bindings: [] }, resumed.owner)).status, 409);
  complete();
  assert.deepEqual(await (await pending).json(), { buildId: 'figure' });
  assert.deepEqual(await (await retry).json(), { buildId: 'figure' });
  assert.equal((await send('save', base.origin, { ...body, id: randomUUID() }, resumed.owner)).status, 409);
  assert.deepEqual(saves, [draft]);
  assert.equal(staged, undefined);
  continued.abort();
  await editor.stop();
  await assert.rejects(get('events'));
});

test('an idle connected page retains the session; a dropped connection releases it and retains its staged draft', async t => {
  const token = randomUUID();
  let staged, stopped = false;
  const editor = await serveBrowserEditor({
    data: { token }, pack: '.', language: 'zh', workbench: fileURLToPath(new URL('../workbench/', import.meta.url)),
    keepAlive() {}, setDraft(value) { staged = value; },
    async save() {}, async skipImages() {}, async close() { stopped = true; },
  });
  t.after(() => editor.stop());
  const base = new URL(editor.url);
  const post = (path, data, owner) => fetch(new URL(path, base), {
    method: 'POST', headers: { origin: base.origin, 'content-type': 'application/json', ...(owner ? { authorization: `Bearer ${owner}` } : {}) },
    body: JSON.stringify(data),
  });
  const owner = await (await post('claim', {})).json();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = await fetch(new URL('events', base), { headers: { authorization: `Bearer ${owner.owner}` }, signal: controller.signal });
  assert.equal(events.status, 200);
  void events.body.pipeTo(new WritableStream()).catch(() => {});
  const draft = { bindings: [{ word: 'happy', resource: 'smile' }], wardrobe: [] };
  await post('draft', { revision: 1, draft }, owner.owner);
  await delay(12100);
  assert.equal((await post('claim', {})).status, 409);
  assert(!stopped);
  controller.abort();
  for (let attempt = 0; attempt < 52 && !stopped; attempt++) await delay(250);
  assert(stopped);
  assert.deepEqual(staged, draft);
});
