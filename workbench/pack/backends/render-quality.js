const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
export const QUALITY_MODES = ['economy', 'balanced', 'high', 'original'];

/** Zero means no software limit, not an unlimited GPU. */
export function qualityPolicy(config = {}) {
  const mode = QUALITY_MODES.includes(config.quality) ? config.quality : 'balanced';
  const preset = {economy:1024, balanced:2048, high:4096}[mode];
  const custom = ['512','1024','2048','4096'].includes(String(config.texture)) ? Number(config.texture) : 0;
  return {mode, textureLimit:preset ?? custom, canvasLimit:preset ?? 0, strict:mode === 'original'};
}

export function graphicsLimits(gl) {
  const texture = positive(gl.getParameter(gl.MAX_TEXTURE_SIZE), 0);
  const buffer = positive(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 0);
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
  const canvas = Math.min(texture, buffer, positive(viewport?.[0], 0), positive(viewport?.[1], 0));
  if (!texture || !canvas) throw Error('无法读取显卡的渲染尺寸限制');
  return {texture, canvas};
}

/** Largest stretch of the SVG transform, independent of rotation. */
export function displayPixels(matrix, rect, box = 256) {
  if (matrix && [matrix.a,matrix.b,matrix.c,matrix.d].every(Number.isFinite)) {
    const trace = matrix.a**2 + matrix.b**2 + matrix.c**2 + matrix.d**2;
    const determinant = matrix.a*matrix.d - matrix.b*matrix.c;
    const scale = Math.sqrt((trace + Math.sqrt(Math.max(0, trace**2 - 4*determinant**2))) / 2);
    if (scale > 0) return box * scale;
  }
  return Math.max(positive(rect?.width, box), positive(rect?.height, box));
}

export function resolutionPlan(cssPixels, dpr, policy, limits) {
  const desired = Math.max(128, Math.ceil(positive(cssPixels,256) * positive(dpr,1) / 128) * 128);
  const maximum = Math.floor(Math.min(limits.canvas, policy.canvasLimit || Infinity));
  return {desired, size:Math.min(desired,maximum), hardwareLimited:desired>limits.canvas,
    warning:policy.strict && desired>limits.canvas ? `原图渲染需要 ${desired}px，设备上限为 ${limits.canvas}px，实际按设备上限绘制。` : ''};
}

export function texturePlan(width, height, policy, limits) {
  const largest = Math.max(width,height);
  if (policy.strict && Math.min(largest,policy.textureLimit || Infinity) > limits.texture) throw Error(`贴图 ${width}×${height} 超过设备上限 ${limits.texture}px，无法保持所选精度。`);
  const max = Math.min(limits.texture, policy.textureLimit || Infinity);
  const ratio = Math.min(1,max/largest);
  return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio)),scaled:ratio<1};
}
