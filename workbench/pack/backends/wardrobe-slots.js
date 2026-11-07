export const WARDROBE_SLOTS = [
  {slot:'outfit',id:'lookoutfit',name:'装扮',en:'Outfit'},
  {slot:'parts',id:'lookparts',name:'部件',en:'Parts'},
  {slot:'accessories',id:'lookaccessories',name:'配饰',en:'Accessories'},
];

// Preserve legacy axis/option IDs so existing picks survive the next save.
// 内置三栏固定在最前；其余分组（自定义）按原顺序追加在后面。
export function fixedWardrobeGroups(groups=[]) {
  if(!Array.isArray(groups))throw Error('装扮分组无效');
  const assigned=new Map(),waiting=[],custom=[];
  for(const group of groups){
    if(!group||typeof group!=='object'||!Array.isArray(group.options))throw Error('装扮分组无效');
    if(group.custom&&!group.slot){custom.push(group);continue;}
    const slot=group.slot?WARDROBE_SLOTS.find(s=>s.slot===group.slot):WARDROBE_SLOTS.find(s=>s.name===group.name||s.en===group.name);
    if(group.slot&&!slot)throw Error('装扮栏位无效');
    if(slot){if(assigned.has(slot.slot))throw Error('装扮栏位重复');assigned.set(slot.slot,group);}
    else waiting.push(group);
  }
  // 老包可能没有 slot 字段：按顺序补进空着的内置栏。
  for(const slot of WARDROBE_SLOTS)if(!assigned.has(slot.slot)&&waiting.length)assigned.set(slot.slot,waiting.shift());
  custom.push(...waiting);

  const used=new Set();
  const unique=base=>{let id=base,n=1;while(used.has(id))id=`${base}${n++}`;used.add(id);return id;};

  const out=[];
  for(const slot of WARDROBE_SLOTS){
    const group=assigned.get(slot.slot);
    const id=unique(group?.id||slot.id);
    out.push({id,slot:slot.slot,name:slot.name,options:(group?.options||[]).map(o=>({...o}))});
  }
  for(const group of custom){
    if(!group.options.length&&!String(group.name||'').trim())continue;
    const id=unique(String(group.id||'').trim()||`custom${out.length+1}`);
    out.push({
      id,
      custom: true,
      name:String(group.name||id),
      ...(group.en?{en:String(group.en)}:{}),
      options:group.options.map(o=>({...o})),
    });
  }
  return out;
}
