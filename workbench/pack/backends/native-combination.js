// Shared by the editor, catalog validation and packaged player.
export const MAX_EXPRESSIONS = 8;
export const bindingResourceIds = b => [b.resource, ...(b.overlays || []), b.release].filter(Boolean);
export function expressionTracks(resources) {
  const channels = new Map();
  for (const resource of resources) {
    const data = resource.raw || resource.data;
    const parameters = data?.Parameters || resource.parameters || [];
    for (const p of parameters) {
      const id = p.Id ?? p.id, value = Number(p.Value ?? p.value), blend = p.Blend ?? p.blend ?? 'Add';
      if (typeof id !== 'string' || !Number.isFinite(value) || !['Add','Multiply','Overwrite'].includes(blend)) throw Error('表情参数无效');
      const old = channels.get(id) || {id, target:'Parameter', blend:'Affine', scale:1, value:0, owner:resource.title || resource.id};
      if (blend === 'Overwrite') {
        if (old.operations && (old.overwrite === undefined || old.overwrite !== value)) throw Error(`「${resource.title || resource.id}」与「${old.owner}」冲突：${id}`);
        old.overwrite = value; old.scale = 0; old.value = value;
      } else {
        if (old.overwrite !== undefined) throw Error(`「${resource.title || resource.id}」与「${old.owner}」冲突：${id}`);
        if (blend === 'Multiply') old.scale *= value;
        else old.value += value;
      }
      old.operations = true;
      if (!Number.isFinite(old.scale) || !Number.isFinite(old.value)) throw Error('表情组合超出数值范围');
      channels.set(id, old);
    }
  }
  // Cubism expression semantics: (base + additive) * multiply.
  return [...channels.values()].map(t=>({...t,value:t.overwrite===undefined?t.value*t.scale:t.value}));
}
export function validateExpressionOverlays(catalog, resource, overlays = []) {
  if (!Array.isArray(overlays) || overlays.length >= MAX_EXPRESSIONS || overlays.some(id => typeof id !== 'string') || new Set([resource,...overlays]).size !== overlays.length+1) throw Error('表情组合无效，最多选择 8 个不同效果');
  if (!overlays.length) return [];
  const selected = [resource,...overlays].map(id => catalog.resources.find(r => r.id === id));
  if (selected.some(r => !r || r.kind !== 'expression' || r.classification === 'appearance')) throw Error('组合只接受可绑定的原生表情');
  expressionTracks(selected);
  return [...overlays].sort();
}
