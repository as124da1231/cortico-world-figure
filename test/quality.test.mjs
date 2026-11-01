import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PackImporter, filesFromZip, filesFromBundle } from '../src/import.ts';
import { editPack, installPack } from '../src/pipeline.ts';
import { coreState } from '../src/core.ts';
import { captureCover } from '../src/cover.ts';
import { LIVE2D } from '../src/index.ts';
import { makeCtx } from './_ctx.mjs';

const bytes = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'figure-quality-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function pack(root, id = 'sample') {
  await mkdir(join(root, 'models', 'sample'), { recursive: true });
  await writeFile(join(root, 'figure.json'), JSON.stringify({ id, name: { zh: '名字' }, about: { zh: '旧简介' } }));
  await writeFile(join(root, 'models', 'sample', 'profile.js'), 'export default {"bodyGain": 1.8, "style": "natural"};');
  return root;
}
const file = (path, data) => ({ path, bytes: bytes(data) });

test('zip/bundle parsing rejects malformed data and traversal without touching neighboring files', async (t) => {
  const root = await fixture(t);
  const marker = join(root, 'keep.txt'); await writeFile(marker, 'safe');
  assert.match(filesFromZip(bytes('not a zip')), /解压失败/);
  assert.equal(typeof filesFromBundle(new Uint8Array([1, 2, 3])), 'string');
  const importer = new PackImporter(); t.after(() => importer.cancel());
  for (const path of ['../keep.txt', 'C:/keep.txt', 'a/../../keep.txt', 'NUL.txt', 'a./x', 'a /x', 'a:x']) {
    const result = await importer.stage([file(path, 'overwrite')], false, new Map());
    assert.match(result.error, /路径不合法/);
  }
  assert.equal(await readFile(marker, 'utf8'), 'safe');
});

test('import rejects dangerous ids and thumbnails outside the pack, and rejects unlisted directories', async (t) => {
  const importer = new PackImporter(); t.after(() => importer.cancel());
  for (const id of ['../escape', 'a/b', 'CON', '.', 'a:', '-']) {
    const result = await importer.stage([file('figure.json', { id })], false, new Map());
    assert.equal(result.packs.length, 0);
    assert.ok(result.problems.length);
  }
  const staged = await importer.stage([file('a/figure.json', { id: 'safe', thumb: '../secret.png' }), file('secret.png', 'private')], false, new Map());
  assert.equal(staged.packs[0].thumb, null);
  const result = await importer.install(staged.token, ['../escape'], [], { figuresDir: await fixture(t) });
  assert.match(result.error, /待装清单/);
});

test('folder upload survives multiple chunks, conflicts require replacement, and cancellation invalidates token', async (t) => {
  const root = await fixture(t);
  const importer = new PackImporter(); t.after(() => importer.cancel());
  const token = await importer.beginUpload();
  await importer.appendUpload(token, [file('a/figure.json', { id: 'sample', version: '1.0.0' })]);
  await importer.appendUpload(token, [file('a/data.txt', 'new')]);
  const staged = await importer.finishUpload(token, true, new Map());
  assert.equal(staged.token, token);
  const figuresDir = join(root, 'figures'); const backupRoot = join(root, 'backups');
  await pack(join(figuresDir, 'sample')); await writeFile(join(figuresDir, 'sample', 'old.txt'), 'old');
  assert.deepEqual(await importer.install(token, ['a'], [], { figuresDir }), { conflicts: ['sample'] });
  const result = await importer.install(token, ['a'], ['sample'], { figuresDir, backupRoot });
  assert.equal(result.installed.length, 1);
  assert.equal(await readFile(join(figuresDir, 'sample', 'data.txt'), 'utf8'), 'new');
  const backups = await readdir(backupRoot);
  assert.equal(await readFile(join(backupRoot, backups[0], 'old.txt'), 'utf8'), 'old');
  assert.equal(importer.resolve(token, 'a'), null);
});

test('install failure preserves existing figure; source/target overlap is rejected', async (t) => {
  const root = await fixture(t);
  const source = await pack(join(root, 'source'));
  const figures = join(root, 'figures'); const target = await pack(join(figures, 'sample'));
  await writeFile(join(target, 'keep.txt'), 'original');
  const blocked = join(root, 'not-a-directory'); await writeFile(blocked, 'block');
  await assert.rejects(installPack(source, figures, { backupRoot: blocked }));
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'original');
  assert.deepEqual((await readdir(figures)).sort(), ['sample']);
  await assert.rejects(installPack(target, figures), /重叠/);
  await writeFile(join(source, 'figure.json'), '{"id":"../outside"}');
  await assert.rejects(installPack(source, figures), /id/);
});

test('edit clears about and rejects invalid tuning before writing any files', async (t) => {
  const root = await pack(await fixture(t));
  await editPack(root, { aboutZh: '', bodyGain: 2.4, style: 'calm' });
  assert.equal(JSON.parse(await readFile(join(root, 'figure.json'), 'utf8')).about.zh, '');
  const profile = await import(`${pathToFileURL(join(root, 'models/sample/profile.js')).href}?edited`);
  assert.equal(profile.default.bodyGain, 2.4);
  assert.equal(profile.default.style, 'calm');
  const before = await readFile(join(root, 'figure.json'), 'utf8');
  await assert.rejects(editPack(root, { nameZh: 'changed', style: '";broken' }));
  assert.equal(await readFile(join(root, 'figure.json'), 'utf8'), before);
  await rm(join(root, 'models'), { recursive: true });
  await assert.rejects(editPack(root, { nameZh: 'changed', bodyGain: 1.2 }));
  assert.equal(await readFile(join(root, 'figure.json'), 'utf8'), before);
});

