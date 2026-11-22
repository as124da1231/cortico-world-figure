import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,cp,rm,stat,utimes,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {LIVE2D} from '../src/index.ts';
import {makeCtx} from './_ctx.mjs';

test('model cards prefer the full cover and retain the legacy thumbnail fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'figure-card-cover-'));
  const world = LIVE2D.create(makeCtx(root, {enabled:true}));
  t.after(async () => { await world.stop(); await rm(root, {recursive:true, force:true}); });
  await world.start({});
  const full = Buffer.from('full cover');
  const small = Buffer.from('outfit thumbnail');
  const custom = Buffer.from('custom cover');
  const fixtures = [
    {id:'built', declared:'thumb/cover.png', expected:full},
    {id:'legacy-declared-small', declared:'thumb/opt-model.png', expected:full},
    {id:'custom', declared:'art.png', expected:custom},
    {id:'legacy', declared:'missing.png', expected:small},
  ];
  world.state.builds = [];
  for (const {id, declared} of fixtures) {
    const packDir = join(root, id);
    await mkdir(join(packDir, 'thumb'), {recursive:true});
    await writeFile(join(packDir, 'figure.json'), JSON.stringify({id, thumb:declared}));
    await writeFile(join(packDir, 'thumb/opt-model.png'), small);
    if (id !== 'legacy') await writeFile(join(packDir, 'thumb/cover.png'), full);
    if (id === 'custom') await writeFile(join(packDir, 'art.png'), custom);
    world.state.builds.push({id, packDir, at:0});
  }
  const invoke = world.webUi().invoke;
  const {builds} = await invoke('workbench', 'list', []);
  for (const {id, expected} of fixtures) {
    const image = `data:image/png;base64,${expected.toString('base64')}`;
    assert.equal(builds.find(build => build.id === id).thumb, image);
    assert.equal((await invoke('workbench', 'coverPreview', [id])).image, image);
  }
});

test('unmount cancels a staged import after its build finishes without touching a newer import',async t=>{
  const root=await mkdtemp(join(tmpdir(),'figure-workbench-cancel-'));
  await writeFile(join(root,'sample.model3.json'),JSON.stringify({FileReferences:{Moc:'sample.moc3'}}));
  const world=LIVE2D.create(makeCtx(root,{enabled:true}));
  t.after(async()=>{await world.stop();await rm(root,{recursive:true,force:true});});
  await world.start({});
  const invoke=(method,args=[])=>world.webUi().invoke('workbench',method,args);
  const first=await invoke('importPaths',[[root]]);
  const args=[first.token,first.models[0].dir,false];
  const started=Promise.withResolvers();
  const gate=Promise.withResolvers();
  world.doBuild=async()=>{started.resolve();await gate.promise;throw Error('build failed');};
  const build=assert.rejects(invoke('importBuild',args),/build failed/);
  await started.promise;
  const cancel=invoke('importCancel',[first.token]);
  gate.resolve();
  await build;
  assert.deepEqual(await cancel,{ok:true});
  await assert.rejects(invoke('importBuild',args),/过期/);

  const next=await invoke('importPaths',[[root]]);
  await invoke('importCancel',[first.token]);
  world.doBuild=async()=>({});
  await invoke('importBuild',[next.token,next.models[0].dir,false]);
});

test('model settings can hand off the current native desktop model to the workbench',async t=>{
  const root=await mkdtemp(join(tmpdir(),'figure-desktop-source-'));
  const modelFile=join(root,'sample.model3.json');
  await writeFile(modelFile,JSON.stringify({FileReferences:{Moc:'sample.moc3'}}));
  const world=LIVE2D.create(makeCtx(root,{enabled:true}));
  t.after(async()=>{await world.stop();await rm(root,{recursive:true,force:true});});
  await world.start({});
  world.attachDesktopBody(()=>({id:'desktop-live2d-pet',figure:'sample',modelFile}));
  world.performance.readiness=async()=>({state:'native-model',figure:'sample'});
  const invoke=world.webUi().invoke;

  await assert.rejects(invoke('effects','importDesktopSource',['sample']),/未知面板/);
  await assert.rejects(invoke('settings','importDesktopSource',['previous']),/已经切换/);
  const {token}=await invoke('settings','importDesktopSource',['sample']);
  const result=await invoke('workbench','takeDesktopImport',[]);
  assert.equal(result.token,token);
  assert.equal(result.models[0].title,'sample');
  assert.equal(await invoke('workbench','takeDesktopImport',[]),null);
});

