// The editor applies the runtime crop geometry to a small, transparent still.
function createCropEditor({doc, t, initial, loadCover}) {
  const win = doc.defaultView;
  const defaults = BODY_CROP_DEFAULT;
  let current = normalizeBodyCrop(initial);
  const initialValue = JSON.stringify(current);
  const html = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const svg = (tag, attrs = {}) => {
    const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const button = (className, text) => {
    const node = html('button', className, text);
    node.type = 'button';
    return node;
  };

  const el = html('div', 'l2d-crop-editor');
  const preview = html('div', 'l2d-crop-preview');
  const stage = svg('svg', {viewBox:'0 0 320 292', 'aria-hidden':'true'});
  const floor = 258;
  const mask = svg('mask', {id:'l2d-edit-crop-mask', x:0, y:0, width:320, height:292, maskUnits:'userSpaceOnUse', 'mask-type':'alpha'});
  const layers = Array.from({length:24}, () => svg('path', {fill:'white'}));
  mask.append(...layers);
  const defs = svg('defs');
  defs.append(mask);
  const floorLine = svg('path', {class:'l2d-crop-floor', d:`M18 ${floor}H302`});
  const shadow = svg('ellipse', {class:'l2d-crop-shadow', cy:floor, ry:4});
  const body = svg('g', {mask:'url(#l2d-edit-crop-mask)'});
  const art = svg('g');
  const placeholder = svg('path', {class:'l2d-crop-silhouette',
    d:'M160 38a28 28 0 1 1 0 56 28 28 0 0 1 0-56Zm-18 66h36c14 0 25 12 29 25l13 53a8 8 0 0 1-16 4l-15-46-4 56-6 53a10 10 0 0 1-20-1l1-45h-2l1 45a10 10 0 0 1-20 1l-6-53-4-56-15 46a8 8 0 0 1-16-4l13-53c4-13 15-25 29-25Z'});
  const image = svg('image', {width:320, height:292, preserveAspectRatio:'none'});
  image.style.display = 'none';
  art.append(placeholder, image);
  body.append(art);
  const bubble = svg('g', {class:'l2d-crop-bubble'});
  bubble.append(svg('path', {d:'M-15-20H15a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H4L0 0-4-4h-11a5 5 0 0 1-5-5v-6a5 5 0 0 1 5-5Z'}));
  for (const x of [-5,0,5]) bubble.append(svg('circle', {cx:x, cy:-12, r:1.15}));
  stage.append(defs, floorLine, shadow, body, bubble);
  const stageBox = html('div', 'l2d-crop-stage');
  stageBox.append(stage);
  const status = html('p', 'l2d-crop-status', t('正在读取模型预览…', 'Loading figure preview…'));
  status.setAttribute('role', 'status');
  const replay = button('l2d-btn sm', t('预览过渡', 'Preview transition'));
  const reset = button('l2d-btn quiet sm', t('恢复默认', 'Reset framing'));
  const previewActions = html('div', 'l2d-crop-preview-actions');
  previewActions.append(replay, reset);
  preview.append(stageBox, previewActions, status);
  el.append(preview);

  const controls = html('div', 'l2d-crop-controls');
  const selectors = new Map();
  const sliders = new Map();
  const cropOnly = [];
  function choices(key, label, items, onlyUpper = false) {
    const row = html('div', 'l2d-crop-setting');
    const labelEl = html('span', 'l2d-label', label);
    const group = html('div', 'l2d-crop-options');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const buttons = new Map();
    for (const [value, text] of items) {
      const node = button('l2d-btn sm', text);
      node.addEventListener('click', () => {
        if (value === current[key]) return;
        current = normalizeBodyCrop({...current, [key]:value});
        updateControls();
        updatePreview(key === 'mode');
      });
      buttons.set(value, node);
      group.append(node);
    }
    selectors.set(key, buttons);
    if (onlyUpper) cropOnly.push(...buttons.values());
    row.append(labelEl, group);
    controls.append(row);
  }
  function slider(key, label, min, max, step, format, onlyUpper = false) {
    const row = html('div', 'l2d-crop-setting');
    const range = html('input', 'l2d-range');
    range.type = 'range';
    range.id = 'l2d-crop-' + key;
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    const labelEl = html('label', 'l2d-label', label);
    labelEl.htmlFor = range.id;
    const out = html('output', 'l2d-out');
    out.setAttribute('for', range.id);
    row.append(labelEl, range, out);
    range.addEventListener('input', () => {
      current = normalizeBodyCrop({...current, [key]:Number(range.value)});
      updateControls();
      updatePreview();
    });
    sliders.set(key, {range, out, format});
    if (onlyUpper) cropOnly.push(range);
    controls.append(row);
  }
  const percent = value => Math.round(value * 100) + '%';
  choices('mode', t('显示范围', 'Body framing'), [['full', t('全身', 'Full body')], ['upper', t('上半身', 'Upper body')]]);
  choices('edge', t('裁切形状', 'Cut shape'), [['flat', t('平口', 'Flat')], ['round', t('圆口', 'Rounded')]], true);
  slider('curve', t('圆口弧度', 'Curve depth'), 0, 2, .05, percent);
  slider('line', t('裁切线', 'Cut height'), .2, .95, .01, percent, true);
  slider('feather', t('边缘羽化', 'Edge softness'), 0, .25, .01, percent, true);
  slider('transition', t('淡入淡出', 'Transition'), 0, 1.2, .02, value => value.toFixed(2) + ' s');
  controls.append(html('p', 'l2d-crop-note', t(
    '圆口弧度 50% 为半弧，100% 为原弧深。裁切线从头顶向下计算，气泡跟随头部。',
    'At 50%, the curve is half as deep as the original. Cut height is measured from the top, and the bubble follows the head.',
  )));
  el.append(controls);

  let extent = [98,38,222,floor], head = [160,38];
  let displayed, animation = 0, loading = false, disposed = false;
  function updateControls() {
    for (const [key, buttons] of selectors) {
      for (const [value, node] of buttons) node.setAttribute('aria-pressed', String(value === current[key]));
    }
    for (const [key, {range,out,format}] of sliders) {
      range.value = String(current[key]);
      out.value = format(current[key]);
      range.setAttribute('aria-valuetext', out.value);
    }
    for (const node of cropOnly) node.disabled = current.mode !== 'upper';
    sliders.get('curve').range.disabled = current.mode !== 'upper' || current.edge !== 'round';
    reset.disabled = JSON.stringify(current) === JSON.stringify(defaults);
    replay.disabled = current.transition === 0;
  }
  function maskPath(geometry, offset) {
    const {center, halfWidth, cut, depth} = geometry;
    const middle = cut - offset, side = middle - depth;
    return depth > 0
      ? `M0 -300H320V${side}H${center+halfWidth}Q${center} ${middle+depth} ${center-halfWidth} ${side}H0Z`
      : `M0 -300H320V${middle}H0Z`;
  }
  function draw(geometry) {
    displayed = geometry;
    let previous = 0;
    for (let i=0; i<layers.length; i++) {
      const layer = layers[i];
      const fraction = (i+1)/layers.length;
      if (!geometry.featherPx && i < layers.length - 1) layer.removeAttribute('d');
      else {
        const alpha = cropFeatherAlpha(fraction, geometry.featherPx);
        layer.setAttribute('d', maskPath(geometry, geometry.featherPx * fraction));
        layer.setAttribute('opacity', String((alpha-previous)/(1-previous)));
        previous = alpha;
      }
    }
    art.setAttribute('transform', `translate(0 ${geometry.shift})`);
    const maskTransform = `translate(0 ${geometry.shift})`;
    for (const layer of layers) layer.setAttribute('transform', maskTransform);
    shadow.setAttribute('cx', geometry.center);
    shadow.setAttribute('rx', Math.max(10, geometry.halfWidth*(geometry.shift > 1 ? .66 : .42)));
    bubble.setAttribute('transform', `translate(${head[0]} ${head[1] + geometry.shift - 6})`);
  }
  function cancelAnimation() {
    if (animation) win.cancelAnimationFrame(animation);
    animation = 0;
  }
  function updatePreview(animate = false, from = displayed) {
    cancelAnimation();
    const target = cropGeometry(extent, current, floor);
    const reduceMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!animate || !from || !current.transition || reduceMotion || !win.requestAnimationFrame) {
      draw(target);
      return;
    }
    let start;
    const step = time => {
      if (disposed) return;
      start ??= time;
      const progress = Math.min(1, (time-start)/(1000*current.transition));
      draw(blendCropGeometry(from, target, progress));
      animation = progress < 1 ? win.requestAnimationFrame(step) : 0;
    };
    draw(from);
    animation = win.requestAnimationFrame(step);
  }
  replay.addEventListener('click', () => {
    const opposite = {...current,mode:current.mode === 'upper' ? 'full' : 'upper'};
    updatePreview(true, cropGeometry(extent, opposite, floor));
  });
  reset.addEventListener('click', () => {
    const switchMode = current.mode !== defaults.mode;
    current = normalizeBodyCrop(defaults);
    updateControls();
    updatePreview(switchMode);
  });
  function showImage(data) {
    if (typeof data !== 'string' || !/^data:image\/(?:png|webp);base64,/i.test(data)) return Promise.resolve(false);
    return new Promise(resolve => {
      const bitmap = new win.Image();
      bitmap.onload = () => {
        if (disposed) return resolve(false);
        try {
          const down = Math.min(1, 128/Math.max(bitmap.naturalWidth, bitmap.naturalHeight));
          const canvas = html('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.naturalWidth*down));
          canvas.height = Math.max(1, Math.round(bitmap.naturalHeight*down));
          const ctx = canvas.getContext('2d', {willReadFrequently:true});
          const {width,height} = canvas;
          ctx.drawImage(bitmap, 0, 0, width, height);
          const pixels = ctx.getImageData(0,0,width,height).data;
          const measured = cropPreviewAlphaBounds(pixels, width, height);
          if (!measured) return resolve(false);
          const [x0,y0,x1,y1,headX] = measured;
          const scale = Math.min(220/(x1-x0), 220/(y1-y0));
          const px = 160-(x0+x1)*scale/2, py = floor-y1*scale;
          extent = [px+x0*scale, py+y0*scale, px+x1*scale, floor];
          head = [px+headX*scale, extent[1]];
          for (const [key,value] of Object.entries({x:px,y:py,width:width*scale,height:height*scale,href:data})) {
            image.setAttribute(key, value);
          }
          placeholder.style.display = 'none';
          image.style.display = '';
          updatePreview();
          resolve(true);
        } catch { resolve(false); }
      };
      bitmap.onerror = () => resolve(false);
      bitmap.src = data;
    });
  }
  async function activate() {
    if (loading || disposed) return;
    loading = true;
    const result = await Promise.resolve().then(loadCover).catch(() => null);
    if (disposed) return;
    const available = await showImage(result?.image);
    if (!disposed) status.textContent = available
      ? t('使用模型静态预览', 'Static model preview')
      : t('暂无模型预览，当前使用示意轮廓。', 'Figure preview unavailable. Showing a sample outline.');
  }
  updateControls();
  updatePreview();
  return {
    el, activate,
    value: () => current,
    changed: () => JSON.stringify(current) !== initialValue,
    deactivate() { updatePreview(); },
    dispose() { disposed = true; cancelAnimation(); },
  };
}

// Use only the visible body so margins in a cover never shift the cut line.
function cropPreviewAlphaBounds(data, width, height) {
  let x0=width, y0=height, x1=0, y1=0;
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      if (data[(y*width+x)*4+3] < 32) continue;
      x0=Math.min(x0,x); x1=Math.max(x1,x+1);
      y0=Math.min(y0,y); y1=Math.max(y1,y+1);
    }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const y = Math.min(y1-1, Math.floor(y0+(y1-y0)*.14));
  let bestStart=x0, bestLength=0, start=x0;
  for (let x=x0; x<=x1; x++) {
    if (x < x1 && data[(y*width+x)*4+3] >= 32) continue;
    if (x-start > bestLength) { bestStart=start; bestLength=x-start; }
    start=x+1;
  }
  return [x0,y0,x1,y1,bestLength ? bestStart+bestLength/2 : (x0+x1)/2];
}
