import {compileCurve} from './native-actions.js';
const channel=t=>(t.target||'Parameter')+':'+t.id;
export function wardrobeChannels(resource){
  const raw=resource?.raw||resource?.data;
  return [...new Set(resource?.kind==='expression'?(raw?.Parameters||[]).map(p=>'Parameter:'+p.Id):(raw?.Curves||[]).filter(c=>['Parameter','PartOpacity'].includes(c.Target)).map(c=>c.Target+':'+c.Id))];
}
export function wardrobeTracks(resource){
  const raw=resource.raw||resource.data,tracks=resource.kind==='expression'?(raw?.Parameters||[]).map(p=>({id:p.Id,target:'Parameter',value:Number(p.Value),blend:p.Blend||'Add'})):(raw?.Curves||[]).filter(c=>['Parameter','PartOpacity'].includes(c.Target)).map(c=>({id:c.Id,target:c.Target,value:compileCurve(c)(Infinity),blend:'Overwrite'}));
  if(!tracks.length||tracks.length>2048||tracks.some(t=>typeof t.id!=='string'||!t.id||!Number.isFinite(t.value)||!['Add','Multiply','Overwrite'].includes(t.blend))||new Set(tracks.map(channel)).size!==tracks.length)throw Error('资源没有可用的外观状态');
  return tracks;
}
export function wardrobeConfig(catalog,groups=[],bindings=[],axisOffset=1){
  if(!Array.isArray(groups)||groups.length>8)throw Error('最多支持 8 个装扮组');
  const resources=new Map(catalog.resources.map(r=>[r.id,r])),used=new Set(),owners=new Map(),ids=new Set();
  for(const binding of bindings)for(const id of [binding.resource,binding.release].filter(Boolean))for(const key of wardrobeChannels(resources.get(id)))owners.set(key,'动作');
  const clean=groups.map(g=>{
    if(!/^look[a-z0-9]{1,24}$/.test(g.id)||ids.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.length>40||!Array.isArray(g.options)||g.options.length>16)throw Error('装扮分组无效');ids.add(g.id);
    const options=new Set(['default']);return {id:g.id,name:g.name.trim(),options:g.options.map(o=>{
      if(!/^[a-z0-9]{1,24}$/.test(o.id)||options.has(o.id)||typeof o.name!=='string'||!o.name.trim()||o.name.length>60||!resources.has(o.resource))throw Error('装扮选项无效');options.add(o.id);
      for(const t of wardrobeTracks(resources.get(o.resource))){const key=channel(t),owner=owners.get(key);if(owner&&owner!==g.id)throw Error('装扮与动作或其他分组共用参数，请调整绑定');owners.set(key,g.id);}used.add(o.resource);
      return {id:o.id,name:o.name.trim(),resource:o.resource};
    })};
  });
  return {version:1,axisOffset,groups:clean,resources:[...used].map(id=>({id,tracks:wardrobeTracks(resources.get(id))}))};
}
export function createWardrobe(model,paramIndex,partIndex,defaults={}){
  let config={groups:[],resources:[],axisOffset:1},picks={},owned=new Map();
  const partDefaults=new Map([...partIndex].map(([id,i])=>[id,defaults.parts?.[id]??model.getPartOpacityByIndex(i)]));
  const base=t=>t.target==='PartOpacity'?partDefaults.get(t.id):paramIndex.has(t.id)?defaults.params?.[t.id]??model.getParameterDefaultValue(paramIndex.get(t.id)):undefined;
  function write(t,value){if(!Number.isFinite(value))return;const i=(t.target==='PartOpacity'?partIndex:paramIndex).get(t.id);if(i===undefined)return;if(t.target==='PartOpacity')model.setPartOpacityByIndex(i,Math.max(0,Math.min(1,value)));else model.setParameterValueByIndex(i,Math.max(model.getParameterMinimumValue(i),Math.min(model.getParameterMaximumValue(i),value)));}
  function reset(){for(const t of owned.values())write(t,base(t));}
  return {
    configure(next){reset();config=next||{groups:[],resources:[]};owned=new Map((config.resources||[]).flatMap(r=>r.tracks.map(t=>[channel(t),t])));picks={};},
    select(next){picks={...next};},
    scheme(value){const values=String(value||'').split('-').slice(config.axisOffset||0);picks=Object.fromEntries(config.groups.map((g,i)=>[g.id,values[i]||'default']));},
    apply(){reset();for(const g of config.groups){const option=g.options.find(o=>o.id===picks[g.id]);const r=option&&config.resources.find(r=>r.id===option.resource);for(const t of r?.tracks||[]){const def=base(t);write(t,t.blend==='Add'?def+t.value:t.blend==='Multiply'?def*t.value:t.value);}}},
    state:()=>({...picks}),
    inspect:()=>[...owned.values()].slice(0,256).map(t=>({id:t.id,target:t.target,value:t.target==='PartOpacity'&&partIndex.has(t.id)?model.getPartOpacityByIndex(partIndex.get(t.id)):paramIndex.has(t.id)?model.getParameterValueByIndex(paramIndex.get(t.id)):undefined})),
  };
}
