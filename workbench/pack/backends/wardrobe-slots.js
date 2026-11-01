export const WARDROBE_SLOTS = [
  {slot:'outfit',id:'lookoutfit',name:'装扮',en:'Outfit'},
  {slot:'parts',id:'lookparts',name:'部件',en:'Parts'},
  {slot:'accessories',id:'lookaccessories',name:'配饰',en:'Accessories'},
];

// Preserve legacy axis/option IDs so existing picks survive the next save.
export function fixedWardrobeGroups(groups=[]) {
  if(!Array.isArray(groups)||groups.length>3)throw Error('最多支持装扮、部件、配饰三个栏位；旧分组超出上限时保留原包');
  const assigned=new Map(),pending=[];
  for(const group of groups){
    if(!group||typeof group!=='object'||!Array.isArray(group.options))throw Error('装扮分组无效');
    const slot=group.slot?WARDROBE_SLOTS.find(s=>s.slot===group.slot):WARDROBE_SLOTS.find(s=>s.name===group.name||s.en===group.name);
    if(group.slot&&!slot||slot&&assigned.has(slot.slot))throw Error('装扮栏位重复或无效');
    if(slot)assigned.set(slot.slot,group);else pending.push(group);
  }
  for(const slot of WARDROBE_SLOTS)if(!assigned.has(slot.slot)&&pending.length)assigned.set(slot.slot,pending.shift());
  const used=new Set(groups.map(g=>g.id));
  return WARDROBE_SLOTS.map(slot=>{
    const group=assigned.get(slot.slot);let id=group?.id||slot.id;
    if(!group&&used.has(id)){let n=1;while(used.has(id=slot.id+n))n++;}used.add(id);
    return {id,slot:slot.slot,name:slot.name,options:(group?.options||[]).map(o=>({...o}))};
  });
}
