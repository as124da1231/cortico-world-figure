import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {clipboardPaths} from '../src/clipboard.ts';
import {PackImporter} from '../src/import.ts';
import {installPack} from '../src/pipeline.ts';
import {FIGURE_IMPORT} from '../src/import-limits.mjs';
import {LIVE2D} from '../src/index.ts';
import {makeCtx,prepareWorld,fixtureManifest} from './_ctx.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'figure-local-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function sourcePack(root){await mkdir(root,{recursive:true});await writeFile(join(root,'figure.json'),JSON.stringify(fixtureManifest({about:{zh:'原简介'}})));await writeFile(join(root,'figure.js'),'export function createFigureBody(){}');await writeFile(join(root,'keep.txt'),'original');return root;}

test('clipboard parsing accepts only local absolute paths and ignores unrelated text',()=>{
  assert.deepEqual(clipboardPaths('"G:\\模型\\夜兰"\r\nG:\\模型\\夜兰\r\nfile:///C:/models/role%20one\r\nhttps://example.com\r\nnot a path'),['G:\\模型\\夜兰','C:\\models\\role one']);
  assert.deepEqual(clipboardPaths('file://external-host/private/file\nnot-a-local-path'),[]);
});

test('local entry-file imports whitelist candidate paths and cancellation preserves all original files',async t=>{
  const root=await fixture(t), source=await sourcePack(join(root,'source'));
  const importer=new PackImporter();t.after(()=>importer.cancel());
  const result=await importer.stageLocal([join(source,'figure.json')],new Map());
  assert.equal(result.packs.length,1);
  assert.equal(importer.resolvePack(result.token,result.packs[0].dir),source);
  assert.equal(importer.resolve(result.token,'source-0/../outside'),null);
  assert.equal(importer.resolve(result.token,''),null);
  assert.equal(importer.resolvePack('expired',result.packs[0].dir),null);
  await importer.cancel();
  assert.equal(await readFile(join(source,'keep.txt'),'utf8'),'original');
  assert.equal(JSON.parse(await readFile(join(source,'figure.json'),'utf8')).id,'sample');
});

test('an incomplete packaged runtime falls back only to a validated raw model', async t => {
  const root = await fixture(t);
  const source = await sourcePack(join(root, 'source'));
  const importer = new PackImporter();
  t.after(() => importer.cancel());
  await writeFile(join(source, 'figure.js'), [
    'export async function createFigureBody(base) {',
    "  loadScript(new URL('sdk/live2dcubismcore.min.js', base));",
    "  await import('./backends/live2d.js');",
    '}',
  ].join('\n'));
  const broken = await importer.stageLocal([source], new Map());
  assert.equal(broken.token, '');
  assert.match(broken.problems[0].reason, /live2dcubismcore\.min\.js.*backends\/live2d\.js/);
  const raw = join(source, 'models', 'role');
  await mkdir(raw, {recursive:true});
  const moc = Buffer.alloc(64);
  moc.write('MOC3');
  await writeFile(join(raw, 'role.moc3'), moc);
  await writeFile(join(raw, 'role.model3.json'), JSON.stringify({FileReferences:{Moc:'role.moc3',Textures:['texture.png']}}));
  const incomplete = await importer.stageLocal([source], new Map());
  assert.equal(incomplete.models.length, 0);
  assert.match(incomplete.problems[0].reason, /缺少贴图/);
  await writeFile(join(raw, 'texture.png'), 'texture data');
  const recovered = await importer.stageLocal([join(source, 'figure.json')], new Map());
  assert.equal(recovered.packs.length, 0);
  assert.equal(recovered.models[0].file, 'role.model3.json');
  assert.match(recovered.problems[0].reason, /已识别原始模型/);
  assert.equal(importer.resolve(recovered.token, recovered.models[0].dir), raw);
});