test('notice acknowledgement does not survive a failed state write', async (t) => {
  const root = await fixture(t);
  const world = LIVE2D.create(makeCtx(root, { enabled: true })); await world.start({});
  await mkdir(join(root, 'figure', 'state.json'), { recursive: true });
  const inv = (m, a = []) => world.webUi().invoke('workbench', m, a);
  await assert.rejects(inv('noticeAccept', [1]));
  assert.equal((await inv('state')).notice.acknowledged, false);
  await world.stop();
});

test('shutdown waits for pending persistence and rejects subsequent writes', async (t) => {
  const root = await fixture(t);
  const world = LIVE2D.create(makeCtx(root, { enabled: true })); await world.start({});
  const invoke = world.webUi().invoke;
  const saving = invoke('workbench', 'noticeAccept', [1]);
  await world.stop(); await saving;
  const saved = JSON.parse(await readFile(join(root, 'figure', 'state.json'), 'utf8'));
  assert.equal(saved.distributionNotice.revision, 1);
  await assert.rejects(invoke('workbench', 'clearAll', []), /停止/);
});

test('world persists notice across restarts, rejects stale ids, installs independently of original model', async (t) => {
  const root = await fixture(t);
  const built = await pack(join(root, 'figure', 'builds', 'sample'));
  await writeFile(join(root, 'figure', 'state.json'), JSON.stringify({ modelDir: 'Z:/missing-model', builds: [{ id: 'sample-record', packDir: built, at: 1, bytes: 100 }], build: { packDir: built } }));
  const cfg = { enabled: true, figuresDir: join(root, 'figures') };
  let world = LIVE2D.create(makeCtx(root, cfg)); await world.start({});
  const inv = (m, a = []) => world.webUi('zh').invoke('workbench', m, a);
  await assert.rejects(inv('install', ['', 'sample-record']), /须知/);
  await assert.rejects(inv('noticeAccept', [0]), /更新/);
  const first = await inv('state');
  await inv('noticeAccept', [first.notice.revision]);
  await world.stop(); world = LIVE2D.create(makeCtx(root, cfg)); await world.start({});
  assert.equal((await inv('state')).notice.acknowledged, true);
  await assert.rejects(inv('detail', ['missing']), /没有/);
  await assert.rejects(inv('edit', ['missing', { nameZh: 'oops' }]), /没有/);
  const installed = await inv('install', ['', 'sample-record']);
  assert.equal(installed.state.install.target, join(root, 'figures', 'sample'));
  await world.stop();
});

test('world locks mutations before awaits and releases lock after errors', async (t) => {
  const root = await fixture(t); const world = LIVE2D.create(makeCtx(root, { enabled: true }));
  await world.start({}); const inv = (m, a = []) => world.webUi().invoke('workbench', m, a);
  const writing = inv('noticeAccept', [1]);
  await assert.rejects(inv('clearAll'), /上一个动作/); await writing;
  await assert.rejects(inv('scan', [root]), /moc3|model3/);
  assert.equal((await inv('noticeAccept', [1])).acknowledged, true);
  await world.stop();
});

test('core cache rejects corruption; cover handles browser spawn error without crashing', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'live2dcubismcore.min.js'), 'corrupt');
  assert.equal((await coreState(root)).ok, false);
  const previous = process.env.CHROME_PATH;
  process.env.CHROME_PATH = join(root, 'fake.exe'); await writeFile(process.env.CHROME_PATH, 'invalid');
  try {
    const result = await captureCover(root, root, 500);
    assert.equal(result.ok, false); assert.match(result.error, /启动|超时/);
  } finally { if (previous === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = previous; }
});

test('real model: scan, Core verification, packing, cover and installation', { skip: !process.env.L2D_MODEL || !process.env.L2D_CORE }, async (t) => {
  const root = await fixture(t);
  const cfg = { enabled: true, figuresDir: join(root, 'figures'), workDir: join(root, 'figure'), cover: true };
  await mkdir(join(cfg.workDir, 'sdk'), { recursive: true });
  await cp(process.env.L2D_CORE, join(cfg.workDir, 'sdk', 'live2dcubismcore.min.js'));
  const world = LIVE2D.create(makeCtx(root, cfg)); await world.start({}); t.after(() => world.stop());
  const inv = (m, a = []) => world.webUi().invoke('workbench', m, a);
  assert.equal((await inv('core')).ok, true);
  await inv('noticeAccept', [1]);
  const scanned = await inv('scan', [process.env.L2D_MODEL]); assert.ok(scanned.state.scan.id);
  const built = await inv('build', [process.env.L2D_MODEL]); assert.ok(built.state.build.bytes > 0);
  assert.equal(built.state.build.cover, true);
  const list = await inv('list'); assert.equal(list.builds.length, 1);
  const installed = await inv('install', ['', list.builds[0].id]);
  const licenses = await readFile(join(installed.state.install.target, 'LICENSES.txt'), 'utf8');
  assert.match(licenses, /请勿上传、分享或再次分发/);
  await inv('edit', [list.builds[0].id, { aboutZh: '', style: 'shy' }]);
  await inv('install', ['', list.builds[0].id]);
  assert.equal((await readdir(join(root, 'figure-backups'))).length, 1);
});
