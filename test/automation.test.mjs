import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FigureAutomation,FIGURE_TOOL_DECLS} from '../src/automation.mjs';
import {findModels,inspectNative,nativeConfig,validateBindings,curveSummary} from '../workbench/tools/native-catalog.mjs';
import {compileCurve,createNativeActions,applyNativeValues} from '../workbench/pack/backends/native-actions.js';
import {LIVE2D} from '../src/index.ts';
import {makeCtx} from './_ctx.mjs';
import {PackImporter} from '../src/import.ts';
import {installPack} from '../src/pipeline.ts';
import {packFingerprint} from '../src/pack-fingerprint.ts';

import {analysisPolicy,bindingKey} from '../src/analysis.mjs';

const json=(path,value)=>writeFile(path,JSON.stringify(value));
const evidenceFrames=async(_catalog,_native,samples)=>samples.map(s=>({...s,png:'data:image/png;base64,iVBORw0KGgo='}));
const motion=(start,end)=>({Meta:{Duration:1,Loop:true},Curves:[{Target:'Parameter',Id:'ParamArm',Segments:[0,start,0,1,end]},{Target:'PartOpacity',Id:'PartArm',Segments:[0,start,0,1,end]}]});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'figure-auto-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dir=join(root,'角色');await mkdir(join(dir,'Animation'),{recursive:true});await mkdir(join(dir,'Exp3'));
 await json(join(dir,'角色.model3.json'),{FileReferences:{Moc:'角色.moc3',Textures:[]}});await writeFile(join(dir,'角色.moc3'),'fixture');
 await json(join(dir,'Animation','抚胸打开.motion3.json'),motion(0,1));await json(join(dir,'Animation','抚胸关闭.motion3.json'),motion(1,0));
 await json(join(dir,'Exp3','开心.exp3.json'),{Parameters:[{Id:'ParamSmile',Value:1,Blend:'Add'}]});
 await json(join(dir,'Exp3','另一个中文.exp3.json'),{Parameters:[{Id:'ParamTear',Value:1,Blend:'Overwrite'}]});
 await writeFile(join(dir,'Exp3','损坏.exp3.json'),'broken');
 const found=await findModels(dir),model=found.models[0],catalog=await inspectNative(model);
 return {root,dir,model,catalog};
}
async function automation(t,extra={}){
 const f=await fixture(t),events=[],executions=[];
 const cfg={assistMotions:true,assistGear:'text',assistAuto:false,modelRoots:f.dir};
 const host={modelFacts:{accepts:()=>false},store:{latestCursor:()=>events.at(-1)?.cursor||0,get:c=>events.find(e=>e.cursor===c),range:q=>events.filter(e=>(!q.source||q.source===e.source)&&e.cursor>=(q.fromCursor||0)&&e.cursor<=(q.toCursor||Infinity))},pushEvent:async e=>{events.push({...e,cursor:events.length+1});return events.at(-1);}};
 const auto=new FigureAutomation({dataDir:join(f.root,'data'),getConfig:()=>cfg,getHost:()=>host,execute:async(model,native,signal)=>{signal?.throwIfAborted();executions.push({model,native});return{figureId:'fixture',installed:true};},...extra});
 await auto.start();t.after(()=>auto.stop());await auto.find(f.dir);
 const happy=f.catalog.resources.find(r=>r.title.includes('开心'));
 const bindings=[{word:'happy',resource:happy.id,confidence:.9,reason:'作者命名为开心，参数控制微笑'}];
 return {...f,cfg,host,events,executions,auto,bindings};
}
function approveInChat(f,plan,{index=0,question=plan.question}={}){
 const askId='real-ask';f.events.push({cursor:f.events.length+1,source:'desktop-pet',type:'desktop-pet.self',meta:{kind:'ask',askId,question,options:plan.options}});
 const answer={cursor:f.events.length+1,source:'desktop-pet',type:'desktop-pet.answer',meta:{askId,index}};f.events.push(answer);return answer.cursor;
}