test('installation checks transitive imports before replacing a working pack', async t => {
  const root = await fixture(t);
  const source = await sourcePack(join(root, 'source'));
  await writeFile(join(source, 'figure.js'), [
    "import './body.js';",
    'export async function createFigureBody(base, opts) {',
    "  if (opts.optional) await import('./optional.js');",
    '}',
  ].join('\n'));
  await writeFile(join(source, 'body.js'), 'export const body = true;');
  const figures = join(root, 'figures');
  const target = await installPack(source, figures);
  await writeFile(join(source, 'body.js'), "export { body } from './missing.js';");
  await assert.rejects(installPack(source, figures), /运行文件.*missing\.js/);
  assert.equal(await readFile(join(target, 'body.js'), 'utf8'), 'export const body = true;');
});

test('an explicitly selected model entry survives panel import, packing and AI discovery',async t=>{
  const root=await fixture(t),source=join(root,'variants');await mkdir(source);
  for(const name of ['A','B'])await writeFile(join(source,name+'.model3.json'),JSON.stringify({FileReferences:{Moc:name+'.moc3'}}));
  const events=[],cfg={enabled:true,assistMotions:true,assistGear:'text'};
  const world=LIVE2D.create(makeCtx(root,cfg));await world.start({pushEvent:async e=>events.push(e)});t.after(()=>world.stop());
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  const staged=await invoke('importPaths',[[join(source,'B.model3.json')]]);
  assert.equal(staged.models.length,1);assert.equal(staged.models[0].title,'B');
  const model=(await world.tools().find(t=>t.name==='figure_actions').handler({model:events[0].meta.models[0]},{}));
  assert.equal(JSON.parse(model.text).model.file,'B.model3.json');assert.equal(events[0].meta.models.length,1);
  let built;world.doBuild=async(dir,options)=>{built={dir,options};return {};};
  await invoke('importBuild',[staged.token,staged.models[0].dir,false]);
  assert.equal(built.dir,source);assert.equal(built.options.modelFile,'B.model3.json');
});

test('packing retains a finished package as an editable draft; auto-delete runs only after a successful install',async t=>{
  const root=await fixture(t), source=await sourcePack(join(root,'source'));
  const world=LIVE2D.create(makeCtx(root,{enabled:true,autoDelete:true,figuresDir:join(root,'figures')}));
  await world.start({});t.after(()=>world.stop());
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  await invoke('noticeAccept',[1]);
  const staged=await invoke('importPaths',[[join(source,'figure.json')]]);
  const kept=await invoke('importKeep',[staged.token,staged.packs[0].dir]);
  const before=await invoke('list');assert.equal(before.builds.length,1);
  assert.equal(await stat(join(root,'figures')).catch(()=>null),null);
  await invoke('edit',[kept.buildId,{nameZh:'新名字',aboutZh:'更新简介'}]);
  const installed=await invoke('install',['',kept.buildId]);
  assert.equal(JSON.parse(await readFile(join(installed.state.install.target,'figure.json'),'utf8')).name.zh,'新名字');
  assert.equal((await invoke('list')).builds.length,0);
  assert.equal(await readFile(join(source,'keep.txt'),'utf8'),'original');
  assert.equal(JSON.parse(await readFile(join(source,'figure.json'),'utf8')).name.zh,'名字');
  await invoke('importCancel');assert.equal(await readFile(join(source,'keep.txt'),'utf8'),'original');
});

test('failed installation leaves the draft and original source intact even with auto-delete enabled',async t=>{
  const root=await fixture(t),source=await sourcePack(join(root,'source')),blocked=join(root,'blocked');
  await writeFile(blocked,'not a directory');
  const world=LIVE2D.create(makeCtx(root,{enabled:true,autoDelete:true,figuresDir:blocked}));
  await world.start({});t.after(()=>world.stop());
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  await invoke('noticeAccept',[1]);
  const staged=await invoke('importPaths',[[source]]);
  const kept=await invoke('importKeep',[staged.token,staged.packs[0].dir]);
  await assert.rejects(invoke('install',['',kept.buildId]));
  assert.equal((await invoke('list')).builds.length,1);
  assert.equal(await readFile(join(source,'keep.txt'),'utf8'),'original');
});

