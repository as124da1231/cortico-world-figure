const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The kit already adds 12 × talk to gap. Remove it before adding our text pulse. */
export function bubbleMouthPose(gap, talk, expression, gain = 1) {
  const pulse = Number.isFinite(talk) ? clamp(talk, 0, 1) : 0;
  const expressionGap = Number.isFinite(gap) ? gap - 50 - 12 * pulse : 0;
  const base = clamp(Math.max(expressionGap / 22, Number.isFinite(expression) ? expression : 0), 0, 1);
  return {
    base,
    open: clamp(base + pulse * 0.45 * gain, 0, 1),
    weight: clamp(pulse / 0.08, 0, 1),
  };
}

/** Cubism packs 36 unique clipping groups into one texture, or 32 per
 * texture when multiple buffers are used. Count groups, not masked meshes. */
export function maskBufferCount(masks) {
  const unique = new Set();
  for (const mask of masks ?? []) if (mask?.length) unique.add(Array.from(mask).sort((a, b) => a - b).join(','));
  return unique.size <= 36 ? 1 : Math.ceil(unique.size / 32);
}

/** Convert a semantic role to model space. Optional endpoints apply only to
 * calibrated inputs; the model's own neutral value remains the anchor. */
export function roleValue(value, space, neutral, model, endpoints) {
  const [lo, hi] = space;
  const v = clamp(value, lo, hi);
  let low = model.min; let high = model.max;
  if (Array.isArray(endpoints) && endpoints.length === 2 && endpoints.every(Number.isFinite)) {
    const a = clamp(endpoints[0], model.min, model.max);
    const b = clamp(endpoints[1], model.min, model.max);
    if (a !== b && Math.min(a, b) <= model.def && Math.max(a, b) >= model.def) {
      low = a; high = b;
    }
  }
  const result = v >= neutral
    ? model.def + (hi === neutral ? 0 : (v - neutral) / (hi - neutral)) * (high - model.def)
    : model.def + (neutral === lo ? 0 : (neutral - v) / (neutral - lo)) * (low - model.def);
  return clamp(result, model.min, model.max);
}