test('depth policy is inactive outside explicit image mode and defaults to standard',()=>{
 assert.equal(analysisPolicy({assistGear:'text',assistDepth:'deep'}).depth,null);
 assert.equal(analysisPolicy({assistGear:'auto',assistDepth:'deep'}).targeted,false);
 assert.equal(analysisPolicy({assistGear:'image'}).depth,null);
 assert.equal(analysisPolicy({assistMotions:true,assistGear:'image'}).depth,'standard');
 assert.equal(analysisPolicy({assistMotions:true,assistGear:'image',assistDepth:'quick'}).maxFrames,4);
});

test('curve summaries reveal middle peaks, returns and exact cubic extrema',()=>{
 const bounce=curveSummary({Segments:[0,0,0,.5,1,0,1,0]});
 assert.equal(bounce.max,1);assert.equal(bounce.peakTime,.5);assert.equal(bounce.turns,1);assert.equal(bounce.returnsToStart,true);
 const cubic=curveSummary({Segments:[0,0,1,1/3,2,2/3,2,1,0]});
 assert.equal(cubic.max,1.5);assert.equal(cubic.peakTime,.5);assert.equal(cubic.min,0);
});

test('appearance channels are protected regardless of position, title or claimed confidence',async t=>{
 const f=await automation(t);
 for(const [i,name]of ['单片眼镜','黑框眼镜','脱鞋','体型1','默认体型','尾巴开关'].entries())await json(join(f.dir,'Exp3',name+'.exp3.json'),{Parameters:[{Id:'custom'+i,Value:1}]});
 await json(join(f.dir,'Exp3','开心2.exp3.json'),{Parameters:[{Id:'custom0',Value:1}]});
 const c=await f.auto.catalog(f.model.id);
 for(const r of c.resources.filter(r=>r.title!=='开心'&&r.title!=='另一个中文'&&r.kind==='expression')){
  assert.equal(r.classification,'appearance');assert.throws(()=>validateBindings(c,[{word:'happy',resource:r.id,confidence:.99}]),/外观/);
 }
 const long=Array.from({length:35},(_,i)=>({Id:'channel'+i,Value:1}));long[34].Id='ParamGlasses';
 await json(join(f.dir,'Exp3','开心3.exp3.json'),{Parameters:long});
 assert.equal((await f.auto.catalog(f.model.id)).resources.find(r=>r.title==='开心3').classification,'appearance');
});

test('resource and channel pagination stay within a total text budget without hiding truncation',async t=>{
 const f=await automation(t);f.cfg.assistGear='text';
 for(let n=0;n<40;n++)await json(join(f.dir,'Exp3',`resource-${n}.exp3.json`),{Parameters:Array.from({length:45},(_,i)=>({Id:'P'+i+'x'.repeat(100),Value:i}))});
 const seen=new Set();let offset=0,first;
 do{
  const reply=await f.auto.actions(f.model.id,offset),page=JSON.parse(reply.text);assert(reply.text.length<=6500);assert.equal(page.truncated,false);
  for(const r of page.resources){assert(!seen.has(r.id));seen.add(r.id);if(r.parameterCount===45)first??=r.id;}
  offset=page.next;
 }while(offset!==null);
 assert.equal(seen.size,44);
 let p=0;const channels=[];
 do{const reply=await f.auto.actions(f.model.id,0,undefined,{resources:[first],parameter_offset:p});assert(reply.text.length<=6500);const row=JSON.parse(reply.text).resources[0];channels.push(...row.parameters.map(p=>p.id));p=row.nextParameterOffset;}while(p!==null);
 assert.equal(new Set(channels).size,45);
});

test('image evidence balances named expressions and motions and supports exact targeted moments',async t=>{
 const f=await automation(t,{evidence:evidenceFrames});f.cfg.assistGear='image';f.cfg.assistDepth='standard';f.host.modelFacts.accepts=()=>true;
 const result=JSON.parse((await f.auto.actions(f.model.id)).text);
 assert(result.evidence.some(e=>e.id===f.bindings[0].resource));assert.equal(result.evidence[0].id,'__neutral__');
 const pose=f.catalog.resources.find(r=>r.kind==='motion');
 const target=JSON.parse((await f.auto.actions(f.model.id,0,undefined,{resources:[pose.id],samples:[{resource:pose.id,time:.37}]})).text);
 assert(target.evidence.some(e=>e.id===pose.id&&e.time===.37));
 await assert.rejects(f.auto.actions(f.model.id,0,undefined,{resources:[pose.id],samples:[{resource:pose.id,time:4}]}),/时刻/);
 f.cfg.assistGear='text';await assert.rejects(f.auto.actions(f.model.id,0,undefined,{resources:[pose.id],samples:[{resource:pose.id,time:0}]}),/标准或深入/);
});