test('chunked files must be contiguous and complete before an import can be recognized',async t=>{
  const importer=new PackImporter();t.after(()=>importer.cancel());
  const token=await importer.beginUpload(),bytes=Buffer.from(JSON.stringify(fixtureManifest({id:'chunked'})));
  await importer.appendChunk(token,{path:'figure.json',bytes:bytes.subarray(0,5)},0,bytes.length);
  assert.match((await importer.finishUpload(token,false,new Map())).error,/完整/);
  await importer.appendChunk(token,{path:'figure.json',bytes:bytes.subarray(5)},5,bytes.length);
  await importer.appendUpload(token,[{path:'figure.js',bytes:Buffer.from('export function createFigureBody(){}')}]);
  const result=await importer.finishUpload(token,false,new Map());assert.equal(result.packs[0].id,'chunked');
});

test('panel upload rejects oversized requests and keeps a valid upload available for retry', async t => {
  const world = LIVE2D.create(makeCtx(await fixture(t), {enabled:true}));
  await world.start({});
  t.after(() => world.stop());
  const invoke = (method, args = []) => world.webUi().invoke('workbench', method, args);
  const {token} = await invoke('importBegin');
  const chunk = {path:'texture.bin', offset:0, total:FIGURE_IMPORT.chunk};
  await assert.rejects(invoke('importAppendChunk', [token, {
    ...chunk, b64:'A'.repeat(4 * Math.ceil(FIGURE_IMPORT.chunk / 3) + 4),
  }]), /分块过大/);
  const b64 = Buffer.alloc(FIGURE_IMPORT.file).toString('base64');
  await assert.rejects(invoke('importAppend', [token, [1, 2, 3].map(index => ({path:`file-${index}`, b64}))]), /批次过大/);
  await assert.rejects(invoke('importStage', ['A'.repeat(4 * Math.ceil(FIGURE_IMPORT.zip / 3) + 4), 'zip']), /ZIP 超过/);
  assert.equal((await invoke('importAppendChunk', [token, {...chunk, b64:Buffer.alloc(chunk.total).toString('base64')}])).written, chunk.total);
  await invoke('importAppend', [token, [
    {path:'figure.json', b64:Buffer.from(JSON.stringify(fixtureManifest())).toString('base64')},
    {path:'figure.js', b64:Buffer.from('export function createFigureBody(){}').toString('base64')},
  ]]);
  assert.equal((await invoke('importFinish', [token, true])).packs[0].id, 'sample');
});

test('a committed install or deletion is reported separately from a failed record write', async t => {
  const root = await fixture(t);
  const source = await sourcePack(join(root, 'source'));
  const world = LIVE2D.create(makeCtx(root, {enabled:true, figuresDir:join(root, 'figures')}));
  await world.start({});
  t.after(() => world.stop());
  const invoke = (method, args = []) => world.webUi().invoke('workbench', method, args);
  await invoke('noticeAccept', [1]);
  const staged = await invoke('importPaths', [[source]]);
  const {buildId} = await invoke('importKeep', [staged.token, staged.packs[0].dir]);
  const save = world.save.bind(world);
  world.save = async () => { throw Error('write failed'); };
  try {
    const installed = await invoke('install', ['', buildId]);
    assert.equal(installed.figureId, 'sample');
    assert.match(installed.warn, /安装记录保存失败/);
    assert.equal(await readFile(join(installed.state.install.target, 'keep.txt'), 'utf8'), 'original');
    const deleted = await invoke('remove', [buildId]);
    assert.match(deleted.warn, /删除记录保存失败/);
    assert.equal(deleted.builds.length, 0);
    assert.equal(await readFile(join(source, 'keep.txt'), 'utf8'), 'original');
  } finally { world.save = save; }
});

