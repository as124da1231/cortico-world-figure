export const BODY_CROP_DEFAULT = Object.freeze({mode:'full', edge:'flat', line:.6, curve:1, feather:.05, transition:.24});
export const BODY_CROP_AXIS = 'figureframing';
export const BODY_CROP_OPTIONS = Object.freeze({full:'figurefullframe', upper:'figureupperframe'});

export function normalizeBodyCrop(value) {
  const between = (input, fallback, min, max) => Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : fallback;
  return {
    mode: value?.mode === 'upper' ? 'upper' : 'full',
    edge: value?.edge === 'round' ? 'round' : 'flat',
    line: between(value?.line, BODY_CROP_DEFAULT.line, .2, .95),
    curve: between(value?.curve, BODY_CROP_DEFAULT.curve, 0, 2),
    feather: between(value?.feather, BODY_CROP_DEFAULT.feather, 0, .25),
    transition: between(value?.transition, BODY_CROP_DEFAULT.transition, 0, 1.2),
  };
}

export function bodyCropForScheme(value, scheme) {
  const crop = normalizeBodyCrop(value);
  if (!value) return crop;
  for (const option of String(scheme ?? '').split('-')) {
    if (option === BODY_CROP_OPTIONS.full) crop.mode = 'full';
    if (option === BODY_CROP_OPTIONS.upper) crop.mode = 'upper';
  }
  return crop;
}

export function cropGeometry([x0,y0,x1,y1], config, floor = 256) {
  const height = y1 - y0, width = x1 - x0;
  const center = (x0 + x1) / 2, halfWidth = Math.max(.5, width / 2);
  const upper = config.mode === 'upper';
  const cut = upper ? y0 + height * config.line : y1;
  const roundDepth = Math.min(height * .12, width * .18, (cut - y0) * .3);
  const depth = upper && config.edge === 'round'
    ? Math.min(roundDepth * (config.curve ?? BODY_CROP_DEFAULT.curve), (cut - y0) * .5) : 0;
  const featherPx = upper ? Math.min(height * config.feather, cut - y0 - depth) : 0;
  return {x0,y0,x1,y1,cut,center,halfWidth,depth,featherPx,shift:upper ? floor - cut : 0};
}

export function cropEdgeAt(geometry, x) {
  const distance = Math.min(1, Math.abs((x - geometry.center) / geometry.halfWidth));
  return geometry.cut - geometry.depth * distance ** 2;
}

export function cropFeatherAlpha(fraction, width) {
  if (width <= 0) return 1;
  const contact = Math.min(1, fraction * width / Math.min(width, 4));
  const smooth = n => n * n * (3 - 2 * n);
  return .52 * smooth(contact) + .48 * smooth(fraction);
}

export function blendCropGeometry(from, to, progress) {
  const amount = progress * progress * (3 - 2 * progress);
  const mix = key => from[key] + (to[key] - from[key]) * amount;
  const cut = mix('cut'), depth = mix('depth');
  // Fade the moving edge even when the saved final edge is sharp.
  const edgeFade = Math.min((to.y1 - to.y0) * .045, Math.abs(to.cut - from.cut) * .16)
    * 4 * progress * (1 - progress);
  const featherPx = Math.min(Math.max(0, cut - depth - to.y0), mix('featherPx') + edgeFade);
  return { ...to, cut, depth, featherPx, shift:mix('shift') };
}