test('deep mode requires mapping comparisons even after general inspection and confidence .99',async t=>{
 const f=await automation(t,{evidence:evidenceFrames});Object.assign(f.cfg,{assistGear:'image',assistDepth:'deep',assistAuto:true});f.host.modelFacts.accepts=()=>true;
 await f.auto.actions(f.model.id);
 const unreviewed=await f.auto.prepare(f.model.id,[{...f.bindings[0],confidence:.99}]);assert.equal(unreviewed.automatic,false);
 await assert.rejects(f.auto.install(unreviewed.id),/真实同意/);assert.equal(f.executions.length,0);
 const result=JSON.parse((await f.auto.call('figure_actions',{model:f.model.id,review:f.bindings})).text);
 assert.equal(result.review.provided,true);assert(result.evidence.some(e=>e.generic&&e.word==='happy'));assert(result.evidence.some(e=>!e.generic&&e.word==='happy'));
 const reviewed=await f.auto.prepare(f.model.id,f.bindings);assert.equal(reviewed.automatic,true);assert(reviewed.analysis.review.includes(bindingKey(f.bindings[0])));
 // Existing unreviewed proposals cannot acquire a later receipt silently.
 await assert.rejects(f.auto.install(unreviewed.id),/真实同意/);
 await f.auto.install(reviewed.id);assert.equal(f.executions.length,1);
});

test('unsupported, partial or source-changed pictures never authorize automatic installation',async t=>{
 const f=await automation(t,{evidence:evidenceFrames});Object.assign(f.cfg,{assistGear:'image',assistDepth:'deep',assistAuto:true});
 let result=JSON.parse((await f.auto.actions(f.model.id,0,undefined,{review:f.bindings})).text);assert.equal(result.review.provided,false);
 assert.equal((await f.auto.prepare(f.model.id,f.bindings)).automatic,false);
 f.host.modelFacts.accepts=()=>true;f.auto.options.evidence=async()=>[];
 result=JSON.parse((await f.auto.actions(f.model.id,0,undefined,{review:f.bindings})).text);assert.match(result.evidenceWarning,/不完整/);
 f.auto.options.evidence=async(...args)=>{await json(join(f.dir,'Exp3','开心.exp3.json'),{Parameters:[{Id:'ParamSmile',Value:.4}]});return evidenceFrames(...args);};
 result=JSON.parse((await f.auto.actions(f.model.id,0,undefined,{review:f.bindings})).text);assert.equal(result.evidence.length,0);assert.match(result.evidenceWarning,/已改变/);
 assert.equal((await f.auto.prepare(f.model.id,f.bindings)).automatic,false);
});

test('changing labels invalidates receipts and raising depth cannot bypass confirmation',async t=>{
 const f=await automation(t,{evidence:evidenceFrames});Object.assign(f.cfg,{assistGear:'image',assistDepth:'standard',assistAuto:true});f.host.modelFacts.accepts=()=>true;
 await f.auto.actions(f.model.id);const p=await f.auto.prepare(f.model.id,f.bindings);assert.equal(p.automatic,true);
 f.cfg.assistDepth='deep';assert.equal(f.auto.publicPlan(f.auto.plans.get(p.id)).automatic,false);
 await assert.rejects(f.auto.install(p.id),/真实同意/);
 const reviewed=await f.auto.actions(f.model.id,0,undefined,{review:f.bindings});assert(JSON.parse(reviewed.text).review.provided);
 await json(join(f.dir,'角色.cdi3.json'),{Parameters:[{Id:'ParamSmile',Name:'custom smile'}]});
 const next=await f.auto.prepare(f.model.id,f.bindings);assert.equal(next.automatic,false);
});

