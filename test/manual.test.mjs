import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ManualSessions,writeNativePack,LIBRARY} from '../src/manual.ts';
import {adaptationMode,aiEnabled} from '../src/adaptation.mjs';
import {LIVE2D} from '../src/index.ts';
import {makeCtx,fixtureManifest} from './_ctx.mjs';
import {readPackManifest} from '../src/pack-manifest.ts';
import {wardrobeConfig} from '../workbench/pack/backends/wardrobe.js';
import {Live2dWorld} from '../src/world.ts';
import {editPack,packDetail} from '../src/pipeline.ts';
import {BODY_CROP_AXIS,BODY_CROP_DEFAULT,bodyCropForScheme} from '../workbench/pack/backends/crop-config.js';

const catalog={model:{title:'Example'},fingerprint:'source',resources:[
 {id:'smile',kind:'expression',classification:'expression',title:'Smile',seconds:1.5,parameters:[{id:'ParamSmile',value:1}],raw:{Parameters:[{Id:'ParamSmile',Value:1}] }},
 {id:'wave',kind:'motion',classification:'gesture',title:'Wave',seconds:1,parameters:[{id:'ParamArm',target:'Parameter',start:0,end:0,min:0,max:1}],raw:{Curves:[{Id:'ParamArm',Target:'Parameter',Segments:[0,0,0,1,1]}]}},
 {id:'outfit',kind:'expression',classification:'appearance',title:'Clothes',seconds:1,parameters:[],raw:{Parameters:[]}}
],warnings:[]};
const binding=[{word:'happy',resource:'smile',confidence:1}];
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'figure-manual-'));t.after(()=>rm(root,{recursive:true,force:true}));const pack=join(root,'pack');await mkdir(join(pack,'models','sample'),{recursive:true});await mkdir(join(pack,'backends'));
 await writeFile(join(pack,'figure.json'),JSON.stringify(fixtureManifest({vocab:[{id:'happy',kind:'expression',names:{zh:['开心']},about:{zh:'快乐'},seconds:1}]})));
 await writeFile(join(pack,'figure.js'),'export function createFigureBody(){}');
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

