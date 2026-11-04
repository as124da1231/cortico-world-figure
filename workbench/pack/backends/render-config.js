import { maskBufferCount } from './role-values.js';

/** Prefer packed masks; on allocation failure use one reusable high-precision
 * mask, then reduce its resolution. Never continue with incomplete buffers. */
export function createAdaptiveRenderer(model, gl, width, height, {strict = false, maskSize = 512} = {}) {
  const count = maskBufferCount(model._model.getDrawableMasks());
  const attempts = [
    { count, size: maskSize, precise: false, mode: 'packed' },
    { count: 1, size: maskSize, precise: true, mode: 'compatible' },
    ...(!strict ? [{ count: 1, size: Math.min(256,maskSize), precise: true, mode: 'reduced' }] : []),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      model.createRenderer(width, height, attempt.count);
      const renderer = model.getRenderer();
      renderer.setClippingMaskBufferSize(attempt.size);
      if (attempt.precise) renderer.useHighPrecisionMask(true);
      renderer.startUp(gl);
      if (renderer._offscreenClippingManager) {
        renderer._offscreenClippingManager.setClippingMaskBufferSize(attempt.size);
        const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        try {
          for (const buffer of renderer._offscreenMasks || []) if (!buffer.createRenderTarget(gl,attempt.size,attempt.size,previous)) throw Error('Offscreen clipping mask allocation failed');
        } finally { gl.bindFramebuffer(gl.FRAMEBUFFER,previous); }
      }
      // The bundled SDK logs failed allocations without throwing. Its mask
      // render targets expose isValid(); check these before drawing any mesh.
      const buffers = renderer._drawableMasks;
      if (model._model.isUsingMasking() && (!Array.isArray(buffers)
          || buffers.length !== attempt.count || buffers.some(b => !b?.isValid()))) {
        throw new Error('Clipping mask allocation failed');
      }
      renderer.setIsPremultipliedAlpha(true);
      return { renderer, maskBuffers: attempt.count, maskSize: attempt.size, mode: attempt.mode,
        warning: attempt.precise ? strict ? '正在使用兼容渲染，遮罩精度保留，可能较慢。' : '显卡资源不足，已自动使用兼容渲染，可能较慢或降低边缘精度。' : '' };
    } catch (error) {
      lastError = error;
      try { model.deleteRenderer(); } catch { /* partially initialized renderer */ }
    }
  }
  throw new Error(`无法创建有效的模型遮罩，兼容渲染也未成功：${lastError?.message ?? lastError}`);
}

/** Allocate and validate before drawing. Original mode never falls back to a smaller mask. */
export function resizeMaskBuffers(config, model, gl, requested, strict = false) {
  if ((!model._model.isUsingMasking() && !model._model.isUsingMaskingForOffscreen?.()) || requested === config.maskSize) return;
  const renderer = config.renderer, previous = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const sizes = strict ? [requested] : [...new Set([requested,Math.min(512,requested),Math.min(256,requested)])];
  try {
    for (const size of sizes) {
      renderer.setClippingMaskBufferSize(size);
      // The bundled SDK replaces the drawable manager without restoring its GL context.
      renderer._drawableClippingManager?.setGL(gl);
      renderer._offscreenClippingManager?.setClippingMaskBufferSize(size);
      const buffers = [...(renderer._drawableMasks || []),...(renderer._offscreenMasks || [])];
      if (buffers.length && buffers.every(b=>b.createRenderTarget(gl,size,size,previous) && b.isValid())) {
        config.maskSize = size;
        if (size !== requested) config.warning = `遮罩需要 ${requested}px，显卡资源不足，实际使用 ${size}px。`;
        return;
      }
    }
    throw Error(`无法分配 ${requested}px 遮罩，未能保持所选画质。`);
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER,previous); }
}