test('visual receipts alone do not make arbitrary or truncated mappings safe for full-auto',async t=>{
 const f=await automation(t,{evidence:evidenceFrames});Object.assign(f.cfg,{assistGear:'image',assistDepth:'deep',assistAuto:true});f.host.modelFacts.accepts=()=>true;
 const arbitrary=[{...f.bindings[0],word:'thinking',confidence:.99}];
 await f.auto.actions(f.model.id,0,undefined,{review:arbitrary});
 const proposal=await f.auto.prepare(f.model.id,arbitrary);assert.equal(proposal.automatic,false);
 await assert.rejects(f.auto.install(proposal.id),/真实同意/);
 const catalog=await f.auto.catalog(f.model.id);f.auto.catalog=async()=>({...catalog,truncated:true});
 const response=JSON.parse((await f.auto.actions(f.model.id)).text);assert.equal(response.truncated,true);
 const partial=await f.auto.prepare(f.model.id,[]);assert.equal(partial.automatic,true); // No native mappings: generic-only is safe.
 const mapped=await f.auto.prepare(f.model.id,f.bindings);assert.equal(mapped.automatic,false);
});

test('tool proposal receipts stay bounded while the panel retains the full mapping list',async t=>{
 const f=await automation(t);
 const words=['neutral','happy','wink','love','shy','surprised','angry','sad','sleepy','thinking','smug','pout','worried','determined','flustered','scared','excited','cry','confused'];
 const bindings=words.map(word=>({...f.bindings[0],word,reason:'说明'.repeat(100)}));
 const reply=await f.auto.call('figure_prepare',{model:f.model.id,bindings});assert(reply.text.length<6500);
 const receipt=JSON.parse(reply.text);assert.equal(receipt.mappedCount,19);assert.equal(receipt.moreMappings,11);
 assert.equal(f.auto.publicPlan(f.auto.plans.get(receipt.id)).bindings.length,19);
});

test('panel approval can retry a failed install or decline the approved proposal',async t=>{
 let attempts=0;
 const f=await automation(t,{execute:async()=>{if(++attempts===1)throw Error('disk unavailable');return {figureId:'retry',installed:true};}});
 const p=await f.auto.prepare(f.model.id,f.bindings);
 await f.auto.approve(p.id);await assert.rejects(f.auto.install(p.id),/disk unavailable/);
 assert.equal(f.auto.pending().find(x=>x.id===p.id).error,'disk unavailable');
 await f.auto.approve(p.id);await f.auto.install(p.id);assert.equal(attempts,2);
 const other=await f.auto.prepare(f.model.id,f.bindings);await f.auto.approve(other.id);await f.auto.reject(other.id);
 await assert.rejects(f.auto.install(other.id),/失效/);
});

test('explicit resubmission and concurrent imports cannot duplicate a queued analysis',async t=>{
 const f=await automation(t),result={token:'dedup',models:[{dir:'role'}],packs:[]};
 await Promise.all([f.auto.imported(result,()=>f.dir),f.auto.imported(result,()=>f.dir,true)]);
 await f.auto.imported(result,()=>f.dir,true);
 assert.equal(f.events.filter(e=>e.type==='figure.imported').length,1);
 assert.equal(f.auto.submissions()[0].waiting.length,1);
 await f.auto.prepare(f.model.id,f.bindings);
 assert.equal(f.auto.submissions()[0].waiting.length,0);
});

test('a stalled submission can retry after cooldown and concurrent retries still emit once',async t=>{
 const f=await automation(t),result={token:'retry-analysis',models:[{dir:'role'}],packs:[]};
 await f.auto.imported(result,()=>f.dir);f.auto.requests.get(result.token).at-=31*60000;
 assert.equal(f.auto.submissions()[0].canRetry,true);
 await Promise.all([f.auto.imported(result,()=>f.dir,true),f.auto.imported(result,()=>f.dir,true)]);
 assert.equal(f.events.length,2);assert.equal(f.auto.submissions()[0].canRetry,false);
 await f.auto.prepare(f.model.id,f.bindings);f.auto.requests.get(result.token).at-=31000;
 assert.equal((await f.auto.imported(result,()=>f.dir,true)).queued,false);assert.equal(f.events.length,2);
});

