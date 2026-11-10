import { blendCropGeometry, cropEdgeAt, cropFeatherAlpha, cropGeometry } from './crop-config.js';

const SVG = 'http://www.w3.org/2000/svg';
const BOX = 256;
const FEATHER_STEPS = 24;
const smooth = (value) => value * value * (3 - 2 * value);
let nextMask = 0;

function maskPath(shape, inset) {
  const { x0, x1, center, cut, depth } = shape;
  const edge = cut - inset;
  if (!depth) return `M-1 -1H257V${edge}H-1Z`;
  const side = edge - depth;
  return `M-1 -1H257V${side}H${x1}Q${center} ${edge + depth} ${x0} ${side}H-1Z`;
}

/** Draw the cut on the existing WebGL surface without another render pass. */
export function createCropMask(doc, art) {
  let defs, paths, id, last;
  function make(parent) {
    do { id = `l2d-body-mask-${++nextMask}`; } while (doc.getElementById(id));
    defs = doc.createElementNS(SVG, 'defs');
    const mask = doc.createElementNS(SVG, 'mask');
    for (const [key, value] of Object.entries({
      id, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse',
      x: -1, y: -1, width: BOX + 2, height: BOX + 2,
    })) mask.setAttribute(key, value);
    mask.style.maskType = 'alpha';
    defs.appendChild(mask);
    parent.insertBefore(defs, art);
    paths = Array.from({ length: FEATHER_STEPS }, () => {
      const path = doc.createElementNS(SVG, 'path');
      path.setAttribute('fill', 'white');
      mask.appendChild(path);
      return path;
    });
  }
  return {
    apply(parent, pose) {
      if (last === pose) return;
      last = pose;
      if (!pose) {
        art.removeAttribute('mask');
        art.removeAttribute('transform');
        return;
      }
      if (!defs) make(parent);
      const { shape, shift } = pose;
      art.setAttribute('mask', `url(#${id})`);
      art.setAttribute('transform', `translate(0 ${shift})`);
      let previous = 0;
      for (const [index, path] of paths.entries()) {
        if (!shape.featherPx && index < paths.length - 1) path.removeAttribute('d');
        else {
          const fraction = (index + 1) / FEATHER_STEPS;
          const alpha = cropFeatherAlpha(fraction, shape.featherPx);
          path.setAttribute('d', maskPath(shape, shape.featherPx * fraction));
          path.setAttribute('fill-opacity', (alpha - previous) / (1 - previous));
          previous = alpha;
        }
      }
    },
    dispose() { defs?.remove(); },
  };
}

/** Smoothly move the crop line and feather instead of moving the ground under the pet. */
export function interpolateCrop(extent, from, to, progress, previous) {
  const upperAmount = to.mode === 'upper' ? 1 : 0;
  const b = { ...cropGeometry(extent, to), upperAmount };
  if (progress >= 1) return upperAmount ? b : null;
  const a = previous && ['x0', 'y0', 'x1', 'y1'].every(key => previous[key] === b[key])
    ? previous : { ...cropGeometry(extent, from), upperAmount: from.mode === 'upper' ? 1 : 0 };
  return { ...blendCropGeometry(a, b, progress), upperAmount:a.upperAmount + (b.upperAmount - a.upperAmount) * smooth(progress) };
}

/** Resolve the clipped stage geometry against the measured, neutral alpha silhouette. */
export function cropPose(shape, silhouette) {
  if (!shape) return null;
  const { x0, y0, x1, cut, center, depth, halfWidth } = shape;
  let left = x1, right = x0, bottom = y0;
  const rows = [];
  for (const [y, rowLeft, rowRight] of silhouette?.rows ?? []) {
    if (y > cut) break;
    const half = depth && cut - y < depth ? halfWidth * Math.sqrt(Math.max(0, (cut - y) / depth)) : Infinity;
    const lo = Math.max(rowLeft, center - half), hi = Math.min(rowRight, center + half);
    if (lo > hi) continue;
    left = Math.min(left, lo);
    right = Math.max(right, hi);
    bottom = Math.min(cut, y + 1);
    rows.push([y, lo, hi]);
  }
  if (!rows.length) [left, right, bottom] = [x0, x1, cut];
  // A deep curved edge may meet the body slightly above its nominal center.
  // Put the measured contact on the floor, with a one-unit sampling tolerance.
  const shift = shape.shift + Math.max(0, cut - bottom - 1);
  const support = rows.filter(([y]) => y >= bottom - Math.max(7, depth * .7, shape.featherPx * .4));
  const widest = support.reduce((best, row) => row[2] - row[1] > best[2] - best[1] ? row : best, [0, 0, 0]);
  const cutWidth = (widest[2] - widest[1]) || silhouette?.width || right - left;
  const cutCenter = widest[2] > widest[1] ? (widest[1] + widest[2]) / 2 : (left + right) / 2;
  const rawWidth = silhouette?.width ?? cutWidth, rawCenter = silhouette?.footX ?? cutCenter;
  const amount = shape.upperAmount ?? 1;
  const width = rawWidth + (cutWidth - rawWidth) * amount;
  const footX = rawCenter + (cutCenter - rawCenter) * amount;
  const hits = [];
  const height = bottom - y0;
  for (const level of [.18, .49, .79]) {
    const y = y0 + height * level;
    const row = rows.find(item => item[0] >= y);
    const lo = row?.[1] ?? left, hi = row?.[2] ?? right;
    const x = (lo + hi) / 2;
    const limit = Math.max(0, Math.min(cropEdgeAt(shape, x), bottom) - y);
    const radius = Math.min((hi - lo) * .48, height * .22, y - y0, limit);
    if (radius >= 1) hits.push([x, y + shift, radius]);
  }
  return { shape, shift, extent: [left, y0 + shift, right, bottom + shift], hits, footX, width };
}
