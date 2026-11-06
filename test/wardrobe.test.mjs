import {test} from 'node:test';import assert from 'node:assert/strict';
import {wardrobeConfig,wardrobeTracks,createWardrobe} from '../workbench/pack/backends/wardrobe.js';
import {fixedWardrobeGroups} from '../workbench/pack/backends/wardrobe-slots.js';
const expression=(id,param,value,blend='Overwrite')=>({id,kind:'expression',raw:{Parameters:[{Id:param,Value:value,Blend:blend}]}});
const catalog={resources:[expression('on','Glasses',1),expression('off','Glasses',0),expression('hat','Hat',1),expression('emotion','Mouth',.5)]};
const groups=[{id:'lookglasses',name:'眼镜',options:[{id:'on',name:'戴上',resource:'on'},{id:'off',name:'摘下',resource:'off'}]},{id:'lookhat',name:'帽子',options:[{id:'on',name:'戴帽子',resource:'hat'}]}];
test('wardrobe validates independent axes and rejects conflicting groups, action channels and unsafe IDs',()=>{
 assert.equal(wardrobeConfig(catalog,groups).groups.length,3);
 assert.throws(()=>wardrobeConfig(catalog,[...groups,{id:'lookother',name:'冲突',options:[{id:'on',name:'同参数',resource:'on'}]}]),/共用参数/);
 assert.throws(()=>wardrobeConfig(catalog,groups,[{word:'happy',resource:'on'}]),/共用参数/);
 assert.throws(()=>wardrobeConfig(catalog,[{...groups[0],options:[{id:'bad-id',name:'错误',resource:'on'}]}]),/选项无效/);
 assert.throws(()=>wardrobeConfig(catalog,[{...groups[0],id:'bad-id'}]),/分组无效/);
 const modelOnly={id:'model-only',kind:'motion',raw:{Curves:[{Id:'Opacity',Target:'Model',Segments:[0,1]}]}};
 assert.equal(wardrobeConfig({resources:[...catalog.resources,modelOnly]},groups,[{word:'wave',resource:'model-only'}]).groups.length,3);
 assert.throws(()=>wardrobeConfig(catalog,groups,[{word:'wave',resource:'emotion',release:'hat'}]),/共用参数/);
});
test('three fixed slots keep legacy IDs; extra groups are appended as custom slots',()=>{
 const old=[{...groups[0],name:'装扮'},groups[1]],fixed=fixedWardrobeGroups(old);assert.deepEqual(fixed.map(g=>g.name),['装扮','部件','配饰']);assert.equal(fixed[0].id,'lookglasses');assert.deepEqual(fixed[1].options,old[1].options);assert.deepEqual(fixedWardrobeGroups(fixed),fixed);
  const out=fixedWardrobeGroups([...old,{id:'looka',custom:true,name:'发型',en:'Hair',options:[]}]);assert.equal(out.length,4);assert.equal(out[3].name,'发型');assert.equal(out[3].en,'Hair');assert.deepEqual(fixedWardrobeGroups(out),out);assert.equal(old[1].name,'帽子');
 assert.throws(()=>wardrobeConfig(catalog,[{...old[0],options:[{id:'bad',name:'多个',resource:['on','hat']}]}]),/选项无效/);
});
test('one native resource in each fixed slot produces three simultaneous held states',()=>{
 const resources=[expression('coat','Coat',1),expression('parts','Parts',.8),expression('glasses','Glasses',.5)],slots=fixedWardrobeGroups();slots.forEach((g,i)=>g.options=[{id:'on',name:'开',resource:resources[i].id}]);
 const values=[0,0,0],model={getParameterDefaultValue:()=>0,getParameterMinimumValue:()=>0,getParameterMaximumValue:()=>1,setParameterValueByIndex:(i,v)=>values[i]=v};
 const wardrobe=createWardrobe(model,new Map([['Coat',0],['Parts',1],['Glasses',2]]),new Map());wardrobe.configure(wardrobeConfig({resources},slots));wardrobe.scheme('model-on-on-on');wardrobe.apply();assert.deepEqual(values,[1,.8,.5]);wardrobe.scheme('model-on-default-on');wardrobe.apply();assert.deepEqual(values,[1,0,.5]);wardrobe.select({});wardrobe.apply();assert.deepEqual(values,[0,0,0]);
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

test('custom group ids pass validation and keep their options',()=>{
  const custom={id:'g1a2b3c4d5e6f',custom:true,name:'发型',en:'Hair',options:[{id:'on',name:'马尾',resource:'emotion'}]};
  const out=wardrobeConfig(catalog,[...groups,custom]);
  assert.equal(out.groups.length,4);
  assert.equal(out.groups[3].id,'g1a2b3c4d5e6f');
  assert.equal(out.groups[3].options[0].resource,'emotion');
  assert.deepEqual(fixedWardrobeGroups([...groups,custom]).map(g=>g.name),['装扮','部件','配饰','发型']);
});