test('ready-pack approval rejects changed runtime files and copied contents before replacing an installation',async t=>{
 const f=await automation(t),source=join(f.root,'ready');await mkdir(source);
 await json(join(source,'figure.json'),{id:'ready',entry:'figure.js'});await writeFile(join(source,'figure.js'),'old');
 const model=(await f.auto.find(source)).models[0],plan=await f.auto.prepare(model.id,[]);await f.auto.approve(plan.id);
 const expected=await packFingerprint(source),target=await installPack(source,join(f.root,'installed'));
 await writeFile(join(source,'figure.js'),'new');
 await assert.rejects(f.auto.install(plan.id),/已改变/);assert.equal(f.executions.length,0);
 await assert.rejects(installPack(source,join(f.root,'installed'),{expectedFingerprint:expected}),/已改变/);
 assert.equal(await readFile(join(target,'figure.js'),'utf8'),'old');
 const current=await packFingerprint(source);await installPack(source,join(f.root,'installed'),{expectedFingerprint:current});
 assert.equal(await readFile(join(target,'figure.js'),'utf8'),'new');
 await mkdir(join(source,'models'));await writeFile(join(source,'models','texture.png'),'texture');
 assert.notEqual(await packFingerprint(source),current);
});

test('legacy figure plans migrate into the figure namespace without overwriting the original record',async t=>{
 const f=await automation(t),plan=await f.auto.prepare(f.model.id,f.bindings);await f.auto.approve(plan.id);
 const saved=await readFile(f.auto.file(),'utf8'),legacy=join(f.root,'data','automation.json');
 await writeFile(legacy,saved);await rm(f.auto.file());
 const resumed=new FigureAutomation(f.auto.options);await resumed.start();t.after(()=>resumed.stop());
 assert.equal(resumed.pending()[0].status,'approved');assert.equal(await readFile(legacy,'utf8'),saved);
 assert.equal(JSON.parse(await readFile(resumed.file(),'utf8')).owner,'figure');
 await rm(resumed.file());await writeFile(legacy,JSON.stringify({version:1,plans:[{id:'other-app',model:{id:'unrelated'}}]}));
 const unrelated=new FigureAutomation(f.auto.options);await unrelated.start();t.after(()=>unrelated.stop());
 assert.equal(unrelated.pending().length,0);assert.equal(JSON.parse(await readFile(legacy,'utf8')).plans[0].id,'other-app');
});

test('bounded generic discovery finds Chinese Animation/Exp3 and keeps unique stable resource IDs',async t=>{
 const f=await fixture(t);assert.equal(f.catalog.resources.length,4);assert.equal(new Set(f.catalog.resources.map(r=>r.id)).size,4);assert.equal(f.catalog.warnings.length,1);
 const second=await inspectNative(f.model);assert.deepEqual(second.resources.map(r=>r.id),f.catalog.resources.map(r=>r.id));
 const pose=f.catalog.resources.find(r=>r.title.includes('打开'));assert(pose.release);assert.equal(f.catalog.resources.find(r=>r.id===pose.release).title,'抚胸关闭');
 const limited=await findModels(f.root,{maxEntries:1});assert.equal(limited.truncated,true);
});
test('resources escaping the model root and directory links are never followed',async t=>{
 const f=await fixture(t);await writeFile(join(f.root,'outside.exp3.json'),'{}');
 await json(join(f.dir,'角色.model3.json'),{FileReferences:{Expressions:[{File:'../outside.exp3.json'}]}});
 const c=await inspectNative(f.model);assert(c.warnings.some(w=>w.includes('越过')));assert(!c.resources.some(r=>r.file.startsWith('..')));
 try{await symlink(f.dir,join(f.root,'link'),'junction');}catch(e){if(e.code==='EPERM')return;throw e;}
 assert.equal((await findModels(join(f.root,'link'))).models.length,0);
});
test('pose mappings require a real reset and generated configuration contains only selected resources',async t=>{
 const f=await fixture(t),pose=f.catalog.resources.find(r=>r.title.includes('打开'));
 assert.throws(()=>validateBindings(f.catalog,[{word:'wave',resource:pose.id}]),/复位/);
 assert.throws(()=>validateBindings(f.catalog,[{word:'wave',resource:'invented'}]),/不存在/);
 const native=nativeConfig(f.catalog,[{word:'wave',resource:pose.id,release:pose.release,reason:'测试成对姿态',confidence:.8}]);assert.equal(native.resources.length,2);
 assert(native.resources.every(r=>r.data.Curves));
 assert.throws(()=>validateBindings(f.catalog,[{word:'wave',resource:pose.id,release:pose.id}]),/不匹配/);
 const reset=f.catalog.resources.find(r=>r.id===pose.release);
 const unrelated={...reset,id:'other-reset',parameters:reset.parameters.map(p=>({...p,id:'OtherChannel'}))};
 assert.throws(()=>validateBindings({...f.catalog,resources:[...f.catalog.resources,unrelated]},[{word:'wave',resource:pose.id,release:unrelated.id}]),/不匹配/);
});

