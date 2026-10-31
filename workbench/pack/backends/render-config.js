import { maskBufferCount } from './role-values.js';

/** Prefer packed masks; on allocation failure use one reusable high-precision
 * mask, then reduce its resolution. Never continue with incomplete buffers. */
export function createAdaptiveRenderer(model, gl, width, height) {
  const count = maskBufferCount(model._model.getDrawableMasks());
  const attempts = [
    { count, size: 512, precise: false, mode: 'packed' },
    { count: 1, size: 512, precise: true, mode: 'compatible' },
    { count: 1, size: 256, precise: true, mode: 'reduced' },
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      model.createRenderer(width, height, attempt.count);
      const renderer = model.getRenderer();
      renderer.setClippingMaskBufferSize(attempt.size);
      if (attempt.precise) renderer.useHighPrecisionMask(true);
      renderer.startUp(gl);
      // The bundled SDK logs failed allocations without throwing. Its mask
      // render targets expose isValid(); check these before drawing any mesh.
      const buffers = renderer._drawableMasks;
      if (model._model.isUsingMasking() && (!Array.isArray(buffers)
          || buffers.length !== attempt.count || buffers.some(b => !b?.isValid()))) {
        throw new Error('Clipping mask allocation failed');
      }
      renderer.setIsPremultipliedAlpha(true);
      return { renderer, maskBuffers: attempt.count, maskSize: attempt.size, mode: attempt.mode,
        warning: attempt.precise ? '显卡资源不足，已自动使用兼容渲染，可能较慢或降低边缘精度。' : '' };
    } catch (error) {
      lastError = error;
      try { model.deleteRenderer(); } catch { /* partially initialized renderer */ }
    }
  }
  throw new Error(`无法创建有效的模型遮罩，兼容渲染也未成功：${lastError?.message ?? lastError}`);
}
