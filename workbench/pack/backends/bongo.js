const clampUnit = (value) => Math.max(-1, Math.min(1, value));

// BongoCat adds its 0–1 breath wave at half weight, before physics.
export function bongoBreathContribution(seconds) {
  return 0.25 * (1 + Math.sin(2 * Math.PI * seconds / 3.2345));
}

const keyAliases = {
  Enter: ['return'], Backquote: ['backquote', 'grave'], Backslash: ['backslash'],
  ControlLeft: ['control'], ControlRight: ['control'], ShiftLeft: ['shift'],
  ShiftRight: ['shift'], AltLeft: ['alt'], AltRight: ['alt'],
  MetaLeft: ['meta', 'super'], MetaRight: ['meta', 'super'],
};

export function keyArtwork(map, keys) {
  for (let i = keys.length - 1; i >= 0; i--) {
    const code = keys[i];
    const names = [code.toLowerCase(), ...(Object.hasOwn(keyAliases, code) ? keyAliases[code] : [])];
    for (const name of names) if (Object.hasOwn(map, name)) return map[name];
  }
  return null;
}

export function createBongoInput(profile, model, index, host) {
  const axes = [
    ['ParamMouseX', 0], ['ParamMouseY', 1],
    ['ParamAngleX', 0], ['ParamAngleY', 1],
    ['ParamEyeBallX', 0], ['ParamEyeBallY', 1],
  ];
  const slots = new Map();
  for (const name of [...axes.map(([name]) => name), 'ParamMouseLeftDown', 'ParamMouseRightDown', 'CatParamLeftHandDown', 'CatParamRightHandDown']) {
    const i = index.get(name);
    if (i !== undefined) slots.set(name, {
      i, min: model.getParameterMinimumValue(i), max: model.getParameterMaximumValue(i), rest: model.getParameterDefaultValue(i),
    });
  }
  const hasKeyArt = profile.keys.some(map => Object.keys(map).length);
  let point = null;
  let pressed = false;
  let activity = null;
  const look = [0, 0];
  const write = (name, value) => {
    const slot = slots.get(name);
    if (!slot) return;
    const end = value < 0 ? slot.min : slot.max;
    model.setParameterValueByIndex(slot.i, slot.rest + (end - slot.rest) * Math.abs(value));
  };
  return {
    pointer(type, p) {
      if (type === 'leave' || type === 'cancel') point = null;
      else if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) point = p;
      if (type === 'down') pressed = true;
      if (type === 'up' || type === 'cancel' || type === 'leave') pressed = false;
    },
    // Reserved for a future host adapter. Accepts a held-input snapshot or null to clear it.
    input(value) { activity = value; },
    apply(dt) {
      const { W, H } = host.bounds();
      const x = point && W > 0 ? clampUnit(1 - 2 * point.x / W) : 0;
      const y = point && H > 0 ? clampUnit(1 - 2 * point.y / H) : 0;
      const blend = 1 - Math.exp(-dt * 24);
      look[0] += (x - look[0]) * blend;
      look[1] += (y - look[1]) * blend;
      // During native animations, an unattended pet keeps the authored pose.
      if (point || Math.abs(look[0]) + Math.abs(look[1]) > .01)
        for (const [name, axis] of axes) write(name, look[axis]);
      if (activity?.primary || pressed) write('ParamMouseLeftDown', 1);
      if (activity?.secondary) write('ParamMouseRightDown', 1);
      const keys = activity?.keys ?? [];
      const overlays = profile.keys.map(map => keyArtwork(map, keys));
      if (overlays[0] || (keys.length && !hasKeyArt)) write('CatParamLeftHandDown', 1);
      if (overlays[1]) write('CatParamRightHandDown', 1);
      return overlays;
    },
  };
}

const turningWords = new Set(['turn', 'spin', 'look', 'walk', 'run']);

