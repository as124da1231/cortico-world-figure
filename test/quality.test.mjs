import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PackImporter, filesFromZip, filesFromBundle } from '../src/import.ts';
import { editPack, installPack, scanModel } from '../src/pipeline.ts';
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

test('workbench settings expose only declared editable values and the notice has no separate tab', async t => {
  const root = await fixture(t);
  const cfg = { enabled: true, modelDir: 'private-source', workDir: root, cover: false, autoDelete: true };
  const world = LIVE2D.create(makeCtx(root, cfg)); await world.start({});
  t.after(() => world.stop());
  const page = world.webUi('zh');
  assert.deepEqual(page.panels.map(p => p.id), ['workbench']);
  assert.deepEqual(await page.invoke('workbench', 'settings', []), { cover:false,texture:'original',quality:'balanced',clean:false,autoDelete:true,figuresDir:'',adaptationMode:'none',assistMotions:false,assistGear:'auto',assistDepth:'standard',assistAuto:false,modelRoots:'' });
  cfg.clean=true; cfg.texture='1024';
  const next=await page.invoke('workbench', 'settings', []);
  assert.equal(next.clean,true); assert.equal(next.texture,'1024');
  assert.equal('modelDir' in next,false); assert.equal('workDir' in next,false);
});

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

test('refreshing a list with missing drafts cannot discard a concurrently completed build', async (t) => {
  const root = await fixture(t);
  const oldPack = await pack(join(root, 'old'));
  const newPack = await pack(join(root, 'new'), 'new');
  const world = LIVE2D.create(makeCtx(root, { enabled: true })); await world.start({}); t.after(() => world.stop());
  world.state.builds = [{id:'missing',packDir:join(root,'missing')},{id:'old',packDir:oldPack}];
  const invoke = (method) => world.webUi().invoke('workbench',method,[]);
  const listing = invoke('list');
  world.state.builds = [{id:'new',packDir:newPack},...world.state.builds];
  await listing;
  assert.deepEqual((await invoke('state')).builds.map(b=>b.id),['new','old']);
  const saved = JSON.parse(await readFile(join(root,'figure','state.json'),'utf8'));
  assert.deepEqual(saved.builds.map(b=>b.id),['new','old']);
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

test('package links are rejected before installation or profile editing touches another directory',async t=>{
  const root=await fixture(t),outside=join(root,'outside'),source=await pack(join(root,'source'));
  await mkdir(outside);await writeFile(join(outside,'profile.js'),'export default {"bodyGain": 1.8, "style": "natural"};');
  await symlink(outside,join(source,'models','linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(installPack(source,join(root,'figures')),/链接/);
  await assert.rejects(editPack(source,{bodyGain:2}),/链接/);
  assert.match(await readFile(join(outside,'profile.js'),'utf8'),/1\.8/);
});

test('conversion rejects a corrupt moc3 and missing required textures instead of creating an unusable pack',async t=>{
  const root=await fixture(t),workbench=join(import.meta.dirname,'..','workbench');
  await writeFile(join(root,'role.model3.json'),JSON.stringify({FileReferences:{Moc:'role.moc3',Textures:['missing.png']}}));
  await writeFile(join(root,'role.moc3'),'corrupt');
  await assert.rejects(scanModel(workbench,root),/moc3.*无效|不完整/);
  const header=Buffer.alloc(64);header.write('MOC3');await writeFile(join(root,'role.moc3'),header);
  await assert.rejects(scanModel(workbench,root),/缺少贴图/);
});

test('a completed installation stays successful if writing its history fails',async t=>{
  const root=await fixture(t),source=await pack(join(root,'draft'));
  const stateDir=join(root,'figure');await mkdir(stateDir);
  const stateFile=join(stateDir,'state.json');
  await writeFile(stateFile,JSON.stringify({modelDir:'',builds:[{id:'draft',packDir:source,bytes:1,at:1}]}));
  const world=LIVE2D.create(makeCtx(root,{enabled:true,figuresDir:join(root,'figures')}));await world.start({});t.after(()=>world.stop());
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  await invoke('noticeAccept',[1]);await rm(stateFile);await mkdir(stateFile);
  const result=await invoke('install',['','draft']);
  assert.match(result.warn,/已安装.*记录保存失败/);
  assert.equal(JSON.parse(await readFile(join(root,'figures','sample','figure.json'),'utf8')).id,'sample');
});

test('a failed Core script load can be retried in the same figure frame',async t=>{
  const root=await fixture(t);await mkdir(join(root,'models'));await mkdir(join(root,'backends'));
  await cp(new URL('../workbench/pack/figure.js',import.meta.url),join(root,'figure.mjs'));
  await writeFile(join(root,'package.json'),'{"type":"module"}');
  await writeFile(join(root,'models','index.js'),'export const models={sample:{id:"sample"}};');
  await writeFile(join(root,'backends','live2d.js'),'export async function createLive2DBody(){return {ok:true};}');
  const beforeDocument=globalThis.document,beforeCore=globalThis.Live2DCubismCore;
  let attempts=0;
  globalThis.Live2DCubismCore=undefined;
  globalThis.document={createElement:()=>({remove(){}}),head:{appendChild:script=>queueMicrotask(()=>{
    if(++attempts===1)script.onerror();else{globalThis.Live2DCubismCore={};script.onload();}
  })}};
  t.after(()=>{globalThis.document=beforeDocument;globalThis.Live2DCubismCore=beforeCore;});
  const loader=await import(pathToFileURL(join(root,'figure.mjs')));
  await assert.rejects(loader.createFigureBody(new URL('http://localhost/pack/'),{kit:{}}),/加载失败/);
  assert.equal((await loader.createFigureBody(new URL('http://localhost/pack/'),{kit:{}})).ok,true);
  assert.equal(attempts,2);
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
