import { PNG } from 'pngjs';

/** Average each source region in premultiplied colour to keep transparent edges clean. */
export function shrinkPng(input, maxEdge) {
  const source = PNG.sync.read(input);
  const scale = maxEdge / Math.max(source.width, source.height);
  if (scale >= 1) return input;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const top = Math.floor(y * source.height / height);
    const bottom = Math.floor((y + 1) * source.height / height);
    for (let x = 0; x < width; x++) {
      const left = Math.floor(x * source.width / width);
      const right = Math.floor((x + 1) * source.width / width);
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let row = top; row < bottom; row++) {
        for (let col = left; col < right; col++) {
          const i = (row * source.width + col) * 4;
          const a = source.data[i + 3];
          red += source.data[i] * a;
          green += source.data[i + 1] * a;
          blue += source.data[i + 2] * a;
          alpha += a;
        }
      }
      const i = (y * width + x) * 4;
      if (alpha) {
        data[i] = Math.round(red / alpha);
        data[i + 1] = Math.round(green / alpha);
        data[i + 2] = Math.round(blue / alpha);
      }
      data[i + 3] = Math.round(alpha / ((bottom - top) * (right - left)));
    }
  }
  return PNG.sync.write({ width, height, data });
}
