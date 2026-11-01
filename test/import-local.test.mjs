import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {clipboardPaths} from '../src/clipboard.ts';
import {PackImporter} from '../src/import.ts';
import {LIVE2D} from '../src/index.ts';
import {makeCtx,prepareWorld} from './_ctx.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'figure-local-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function sourcePack(root){await mkdir(root,{recursive:true});await writeFile(join(root,'figure.json'),JSON.stringify({id:'sample',name:{zh:'名字'},about:{zh:'原简介'}}));await writeFile(join(root,'keep.txt'),'original');return root;}

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
  const token=await importer.beginUpload(),bytes=Buffer.from(JSON.stringify({id:'chunked'}));
  await importer.appendChunk(token,{path:'figure.json',bytes:bytes.subarray(0,5)},0,bytes.length);
  assert.match((await importer.finishUpload(token,false,new Map())).error,/完整/);
  await importer.appendChunk(token,{path:'figure.json',bytes:bytes.subarray(5)},5,bytes.length);
  const result=await importer.finishUpload(token,false,new Map());assert.equal(result.packs[0].id,'chunked');
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