test('an explicit entry file does not select sibling model entries',async t=>{
 const f=await fixture(t);await json(join(f.dir,'另一款.model3.json'),{FileReferences:{Moc:'角色.moc3'}});
 assert.equal((await findModels(f.dir)).models.length,2);
 const found=await findModels(join(f.dir,'另一款.model3.json'));assert.equal(found.models.length,1);assert.equal(found.models[0].file,'另一款.model3.json');
});
test('stable tool entries enforce the live enable switch and never accept invented confirmation booleans',async t=>{
 const f=await automation(t);f.cfg.assistMotions=false;
 assert.equal(f.auto.tools().length,4);await assert.rejects(f.auto.tools()[0].handler({path:f.dir},{}),/开启/);f.cfg.assistMotions=true;
 assert.deepEqual(f.auto.tools().map(d=>d.name),FIGURE_TOOL_DECLS.map(d=>d.name));
 const plan=await f.auto.prepare(f.model.id,f.bindings,true);
 await assert.rejects(f.auto.install(plan.id,true),/真实同意/);assert.equal(f.executions.length,0);
});
test('verified proposal answers install once and replay the receipt without reinstalling',async t=>{
 const f=await automation(t),plan=await f.auto.prepare(f.model.id,f.bindings,true);
 const cursor=approveInChat(f,plan),first=await f.auto.install(plan.id,cursor),again=await f.auto.install(plan.id,cursor);
 assert.equal(first.figureId,'fixture');assert.equal(first.wearRequested,true);assert.equal(again.replayed,true);assert.equal(f.executions.length,1);
 const saved=JSON.parse(await readFile(f.auto.file(),'utf8'));assert.equal(saved.plans[0].status,'done');
});