export function connectBongoBody(body, input, nativeWords, triggerNative) {
  const pointer = body.pointer.bind(body);
  body.pointer = (type, point) => {
    input.pointer(type, point);
    pointer(type, point);
    // The kit still sees touch and drag. Its hover auto-turn only runs while
    // the pointer is inside and unpressed; BongoCat tracks it independently.
    if (type !== 'leave') pointer('leave');
  };
  const drop = body.drop.bind(body);
  body.drop = (point) => {
    drop(point);
    body.pointer('leave');
  };
  const perform = body.do.bind(body);
  body.do = (word) => turningWords.has(word) ? triggerNative(word) : perform(word);
  body.words = body.words.filter(word => !turningWords.has(word) || Object.hasOwn(nativeWords, word));
  body.walk = () => false;
  body.move = () => false;
}

export function bongoCanvas(model) {
  const c = model.getModel().canvasinfo;
  return {
    x: -c.CanvasOriginX / c.PixelsPerUnit,
    y: c.CanvasOriginY / c.PixelsPerUnit,
    width: c.CanvasWidth / c.PixelsPerUnit,
    height: c.CanvasHeight / c.PixelsPerUnit,
  };
}

export function createBongoArtwork(container, canvas, assets, url, model, matrix) {
  const doc = canvas.ownerDocument;
  const bounds = bongoCanvas(model);
  const image = () => {
    const el = doc.createElement('img');
    el.alt = '';
    el.crossOrigin = 'anonymous';
    el.hidden = true;
    el.style.cssText = 'position:absolute;pointer-events:none;user-select:none';
    return el;
  };
  const background = image();
  const hands = assets.keys.map(image);
  container.insertBefore(background, canvas);
  container.append(...hands);
  const rectangle = (margin = 0) => {
    const sx = matrix.getScaleX(), sy = matrix.getScaleY();
    return [(1 + (bounds.x - margin) * sx + matrix.getTranslateX()) / 2,
      (1 - bounds.y * sy - matrix.getTranslateY()) / 2, bounds.width * sx / 2, bounds.height * sy / 2];
  };
  const position = (el, asset) => {
    // Legacy key images can include the horizontal margin of their old window.
    const margin = el === background ? 0 : Math.floor(Math.max(0, asset.h - asset.w) / 2) * bounds.width / asset.w;
    const rect = rectangle(margin);
    el.style.left = rect[0] * 100 + '%';
    el.style.top = rect[1] * 100 + '%';
    el.style.width = rect[2] * 100 + '%';
    el.style.height = rect[3] * 100 + '%';
    return rect;
  };
  const set = (el, asset) => {
    el.hidden = !asset;
    if (!asset) return;
    const href = String(url(asset.file));
    if (el.getAttribute('src') !== href) el.src = href;
    position(el, asset);
  };
  return {
    get hasBackground() { return !background.hidden; },
    sceneBounds() {
      const [x, y, w, h] = rectangle();
      return [x, y, x + w, y + h];
    },
    clip() {
      // Accessories can be parked outside the authored window in their idle pose.
      const [x, y, w, h] = rectangle();
      container.style.clipPath = `inset(${[y, 1 - x - w, 1 - y - h, x].map(n => Math.max(0, n) * 100 + '%').join(' ')})`;
    },
    pixels(w, h) {
      const [x, y, sw, sh] = rectangle();
      return [Math.max(0, Math.ceil(x * w)), Math.max(0, Math.ceil(y * h)),
        Math.min(w, Math.floor((x + sw) * w)), Math.min(h, Math.floor((y + sh) * h))];
    },
    start() {
      background.addEventListener('error', () => { background.hidden = true; });
      set(background, assets.background);
    },
    draw(overlays) {
      if (!background.hidden && assets.background) position(background, assets.background);
      hands.forEach((el, i) => set(el, overlays[i]));
    },
    composite(ctx, layer, w, h) {
      if (!background.hidden && background.complete && background.naturalWidth) {
        const [x, y, sw, sh] = position(background, assets.background);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(background, x * w, y * h, sw * w, sh * h);
        ctx.drawImage(layer, 0, 0);
      }
    },
  };
}
