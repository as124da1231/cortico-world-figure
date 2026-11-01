import {test} from 'node:test';import assert from 'node:assert/strict';
import {wardrobeConfig,wardrobeTracks,createWardrobe} from '../workbench/pack/backends/wardrobe.js';
const expression=(id,param,value,blend='Overwrite')=>({id,kind:'expression',raw:{Parameters:[{Id:param,Value:value,Blend:blend}]}});
const catalog={resources:[expression('on','Glasses',1),expression('off','Glasses',0),expression('hat','Hat',1),expression('emotion','Mouth',.5)]};
const groups=[{id:'lookglasses',name:'眼镜',options:[{id:'on',name:'戴上',resource:'on'},{id:'off',name:'摘下',resource:'off'}]},{id:'lookhat',name:'帽子',options:[{id:'on',name:'戴帽子',resource:'hat'}]}];
test('wardrobe validates independent axes and rejects conflicting groups, action channels and unsafe IDs',()=>{
 assert.equal(wardrobeConfig(catalog,groups).groups.length,2);
 assert.throws(()=>wardrobeConfig(catalog,[...groups,{id:'lookother',name:'冲突',options:[{id:'on',name:'同参数',resource:'on'}]}]),/共用参数/);
 assert.throws(()=>wardrobeConfig(catalog,groups,[{word:'happy',resource:'on'}]),/共用参数/);
 assert.throws(()=>wardrobeConfig(catalog,[{...groups[0],options:[{id:'bad-id',name:'错误',resource:'on'}]}]),/选项无效/);
 assert.throws(()=>wardrobeConfig(catalog,[{...groups[0],id:'model'}]),/分组无效/);
 const modelOnly={id:'model-only',kind:'motion',raw:{Curves:[{Id:'Opacity',Target:'Model',Segments:[0,1]}]}};
 assert.equal(wardrobeConfig({resources:[...catalog.resources,modelOnly]},groups,[{word:'wave',resource:'model-only'}]).groups.length,2);
 assert.throws(()=>wardrobeConfig(catalog,groups,[{word:'wave',resource:'emotion',release:'hat'}]),/共用参数/);
});
test('outfits persist across expression writes, same-axis picks exclude each other, defaults restore the original appearance',()=>{
 const values=[.2,0,.7],parts=[1],model={getParameterDefaultValue:i=>[.2,0,.7][i],getParameterMinimumValue:()=>0,getParameterMaximumValue:()=>1,getPartOpacityByIndex:i=>parts[i],setPartOpacityByIndex:(i,v)=>parts[i]=v,setParameterValueByIndex:(i,v)=>values[i]=v};
 const wardrobe=createWardrobe(model,new Map([['Glasses',0],['Hat',1],['Mouth',2]]),new Map([['Arm',0]]));wardrobe.configure(wardrobeConfig(catalog,groups));wardrobe.scheme('model-on-on');
 for(let i=0;i<4;i++){values[0]=.3;values[2]=.4;wardrobe.apply();assert.deepEqual(values,[1,1,.4]);}
 wardrobe.scheme('model-off-on');wardrobe.apply();assert.deepEqual(values,[0,1,.4]);wardrobe.scheme('model-default-default');wardrobe.apply();assert.deepEqual(values,[.2,0,.4]);
 wardrobe.select({lookglasses:'unknown'});wardrobe.apply();assert.equal(values[0],.2);
});
test('add/multiply use model defaults without accumulation; motion options hold their final parameter and part values',()=>{
 const motion={id:'pose',kind:'motion',raw:{Curves:[{Id:'Arm',Target:'PartOpacity',Segments:[0,1,0,1,0]},{Id:'Glasses',Target:'Parameter',Segments:[0,0,0,1,.6]}]}};assert.deepEqual(wardrobeTracks(motion).map(t=>t.value),[0,.6]);
 const values=[.2],parts=[1],model={getParameterDefaultValue:()=>.2,getParameterMinimumValue:()=>0,getParameterMaximumValue:()=>1,getPartOpacityByIndex:i=>parts[i],setPartOpacityByIndex:(i,v)=>parts[i]=v,setParameterValueByIndex:(i,v)=>values[i]=v};
 const wardrobe=createWardrobe(model,new Map([['Glasses',0]]),new Map([['Arm',0]]),{parts:{Arm:.25}});
 wardrobe.configure(wardrobeConfig({resources:[expression('add','Glasses',.3,'Add')]},[{id:'lookg',name:'眼镜',options:[{id:'on',name:'戴',resource:'add'}]}]));wardrobe.select({lookg:'on'});for(let i=0;i<5;i++)wardrobe.apply();assert.equal(values[0],.5);
 wardrobe.configure(wardrobeConfig({resources:[motion]},[{id:'lookg',name:'状态',options:[{id:'on',name:'末帧',resource:'pose'}]}]));wardrobe.select({lookg:'on'});wardrobe.apply();assert.equal(parts[0],0);assert.equal(values[0],.6);wardrobe.select({});wardrobe.apply();assert.equal(parts[0],.25);assert.equal(values[0],.2);
});