test('an installed pack stays successful when state persistence or Coo notification fails',async t=>{
 const f=await fixture(t),source=join(f.root,'ready');await mkdir(source);
 await json(join(source,'figure.json'),{id:'ready',entry:'figure.js',name:{zh:'现成形象'}});await writeFile(join(source,'figure.js'),'export default {};');
 const cfg={enabled:true,assistMotions:true,assistGear:'text',figuresDir:join(f.root,'installed')};
 const world=LIVE2D.create(makeCtx(f.root,cfg));await world.start({pushEvent:async()=>{throw Error('Coo event unavailable');}});t.after(()=>world.stop());
 const invoke=(method,args=[])=>world.webUi('zh').invoke('workbench',method,args);
 await invoke('noticeAccept',[1]);
 const call=async(name,args)=>JSON.parse((await world.tools().find(t=>t.name===name).handler(args,{})).text);
 const found=await call('figure_models',{path:source}),plan=await call('figure_prepare',{model:found.models[0].id,bindings:[]});
 world.save=async()=>{throw Error('State disk unavailable');};
 const result=await invoke('assistApprove',[plan.id]);assert.equal(result.installed,true);assert.match(result.warning,/记录保存失败/);
 assert.equal(JSON.parse(await readFile(join(result.target,'figure.json'),'utf8')).id,'ready');
 assert.equal((await call('figure_install',{plan:plan.id})).replayed,true);
});
test('an unrelated question, refusal, edited source or disabled switch cannot authorize installation',async t=>{
 const f=await automation(t),plan=await f.auto.prepare(f.model.id,f.bindings);
 await assert.rejects(f.auto.install(plan.id,approveInChat(f,plan,{question:'别的问题'})),/不对应/);
 await assert.rejects(f.auto.install(plan.id,approveInChat(f,plan,{index:1})),/真实同意/);
 const cursor=approveInChat(f,plan);await json(join(f.dir,'Exp3','开心.exp3.json'),{Parameters:[{Id:'ParamSmile',Value:.2}]});
 await assert.rejects(f.auto.install(plan.id,cursor),/已改变/);
 f.cfg.assistMotions=false;await assert.rejects(f.auto.install(plan.id,cursor),/开启/);assert.equal(f.executions.length,0);
});
test('concurrent execution and cancellation do not duplicate or commit an unapproved action',async t=>{
 let finish;const f=await automation(t,{execute:()=>new Promise(r=>{finish=r;})}),plan=await f.auto.prepare(f.model.id,f.bindings);
 await f.auto.approve(plan.id);const one=f.auto.install(plan.id);
 await assert.rejects(f.auto.install(plan.id),/失效|正在/);
 for(let i=0;i<20&&!finish;i++)await new Promise(r=>setTimeout(r,5));finish({figureId:'once'});await one;
 const next=await f.auto.prepare(f.model.id,f.bindings);await f.auto.approve(next.id);const stop=new AbortController();stop.abort();await assert.rejects(f.auto.install(next.id,null,stop.signal),/abort/i);
});
test('full-auto skips uncertain mappings and does not bypass pending appearance consent',async t=>{
 const f=await automation(t);f.cfg.assistAuto=true;
 const p=await f.auto.prepare(f.model.id,[{...f.bindings[0],confidence:.2}]);assert.equal(p.bindings.length,0);assert.deepEqual(p.skipped,['happy']);
 await f.auto.install(p.id);assert.equal(f.executions.length,1);
});
test('image analysis falls back honestly and enforces a six-frame per-call budget',async t=>{
 const f=await automation(t,{evidence:async(_c,_n,samples)=>samples.map(s=>({...s,png:'data:image/png;base64,iVBORw0KGgo='}))});f.cfg.assistGear='image';
 let result=await f.auto.actions(f.model.id);assert.equal(result.blobs,undefined);assert.match(JSON.parse(result.text).evidenceWarning,/不支持图片/);
 f.host.modelFacts.accepts=()=>true;result=await f.auto.actions(f.model.id);assert(result.blobs.length<=6);assert.equal(JSON.parse(result.text).evidence.length,result.blobs.length);
});

test('motion-based faces trigger once on face changes and invalid expression blends are isolated',()=>{
 const player=createNativeActions({resources:[{id:'face',kind:'motion',seconds:1,data:motion(0,1)},{id:'bad',kind:'expression',data:{Parameters:[{Id:'ParamSmile',Value:1,Blend:'unknown'}]}}],bindings:[{word:'happy',resource:'face'}]},{warn(){}});
 player.update({face:'happy'},.1);assert.equal(player.state().motion,'face');
 for(let i=0;i<20;i++)player.update({face:'happy'},.1);
 assert.equal(player.state().motion,null);assert.deepEqual(player.failed,['bad']);
 player.update({face:'neutral'},.1);player.update({face:'happy'},.1);assert.equal(player.state().motion,'face');
});
test('import notifications are opt-in, source-tagged external data, and deduplicated',async t=>{
 const f=await automation(t);const result={token:'one',models:[{dir:'role'}],packs:[]};
 await f.auto.imported(result,()=>f.dir);await f.auto.imported(result,()=>f.dir);
 assert.equal(f.events.length,1);assert.equal(f.events[0].type,'figure.imported');assert.equal(f.events[0].origin,'external');
 f.cfg.assistMotions=false;await f.auto.imported({...result,token:'two'},()=>f.dir);assert.equal(f.events.length,1);
});

