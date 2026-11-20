import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expressionTracks,validateExpressionOverlays,bindingResourceIds} from '../workbench/pack/backends/native-combination.js';
import {createNativeActions,applyNativeValues,captureMotionLocks} from '../workbench/pack/backends/native-actions.js';
import {wardrobeConfig} from '../workbench/pack/backends/wardrobe.js';
import {nativeConfig,validateBindings} from '../workbench/tools/native-catalog.mjs';
import {manualPreviewPlan} from '../src/manual-preview.ts';
import {bindingKey,confirmationReasons,reviewSamples} from '../src/analysis.mjs';
const expr=(id,param,value=1,blend='Add')=>({id,title:id,kind:'expression',classification:'expression',seconds:1,parameters:[{id:param,value,blend}],raw:{Parameters:[{Id:param,Value:value,Blend:blend}]}});
const catalog={resources:[expr('loading','key8'),expr('eyes','key3'),expr('otherEyes','key3',0,'Overwrite')],warnings:[]};
const binding={word:'thinking',resource:'loading',overlays:['eyes'],confidence:1};
const valueMap=values=>{const result=new Map([['key8',0],['key3',0]]);const ids=[...result.keys()];applyNativeValues(values,{getParameterValueByIndex:i=>result.get(ids[i]),setParameterValueByIndex:(i,v)=>result.set(ids[i],v),getParameterMinimumValue:()=>-10,getParameterMaximumValue:()=>10},new Map(ids.map((v,i)=>[v,i])),new Map());return result;};
test('animation-only motion owns shared channels through later writes, then hands them back',()=>{
 const motion={id:'move',kind:'motion',classification:'gesture',seconds:1,raw:{Curves:[
  {Id:'Hat',Target:'Parameter',Segments:[0,1,0,1,1]},
  {Id:'Hand',Target:'PartOpacity',Segments:[0,.8,0,1,.8]},
 ]}};
 const hat={...expr('hat','Hat',0,'Overwrite'),classification:'appearance'};
 const modelCatalog={resources:[motion,hat]};
 const groups=[{id:'lookhat',name:'配饰',options:[{id:'hat',name:'帽子',resource:'hat'}]}];
 const binding={word:'happy',resource:'move',nativeOnly:true};
 assert.throws(()=>wardrobeConfig(modelCatalog,groups,[{...binding,nativeOnly:false}]),/共用参数/);
 const configured=nativeConfig(modelCatalog,[binding]);
 assert.equal(configured.bindings[0].nativeOnly,true);
 assert.equal(wardrobeConfig(modelCatalog,groups,configured.bindings).resources[0].id,'hat');
 const player=createNativeActions(configured);
 let param=0,part=0;
 const model={getParameterValueByIndex:()=>param,setParameterValueByIndex:(_,v)=>{param=v;},getParameterMinimumValue:()=>0,getParameterMaximumValue:()=>1,getPartOpacityByIndex:()=>part,setPartOpacityByIndex:(_,v)=>{part=v;}};
 const params=new Map([['Hat',0]]),parts=new Map([['Hand',0]]);
 const frame={face:'happy'};
 player.trigger('happy');
 player.update(frame,.1);
 const locks=captureMotionLocks(player.update(frame,.1),model,params,parts);
 param=0;part=0;
 applyNativeValues(locks,model,params,parts);
 assert.equal(param,1);assert.equal(part,.8);
 for(let i=0;i<12;i++)player.update(frame,.1);
 assert(!player.update(frame,.1).some(track=>track.nativeOnly));
 const preview=manualPreviewPlan(modelCatalog,{page:'actions',word:'happy',resource:'move',bindings:configured.bindings,groups,picks:{lookhat:'hat'},raw:false,nativeOnly:true});
 assert(preview.samples.every(sample=>sample.nativeOnly&&sample.word===undefined));
});
test('loading and circle eyes survive packing, sampling, playback and removal independently',()=>{
 const config=nativeConfig(catalog,[binding,{word:'happy',resource:'eyes'}]);assert.equal(config.version,2);assert.equal(config.resources.length,2);
 const player=createNativeActions(config);player.sample('loading',0,['eyes']);assert.deepEqual([...valueMap(player.update())],[['key8',1],['key3',1]]);player.clearSample();
 assert.equal(player.hasExpression('thinking'),true);assert.equal(player.hasExpression('neutral'),false);
 for(let i=0;i<20;i++)assert(valueMap(player.update({face:'thinking'},.05)).get('key8')<=1);
 assert.deepEqual([...valueMap(player.update({face:'thinking'},.05))],[['key8',1],['key3',1]]);
 for(let i=0;i<8;i++){const values=valueMap(player.update({face:'happy'},.05));assert.equal(values.get('key3'),1);}
 assert.equal(valueMap(player.update({face:'happy'},.05)).get('key8'),0);
 for(let i=0;i<8;i++)player.update({face:'neutral'},.05);
 assert.deepEqual([...valueMap(player.update({face:'neutral'},.05))],[['key8',0],['key3',0]]);
});
test('shared arithmetic follows Cubism (base + add) * multiply regardless of selection order',()=>{
 const add=expr('a','key8',.5),mul=expr('m','key8',.2,'Multiply');
 assert.equal(expressionTracks([add,mul])[0].value,.1);assert.equal(expressionTracks([mul,add])[0].value,.1);
 const same=expr('same','key3',0,'Overwrite');assert.equal(expressionTracks([same,same])[0].scale,0);
 assert.throws(()=>expressionTracks([same,expr('open','key3',1,'Overwrite')]),/冲突/);
 assert.throws(()=>validateExpressionOverlays(catalog,'loading',['loading']),/无效/);
 assert.throws(()=>validateExpressionOverlays(catalog,'loading',['missing']),/原生表情/);
});
test('same closed-eye target never opens during combination transitions or interruptions',()=>{
 const c={resources:[expr('closed','key3',0,'Multiply'),expr('loading','key8')]};
 const p=createNativeActions(nativeConfig(c,[{word:'happy',resource:'closed'},{word:'thinking',resource:'closed',overlays:['loading']}]));
 for(let i=0;i<8;i++)p.update({face:'happy'},.05);
 for(const face of ['thinking','happy','thinking','happy']){const v=p.update({face},.05).find(v=>v.id==='key3');assert.equal(v.scale,0);}
});
test('preview and AI proof identify the entire recipe, not only its first resource',()=>{
 const plan=manualPreviewPlan(catalog,{page:'actions',raw:false,word:'thinking',resource:'loading',overlays:['eyes'],bindings:[binding],picks:{},groups:[]});
 assert.deepEqual(plan.samples[1].overlays,['eyes']);assert.deepEqual(bindingResourceIds(binding),['loading','eyes']);
 assert.notEqual(bindingKey(binding),bindingKey({...binding,overlays:[]}));assert.deepEqual(reviewSamples(catalog,binding)[2].overlays,['eyes']);
 assert(confirmationReasons(catalog,[binding],{adaptationMode:'ai',assistGear:'text'},{visual:['loading','eyes'],review:[]}).some(s=>s.includes('整体对照')));
 assert.throws(()=>validateBindings(catalog,[{...binding,overlays:['eyes','otherEyes']}]),/冲突/);
});