test('upper-body framing stays on the same pack and keeps wardrobe selections in order', async t=>{
 const {pack}=await fixture(t);
 await writeFile(join(pack,'build.json'),JSON.stringify({tool:'cortico-live2d-pack'}));
 const groups=[{id:'lookarms',name:'装扮',options:[{id:'raised',name:'抬手',resource:'wave'}]}];
 await writeNativePack(pack,catalog,[],false,groups);
 assert.deepEqual((await packDetail(pack)).crop,BODY_CROP_DEFAULT);
 assert.deepEqual((await packDetail(pack)).gaze,{enabled:true,speed:1});
 const legacyCrop={mode:'upper',edge:'round',line:.55,feather:.08,transition:.4};
 await editPack(pack,{crop:legacyCrop});
 assert.deepEqual((await packDetail(pack)).crop,{...legacyCrop,curve:1});
 const crop={...legacyCrop,curve:.5};
 const gaze={enabled:false,speed:1.75};
 await editPack(pack,{crop,gaze});
 await editPack(pack,{crop:legacyCrop});
 await writeNativePack(pack,catalog,binding,false,groups);
 const manifest=await readPackManifest(pack);
 assert.deepEqual(manifest.axes.map(axis=>axis.id),['lookarms',BODY_CROP_AXIS]);
 assert.deepEqual(manifest.axes[1].options.map(option=>option.id),['figureupperframe','figurefullframe']);
 assert.deepEqual((await packDetail(pack)).crop,crop);
 assert.deepEqual((await packDetail(pack)).gaze,gaze);
 assert.equal(bodyCropForScheme(crop,'raised-figurefullframe').mode,'full');
 assert.equal(bodyCropForScheme(crop,'raised-figureupperframe').mode,'upper');
 const profile=await readFile(join(pack,'models','sample','profile.js'),'utf8');
 assert.match(profile,/wardrobe:.*"axisOffset":0/);
 await assert.rejects(editPack(pack,{nameZh:'Changed',crop:{...crop,line:.99}}),/取景选项无效/);
 await assert.rejects(editPack(pack,{crop:{...crop,curve:2.1}}),/取景选项无效/);
 await assert.rejects(editPack(pack,{gaze:{enabled:true,speed:0}}),/视线跟随选项无效/);
 await assert.rejects(editPack(pack,{gaze:{enabled:'false',speed:1}}),/视线跟随选项无效/);
 assert.equal(await readFile(join(pack,'models','sample','profile.js'),'utf8'),profile);
 assert.deepEqual((await readPackManifest(pack)).axes,manifest.axes);
});
test('static sessions keep low-quality private copies, detect changes and release them without exposing asset URLs',async t=>{
 const {root,pack}=await fixture(t),sessions=new ManualSessions(root,new URL('../workbench',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));t.after(()=>sessions.stop());const opened=await sessions.open(pack,catalog,binding);
 assert.equal(opened.resources.length,3);assert(!opened.resources[0].raw);assert.equal(opened.preview,undefined);assert.equal(opened.files,undefined);assert.equal(typeof sessions.asset,'undefined');
 const profile=await readFile(join(sessions.get(opened.token).copy,'models/sample/profile.js'),'utf8');assert.match(profile,/textureLimit:512,canvasLimit:512/);assert.doesNotMatch(await readFile(join(pack,'models/sample/profile.js'),'utf8'),/textureLimit:512/);
 const copy=sessions.get(opened.token).copy;
 assert.match(await readFile(join(copy,'backends','voice-playback.js'),'utf8'),/createFigureVoicePlayback/);
 await assert.rejects(readFile(join(pack,'backends','voice-playback.js')), {code:'ENOENT'});
 await assert.rejects(sessions.preview(opened.token,{page:'actions',raw:false,word:'happy',resource:'../secret',picks:{}}),/资源无效/);
 await writeFile(join(pack,'changed.txt'),'changed');await assert.rejects(sessions.validate(opened.token,binding),/变化/);await sessions.close(opened.token);assert.equal(sessions.sessions.size,0);assert.equal((await readdir(join(root,'manual-preview'))).length,0);
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

async function editableWorld(t){
 const f=await fixture(t);await writeNativePack(f.pack,catalog,[]);
 const world=new Live2dWorld({getConfig:()=>({enabled:true,workDir:join(f.root,'work')}),persist(){},dataDir:f.root});
 world.captureWardrobe=async()=>{}; // Transaction fixtures have no Core; real rendering is covered separately.
 const record={id:'existing',packDir:f.pack,at:1,bytes:1,words:0,cover:false,fit:false,manualAvailable:true};
 world.state={modelDir:'',builds:[record],build:record,distributionNotice:{revision:1,at:1}};
 t.after(()=>world.stop());const opened=await world.manual.open(f.pack,catalog,[],undefined,record.id);
 return {...f,world,token:opened.token};
}
test('editing replaces the same card and retrying its receipt never creates another card',async t=>{
 const {world,token}=await editableWorld(t);const first=await world.saveManual(token,binding),pack=world.state.builds[0].packDir;
 assert.equal(first.buildId,'existing');assert.equal(world.state.builds.length,1);assert.equal(world.state.builds[0].id,'existing');
 assert.equal(JSON.parse(await readFile(join(pack,LIBRARY))).bindings[0].resource,'smile');
 assert.deepEqual(await world.saveManual(token,binding),first);assert.equal(world.state.builds.length,1);
 const opened=await world.manual.open(pack,catalog,binding,undefined,'existing');await world.saveManual(opened.token,[]);
 assert.equal(world.state.builds.length,1);assert.deepEqual(JSON.parse(await readFile(join(world.state.builds[0].packDir,LIBRARY))).bindings,[]);
});
test('temporary cleanup failures cannot remove a committed pack or report save failure',async t=>{
 const {world,token}=await editableWorld(t),close=world.manual.close.bind(world.manual);world.manual.close=async()=>{throw Error('EPERM cleanup');};
 try{const result=await world.saveManual(token,binding);assert.equal(result.buildId,'existing');assert((await readFile(join(world.state.builds[0].packDir,'figure.json'))).length);assert.equal(world.state.builds.length,1);assert.equal((await world.saveManual(token,binding)).buildId,'existing');}
 finally{world.manual.close=close;await close(token);}
});
test('failed state commits keep the original card and allow retry with the same session',async t=>{
 const {world,token,pack,root}=await editableWorld(t),save=world.save.bind(world);world.save=async()=>{throw Error('disk full');};
 await assert.rejects(world.saveManual(token,binding),/disk full/);assert.equal(world.state.builds[0].packDir,pack);assert.deepEqual(JSON.parse(await readFile(join(pack,LIBRARY))).bindings,[]);assert.deepEqual(await readdir(join(root,'work','builds')),[]);
 world.save=save;await world.saveManual(token,binding);assert.equal(world.state.builds[0].id,'existing');
});
test('expired leases are removed, saving leases defer close, and cancelled open requests leave no sessions',async t=>{
 const {root,pack}=await fixture(t),sessions=new ManualSessions(root,new URL('../workbench',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));t.after(()=>sessions.stop());
 const first=await sessions.open(pack,catalog);sessions.get(first.token).at=Date.now()-3*3600000;await sessions.prune();assert.equal(sessions.sessions.size,0);assert.throws(()=>sessions.get(first.token),/过期/);
 const second=await sessions.open(pack,catalog);const lease=sessions.get(second.token);lease.saving=true;await sessions.close(second.token);assert(sessions.sessions.has(second.token));assert(lease.closeRequested);lease.saving=false;await sessions.close(second.token);
 const id='12345678-1234-1234-1234-123456789abc';await sessions.close(id);await assert.rejects(sessions.open(pack,catalog,[],undefined,undefined,id),/取消/);assert.equal(sessions.sessions.size,0);
 const next='23456789-1234-1234-1234-123456789abc';const opening=sessions.open(pack,catalog,[],undefined,undefined,next);await sessions.close(next);await assert.rejects(opening,/取消/);assert.equal(sessions.sessions.size,0);
});

test('wardrobe saves into host axes and runtime data; clearing axes keeps the resource library and the same card',async t=>{
 const {world,token}=await editableWorld(t),groups=[{id:'lookarms',name:'手部',options:[{id:'raised',name:'抬起',resource:'wave',ground:true}]}];
 await world.saveManual(token,binding,groups);let pack=world.state.builds[0].packDir,m=JSON.parse(await readFile(join(pack,'figure.json')));assert.equal(m.axes[0].id,'lookarms');assert.deepEqual(m.axes[0].options.map(o=>o.id),['default','raised']);
 const profile=await readFile(join(pack,'models/sample/profile.js'),'utf8');assert.match(profile,/wardrobe:.*"axisOffset":0/);const library=JSON.parse(await readFile(join(pack,LIBRARY)));assert.deepEqual(library.wardrobe[0].options[0],{id:'raised',name:'抬起',resource:'wave'});assert.doesNotMatch(profile,/"ground":/);
 const open=await world.manual.open(pack,catalog,binding,undefined,'existing',undefined,groups);assert.equal(open.wardrobe[0].name,'装扮');await world.saveManual(open.token,binding,[]);pack=world.state.builds[0].packDir;m=JSON.parse(await readFile(join(pack,'figure.json')));assert.deepEqual(m.axes,[]);assert.equal(JSON.parse(await readFile(join(pack,LIBRARY))).catalog.resources.length,3);assert.equal(world.state.builds.length,1);
});
test('failed wardrobe thumbnail rendering keeps the original card and draft for retry',async t=>{
 const {world,token,pack,root}=await editableWorld(t);world.captureWardrobe=async()=>{throw Error('thumbnail renderer unavailable');};
 await assert.rejects(world.saveManual(token,binding,[{id:'lookarm',name:'装扮',options:[{id:'up',name:'抬手',resource:'wave'}]}]),/renderer unavailable/);
 assert.equal(world.state.builds[0].packDir,pack);assert.equal(world.state.builds.length,1);assert.equal(world.manual.get(token).saving,false);assert.deepEqual(await readdir(join(root,'work','builds')),[]);
 world.captureWardrobe=async()=>{};await world.saveManual(token,binding,[]);assert.equal(world.state.builds[0].id,'existing');
});

test('legacy axis order and IDs survive fixed-slot normalization',async t=>{
 const {pack}=await fixture(t),legacy=[{id:'lookhat',name:'配饰',options:[{id:'on',name:'帽子',resource:'smile'}]},{id:'lookcoat',name:'装扮',options:[{id:'on',name:'衣服',resource:'wave'}]}];
 await writeFile(join(pack,'figure.json'),JSON.stringify({axes:[{id:'model',options:[{id:'sample'}]},...legacy.map(g=>({id:g.id,name:{zh:g.name},options:[{id:'default'},{id:'on'}]}))],vocab:[]}));await writeFile(join(pack,LIBRARY),JSON.stringify({catalog,bindings:[],wardrobe:legacy}));
 await writeNativePack(pack,catalog,[],false,legacy);const manifest=JSON.parse(await readFile(join(pack,'figure.json')));assert.deepEqual(manifest.axes.map(a=>a.id),['model','lookhat','lookcoat']);assert.deepEqual(JSON.parse(await readFile(join(pack,LIBRARY))).wardrobe.map(g=>g.name),['装扮','部件','配饰']);
 const profile=await readFile(join(pack,'models/sample/profile.js'),'utf8'),runtime=JSON.parse(profile.match(/  wardrobe: (.*),\n/)[1]);assert.deepEqual(runtime.groups.map(g=>g.id),['lookhat','lookcoat']);assert.equal(runtime.axisOffset,1);
});

test('custom groups and language labels survive a save, and replacement metacharacters stay literal',async t=>{
 const {pack}=await fixture(t);
 const withCoat={...catalog,resources:[...catalog.resources,{id:'coat',kind:'expression',raw:{Parameters:[{Id:'Coat',Value:1,Blend:'Overwrite'}]}}]};
 const groups=wardrobeConfig(withCoat,[{id:'customlook',custom:true,name:'装扮',en:'Hair',options:[{id:'on',name:'Price $& tax',resource:'coat'}]}]).groups;
 await writeNativePack(pack,withCoat,[{word:'wave',resource:'wave'}],false,groups);
 const manifest=await readPackManifest(pack);
 assert.equal(manifest.axes[0].name.en,'Hair');
 assert.equal(manifest.axes[0].options[1].name.zh,'Price $& tax');
 assert.equal(manifest.vocab.find(word=>word.id==='wave').about.zh,'原生招手');
 const library=JSON.parse(await readFile(join(pack,LIBRARY),'utf8'));
 assert.equal(library.wardrobe.find(group=>group.id==='customlook').custom,true);
 const profile=await readFile(join(pack,'models','sample','profile.js'),'utf8');
 const {default:runtime}=await import('data:text/javascript;base64,'+Buffer.from(profile).toString('base64'));
 assert.equal(runtime.wardrobe.groups[0].options[0].name,'Price $& tax');
});