test('the real World import entry delivers an analysis event through its started host',async t=>{
 const f=await fixture(t),events=[];
 const world=LIVE2D.create(makeCtx(f.root,{enabled:true,assistMotions:true,assistGear:'text',figuresDir:join(f.root,'installed')}));
 await world.start({pushEvent:async e=>{events.push(e);return{...e,cursor:events.length};}});t.after(()=>world.stop());
 const invoke=(method,args=[])=>world.webUi('zh').invoke('workbench',method,args);
 const staged=await invoke('importPaths',[[f.dir]]);assert.equal(staged.models.length,1);
 assert.equal(events.length,1,JSON.stringify((await invoke('state')).log));assert.equal(events[0].type,'figure.imported');
 await invoke('importCancel',[staged.token]);
});

test('uploaded AI inputs survive closing the panel; cache expiry respects active proposals and original folders',async t=>{
 const f=await fixture(t),importer=new PackImporter();t.after(()=>importer.cancel());
 const bytes=value=>Buffer.from(JSON.stringify(value));
 const staged=await importer.stage([{path:'角色.model3.json',bytes:bytes({FileReferences:{Moc:'角色.moc3'}})},{path:'角色.moc3',bytes:Buffer.from('fixture')},{path:'Animation/点头.motion3.json',bytes:bytes(motion(0,1))}],true,new Map());
 const cache=join(f.root,'automation-inputs'),paths=await importer.preserveForAutomation(staged.token,cache),kept=paths.get(staged.models[0].dir);
 await importer.cancel(staged.token);const model=(await findModels(kept)).models[0];assert.equal((await inspectNative(model)).resources.length,1);
 const marker=join(cache,staged.token,'.figure-import-cache'),old=new Date(Date.now()-2*3600000);await utimes(marker,old,old);
 await importer.pruneAutomationInputs(cache,[kept]);assert.equal((await findModels(kept)).models.length,1);
 await importer.pruneAutomationInputs(cache);assert.equal((await findModels(kept)).models.length,0);
 const local=await importer.stageLocal([f.dir],new Map()),originals=await importer.preserveForAutomation(local.token,cache);
 assert.equal(originals.get(local.models[0].dir),f.dir);await importer.cancel(local.token);assert.equal((await findModels(f.dir)).models.length,1);
});
test('motion curves support linear, bezier and both step modes; invalid curves fail individually',()=>{
 assert.equal(compileCurve({Segments:[0,0,0,1,1]})(.5),.5);
 assert.equal(compileCurve({Segments:[0,0,2,1,1]})(.5),0);
 assert.equal(compileCurve({Segments:[0,0,3,1,1]})(.5),1);
 assert(Math.abs(compileCurve({Segments:[0,0,1,.25,.25,.75,.75,1,1]})(.5)-.5)<.001);
 assert.throws(()=>compileCurve({Segments:[0,0,9,1,1]}));
 const player=createNativeActions({resources:[{id:'bad',kind:'motion',data:{Curves:[{Id:'x',Target:'Parameter',Segments:[0]}]}}],bindings:[]},{warn(){}});assert.deepEqual(player.failed,['bad']);assert.deepEqual(player.update(),[]);
});
test('native playback owns only its channels, clamps values and returns to generic behavior',()=>{
 const player=createNativeActions({resources:[{id:'wave',kind:'motion',seconds:1,data:motion(0,1)}],bindings:[{word:'wave',resource:'wave'}]});
 player.trigger('wave');let values;for(let i=0;i<5;i++)values=player.update({gesture:{kind:'wave'}},.1);
 assert(values.some(v=>v.id==='ParamArm'&&v.value>.4));
 const parameters=[0,.7],parts=[0];const model={getParameterValueByIndex:i=>parameters[i],setParameterValueByIndex:(i,v)=>parameters[i]=v,getParameterMinimumValue:()=>-1,getParameterMaximumValue:()=>1,getPartOpacityByIndex:i=>parts[i],setPartOpacityByIndex:(i,v)=>parts[i]=v};
 applyNativeValues(values,model,new Map([['ParamArm',0],['unowned',1]]),new Map([['PartArm',0]]));assert.equal(parameters[1],.7);assert(parameters[0]>.4);
 for(let i=0;i<20;i++)player.update({},.1);assert.equal(player.state().motion,null);assert.deepEqual(player.update({},.1),[]);
});