test('cancelling a folder scan retires its token before a new source is staged', async t => {
  const root = await fixture(t), source = await sourcePack(join(root, 'source'));
  const importer = new PackImporter();
  t.after(() => importer.cancel());
  const token = await importer.beginUpload();
  await importer.appendUpload(token, [
    { path: 'figure.json', bytes: Buffer.from(JSON.stringify(fixtureManifest({ id: 'cancelled' }))) },
    { path: 'figure.js', bytes: Buffer.from('export function createFigureBody(){}') },
  ]);
  const finishing = importer.finishUpload(token, true, new Map());
  await importer.cancel(token);
  const next = await importer.stageLocal([source], new Map());
  assert.match((await finishing).error, /过期|取消/);
  await importer.cancel(token);
  assert.equal(importer.resolvePack(token, ''), null);
  assert.equal(importer.resolvePack(next.token, next.packs[0].dir), source);
});

test('an earlier stage cannot overwrite the latest source when both are scanning', async t => {
  const root = await fixture(t), source = await sourcePack(join(root, 'source'));
  const importer = new PackImporter();
  t.after(() => importer.cancel());
  const earlier = importer.stage([
    { path: 'figure.json', bytes: Buffer.from(JSON.stringify(fixtureManifest({ id: 'earlier' }))) },
    { path: 'figure.js', bytes: Buffer.from('export function createFigureBody(){}') },
  ], false, new Map());
  const latest = await importer.stageLocal([source], new Map());
  assert.match((await earlier).error, /过期|取消/);
  assert.equal(importer.resolvePack(latest.token, latest.packs[0].dir), source);
});

test('out-of-order file chunks are rejected and an old cancellation cannot remove a new source',async t=>{
  const root=await fixture(t),source=await sourcePack(join(root,'source')),importer=new PackImporter();t.after(()=>importer.cancel());
  const old=await importer.beginUpload();
  assert.match((await importer.appendChunk(old,{path:'figure.json',bytes:Buffer.from('x')},1,2)).error,/顺序/);
  const next=await importer.stageLocal([source],new Map());await importer.cancel(old);
  assert.equal(importer.resolvePack(next.token,next.packs[0].dir),source);
});

test('finished packages without a performance profile remain editable as metadata',async t=>{
  const root=await fixture(t),source=await sourcePack(join(root,'source'));
  const world=LIVE2D.create(makeCtx(root,{enabled:true,figuresDir:join(root,'figures')}));await world.start({});t.after(()=>world.stop());
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  await invoke('noticeAccept',[1]);const staged=await invoke('importPaths',[[source]]);
  const record=await invoke('importKeep',[staged.token,staged.packs[0].dir]);
  assert.equal((await invoke('detail',[record.buildId])).tunable,false);
  await invoke('edit',[record.buildId,{nameZh:'新名字'}]);
  await assert.rejects(invoke('edit',[record.buildId,{bodyGain:2}]),/不支持/);
  assert.equal((await invoke('detail',[record.buildId])).nameZh,'新名字');
});

test('real local model: recognize, pack and install with automatic draft removal', {skip:!process.env.L2D_MODEL||!process.env.L2D_CORE}, async t=>{
  const root=await fixture(t), source=process.env.L2D_MODEL;
  const before=(await readdir(source)).sort();
  const world=LIVE2D.create(makeCtx(root,{enabled:true,autoDelete:true,cover:false,figuresDir:join(root,'figures')}));
  await prepareWorld(world,join(root,'figure'));t.after(()=>world.stop());
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  const staged=await invoke('importPaths',[[source]]);assert.equal(staged.models.length,1);
  const built=await invoke('importBuild',[staged.token,staged.models[0].dir,false]);
  assert(built.buildId);assert.equal((await invoke('list')).builds.length,1);
  const installed=await invoke('install',['',built.buildId]);
  assert(JSON.parse(await readFile(join(installed.state.install.target,'figure.json'),'utf8')).id);
  assert.equal((await invoke('list')).builds.length,0);
  assert.deepEqual((await readdir(source)).sort(),before);
});