test('the desktop selection and package workflow cannot change the active figure concurrently',async t=>{
  const root=await mkdtemp(join(tmpdir(),'figure-desktop-selection-'));
  const config={enabled:true};
  const world=LIVE2D.create(makeCtx(root,config));
  t.after(async()=>{await world.stop();await rm(root,{recursive:true,force:true});});
  await world.start({});
  world.host={store:{latestCursor:()=>42}};
  world.desktopTargets=async()=>[{id:'sample'}];
  world.performance.readiness=async()=>({});
  const started=Promise.withResolvers();
  const gate=Promise.withResolvers();
  world.performance.refreshSelection=async()=>{started.resolve();await gate.promise;};
  const invoke=world.webUi().invoke;
  const selection=invoke('settings','selectDesktopFigure',['sample']);
  await Promise.race([started.promise,selection]);
  try { await assert.rejects(invoke('workbench','importBegin',[]),/上一个动作还没结束/); }
  finally { gate.resolve(); }
  await selection;
  assert.equal(config.desktopFigure,'sample');
  assert.equal(config.desktopFigureCursor,42);
  assert((await invoke('workbench','importBegin',[])).token);
});

test('a newer import prunes expired upload caches while keeping the source open in the editor',async t=>{
  const root=await mkdtemp(join(tmpdir(),'figure-workbench-editor-source-'));
  const world=LIVE2D.create(makeCtx(root,{enabled:true,assistMotions:true,assistGear:'text'}));
  const sources=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
  t.after(async()=>{await world.stop();await rm(root,{recursive:true,force:true});});
  await world.start({});
  const base=join(root,'figure','automation-inputs');
  const [editing,expired]=sources.map(id=>join(base,id));
  const old=new Date(Date.now()-2*3600000);
  for(const folder of [editing,expired]) {
    await mkdir(folder,{recursive:true});
    const marker=join(folder,'.figure-import-cache');
    await writeFile(marker,'1');
    await utimes(marker,old,old);
  }
  const scratch=join(root,'editor-scratch');
  await mkdir(scratch);
  world.manual.sessions.set('editor',{source:{dir:editing},at:Date.now(),dir:scratch,cache:new Map(),generation:0});
  const source=join(root,'new-source');
  await mkdir(source);
  await writeFile(join(source,'sample.model3.json'),JSON.stringify({FileReferences:{Moc:'sample.moc3'}}));
  const invoke=world.webUi().invoke;
  await invoke('workbench','importPaths',[[source]]);
  assert((await stat(editing)).isDirectory());
  await assert.rejects(stat(expired),{code:'ENOENT'});

  await world.manual.close('editor');
  await invoke('workbench','importPaths',[[source]]);
  await assert.rejects(stat(editing),{code:'ENOENT'});
});

test('the optional local workbench rejects foreign website writes and import-directory traversal',async t=>{
  const root=await mkdtemp(join(tmpdir(),'figure-workbench-'));
  const directory=join(root,'tools','workbench');await mkdir(directory,{recursive:true});
  const serverFile=join(directory,'server.mjs');await cp(new URL('../workbench/tools/workbench/server.mjs',import.meta.url),serverFile);
  await cp(new URL('../workbench/vendor/coo-kit/',import.meta.url),join(root,'vendor','coo-kit'),{recursive:true});
  const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[serverFile,'--no-coo','--port',String(port)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}await rm(root,{recursive:true,force:true});});
  const origin=await new Promise((resolve,reject)=>{
    let output='',error='';const timer=setTimeout(()=>reject(Error('workbench startup timed out')),5000);
    child.stderr.on('data',data=>{error+=data;});
    child.once('error',reject);child.stdout.on('data',data=>{output+=data;const match=/workbench\(simple\) (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('exit',code=>{if(code){clearTimeout(timer);reject(Error('workbench startup failed: '+error.slice(0,1500)));}});
  });
  const blocked=await fetch(origin+'/api/import/begin',{method:'POST',headers:{origin:'https://unrelated.invalid','content-type':'application/json'},body:'{"name":"test"}'});
  assert.equal(blocked.status,403);
  const escape=await fetch(origin+'/api/import/file?id=../../outside&rel=keep.txt',{method:'POST',body:'unsafe'});
  assert.equal(escape.status,400);
  const valid=await fetch(origin+'/api/import/begin',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"name":"test"}'});
  assert.equal(valid.status,200);assert((await valid.json()).id);
});
