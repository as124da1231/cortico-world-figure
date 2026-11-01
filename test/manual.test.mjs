import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ManualSessions,writeNativePack,LIBRARY} from '../src/manual.ts';
import {adaptationMode,aiEnabled} from '../src/adaptation.mjs';
import {LIVE2D} from '../src/index.ts';
import {makeCtx} from './_ctx.mjs';

const catalog={model:{title:'Example'},fingerprint:'source',resources:[
 {id:'smile',kind:'expression',classification:'expression',title:'Smile',seconds:1.5,parameters:[{id:'ParamSmile',value:1}],raw:{Parameters:[{Id:'ParamSmile',Value:1}] }},
 {id:'wave',kind:'motion',classification:'gesture',title:'Wave',seconds:1,parameters:[{id:'ParamArm',target:'Parameter',start:0,end:0,min:0,max:1}],raw:{Curves:[{Id:'ParamArm',Target:'Parameter',Segments:[0,0,0,1,1]}]}},
 {id:'outfit',kind:'expression',classification:'appearance',title:'Clothes',seconds:1,parameters:[],raw:{Parameters:[]}}
],warnings:[]};
const binding=[{word:'happy',resource:'smile',confidence:1}];
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'figure-manual-'));t.after(()=>rm(root,{recursive:true,force:true}));const pack=join(root,'pack');await mkdir(join(pack,'models','sample'),{recursive:true});await mkdir(join(pack,'backends'));
 await writeFile(join(pack,'figure.json'),JSON.stringify({id:'sample',vocab:[{id:'happy',kind:'expression'}]}));
 await writeFile(join(pack,'models','sample','profile.js'),'/** generated */\nexport default {\n  fit: {zoom: 1},\n};\n');return {root,pack};}
test('explicit adaptation mode supersedes the legacy AI switch without changing it',()=>{
 assert.equal(adaptationMode({assistMotions:true}),'ai');assert.equal(adaptationMode({}),'none');
 assert.equal(aiEnabled({adaptationMode:'manual',assistMotions:true}),false);
 assert.equal(aiEnabled({adaptationMode:'none',assistMotions:true}),false);
 assert.equal(aiEnabled({adaptationMode:'ai',assistMotions:false}),true);
});
test('native edits preserve profile settings, validate targets, and remove cleared native motions',async t=>{
 const {pack}=await fixture(t);await writeNativePack(pack,catalog,[...binding,{word:'wave',resource:'wave'}]);
 let text=await readFile(join(pack,'models/sample/profile.js'),'utf8');assert.match(text,/zoom: 1/);assert.match(text,/"resource":"smile"/);
 assert.equal(JSON.parse(await readFile(join(pack,'figure.json'))).vocab.length,2);
 await assert.rejects(writeNativePack(pack,catalog,[{word:'happy',resource:'outfit'}]),/外观/);
 await writeNativePack(pack,catalog,[]);text=await readFile(join(pack,'models/sample/profile.js'),'utf8');assert.equal((text.match(/native:/g)||[]).length,1);
 assert.deepEqual(JSON.parse(await readFile(join(pack,'figure.json'))).vocab.map(v=>v.id),['happy']);
 assert.deepEqual(JSON.parse(await readFile(join(pack,LIBRARY))).bindings,[]);
});
test('preview sessions expose only allowlisted chunks, detect changed packs and clean their resources',async t=>{
 const {root,pack}=await fixture(t),sessions=new ManualSessions(root,new URL('../workbench',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
 t.after(()=>sessions.stop());const result=await sessions.open(pack,catalog,binding);
 assert.equal(result.resources.length,3);assert(!result.resources[0].raw);assert(result.files.some(f=>f.path==='web/kit/body.js'));
 await assert.rejects(sessions.asset(result.token,'../secret',0),/无效/);
 await assert.rejects(sessions.asset(result.token,'pack/figure.json',-1),/无效/);
 const loaded=await fetch(result.preview.url);assert.equal(loaded.status,200);assert.match(loaded.headers.get('content-security-policy'),/sandbox allow-scripts/);
 assert.equal((await fetch(result.preview.url,{method:'HEAD'})).status,200);
 assert.equal((await fetch(result.preview.url,{headers:{origin:'https://example.com'}})).status,403);
 assert.equal((await fetch(result.preview.url.replace(result.token,'00000000-0000-0000-0000-000000000000'))).status,404);
 const base=new URL('.',result.preview.url);assert.equal((await fetch(new URL('pack/native-library.json',base))).status,404);assert.equal((await fetch(result.preview.url,{method:'POST'})).status,405);
 const profile=await(await fetch(new URL('pack/models/sample/profile.js',base))).text();assert.match(profile,/textureLimit:512,canvasLimit:512/);assert.doesNotMatch(await readFile(join(pack,'models/sample/profile.js'),'utf8'),/textureLimit:512/);
 const bytes=await sessions.asset(result.token,'pack/figure.json',0);assert(Buffer.from(bytes.b64,'base64').length>0);
 await writeFile(join(pack,'changed.txt'),'changed');await assert.rejects(sessions.validate(result.token,binding),/变化/);
 await sessions.close(result.token);assert.equal(sessions.sessions.size,0);assert.equal((await readdir(join(root,'manual-preview'))).length,0);await assert.rejects(fetch(result.preview.url));
});
test('manual mode never submits imported model analysis to the AI',async t=>{
 const {root}=await fixture(t),model=join(root,'source');await mkdir(model);await writeFile(join(model,'a.model3.json'),JSON.stringify({FileReferences:{Moc:'a.moc3',Textures:[]}}));await writeFile(join(model,'a.moc3'),'fixture');
 const world=LIVE2D.create(makeCtx(root,{enabled:true,adaptationMode:'manual',assistMotions:true}));let events=0;await world.start({pushEvent:async()=>events++});t.after(()=>world.stop());
 await world.webUi('zh').invoke('workbench','importPaths',[[model]]);assert.equal(events,0);
 const settings=await world.webUi('zh').invoke('workbench','settings',[]);assert.equal(settings.adaptationMode,'manual');assert.equal(settings.assistMotions,false);
});

test('AI mode can execute with the legacy switch off, and switching to manual stops execution',async t=>{
 const {root}=await fixture(t),cfg={enabled:true,adaptationMode:'ai',assistMotions:false};const world=LIVE2D.create(makeCtx(root,cfg));await world.start({});t.after(()=>world.stop());
 world.requireNotice=()=>{};let built=false;
 world.doBuild=async()=>{built=true;throw Error('build reached');};
 await assert.rejects(world.executeAutomation({kind:'live2d',dir:root,file:'a.model3.json'},{version:1,bindings:[],resources:[]}),/build reached/);assert.equal(built,true);
 cfg.adaptationMode='manual';built=false;await assert.rejects(world.executeAutomation({kind:'live2d',dir:root},{version:1,bindings:[],resources:[]}),/关闭/);assert.equal(built,false);
});
