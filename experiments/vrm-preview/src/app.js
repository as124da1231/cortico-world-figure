import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { inspectVrm, MAX_MODEL_BYTES } from './model-file.mjs';
import { motions, envelope, smoothstep } from './motion.mjs';

const $ = id => document.getElementById(id);
const state = {
  vrm: null, name: '', file: '', bytes: 0, height: 1.6, loadedMs: 0,
  time: 0, action: 'idle', actionStart: 0, amplitude: .8, expression: '', weight: 1,
  paused: false, blink: true, gaze: true, talk: false, loop: false,
  view: 'full', background: 'light', generation: 0, loading: false, ready: false,
  frames: 0, renderMs: 0, stats: {}, expressions: [], bones: new Map(),
};
let renderer, scene, camera, controls, floor, grid, gazeTarget, resizeObserver;
let lastFrame = performance.now(), metricStart = lastFrame, metricFrames = 0, pointer = new THREE.Vector2();
let frameId = 0, pendingFetch;
const rotation = new THREE.Quaternion(), euler = new THREE.Euler();
const expressionNames = {
  happy: '开心', joy: '开心', angry: '生气', sad: '难过', sorrow: '难过', relaxed: '放松', fun: '放松',
  surprised: '惊讶', neutral: '中性', blink: '眨眼', blinkLeft: '左眼眨眼', blinkRight: '右眼眨眼',
  aa: '口型 · A', a: '口型 · A', ih: '口型 · I', i: '口型 · I', ou: '口型 · U', u: '口型 · U',
  ee: '口型 · E', e: '口型 · E', oh: '口型 · O', o: '口型 · O',
  lookUp: '视线向上', lookDown: '视线向下', lookLeft: '视线向左', lookRight: '视线向右',
};

function error(message) {
  $('error').replaceChildren();
  if (!message) { $('error').hidden = true; return; }
  const close = document.createElement('button');
  close.textContent = '×'; close.ariaLabel = '关闭错误提示'; close.onclick = () => error('');
  $('error').append(close, document.createTextNode(message)); $('error').hidden = false;
}

function setLoading(value, label = '正在载入模型…') {
  state.loading = value; $('loading').hidden = !value; $('loading-label').textContent = label;
  $('open').disabled = value; $('sample').disabled = value;
  syncControls();
}

function syncControls() {
  const unavailable = !state.ready || state.loading;
  for (const el of document.querySelectorAll('.motion-button,.expression-button,#pause,#reset,#capture,#neutral,#amplitude,#weight,#full,#face,#home,#blink,#gaze,#talk,#loop')) {
    el.disabled = unavailable || (el.dataset.unsupported === 'true');
  }
  $('pause').textContent = state.paused ? '▶' : 'Ⅱ';
  $('pause').ariaLabel = state.paused ? '继续播放' : '暂停播放';
  $('current-action').textContent = motions.find(m => m.id === state.action)?.name || '自然待机';
  $('current-expression').textContent = state.expression ? (expressionNames[state.expression] || state.expression) : '未选表情';
  for (const el of document.querySelectorAll('.motion-button')) {
    const active = el.dataset.motion === state.action;
    el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
  }
  for (const el of document.querySelectorAll('.expression-button')) {
    const active = el.dataset.expression === state.expression;
    el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
  }
}

function initScene() {
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('aria-label', '可旋转的 3D 模型');
  $('viewport').append(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, .01, 200);
  camera.position.set(0, .8, 4);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.target.set(0, .8, 0); controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI * .9;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc1c8e2, 1));
  const key = new THREE.DirectionalLight(0xfffbfa, 1.15); key.position.set(-1, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9e5ff, .35); fill.position.set(3, 1, -3); scene.add(fill);
  const textureCanvas = document.createElement('canvas'); textureCanvas.width = textureCanvas.height = 128;
  const ctx = textureCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(71,85,126,.19)'); gradient.addColorStop(.4, 'rgba(71,85,126,.11)'); gradient.addColorStop(1, 'rgba(71,85,126,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textureCanvas), transparent: true, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = .001; floor.visible = false; scene.add(floor);
  grid = new THREE.GridHelper(10, 50, 0xc8d1e6, 0xdde3f0);
  grid.material.transparent = true; grid.material.opacity = .28; grid.visible = false; scene.add(grid);
  gazeTarget = new THREE.Object3D(); scene.add(gazeTarget);
  resizeObserver = new ResizeObserver(resize); resizeObserver.observe($('viewport')); resize();
  renderer.domElement.addEventListener('pointermove', event => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
  });
  renderer.domElement.addEventListener('pointerleave', () => pointer.set(0, 0));
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); state.ready = false; syncControls();
    $('status').textContent = '渲染已中断'; error('显卡渲染上下文丢失。请刷新这个独立预览页面后重新打开模型。');
  });
}

function resize() {
  if (!renderer) return;
  const w = $('viewport').clientWidth || 1, h = $('viewport').clientHeight || 1;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (state.ready && state.view === 'full') frameModel('full');
}

function frameModel(view = state.view) {
  if (!state.vrm) return;
  state.view = view;
  const height = state.height;
  const target = new THREE.Vector3(0, height * .51, 0);
  let distance;
  if (view === 'face') {
    const head = state.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) head.getWorldPosition(target);
    target.y += height * .045;
    distance = Math.max(height * .72, height * .48 / camera.aspect);
  } else {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    distance = Math.max(height * 1.18 / (2 * Math.tan(halfFov)), state.stats.width * 1.25 / (2 * Math.tan(halfFov) * camera.aspect));
  }
  controls.target.copy(target);
  camera.position.set(target.x, target.y + (view === 'full' ? height * .02 : 0), target.z + distance);
  controls.minDistance = height * .15; controls.maxDistance = height * 12;
  camera.near = Math.max(.001, height * .005); camera.far = height * 100; camera.updateProjectionMatrix();
  controls.update(); controls.saveState();
  $('full').classList.toggle('active', view === 'full'); $('face').classList.toggle('active', view === 'face');
}

function release(vrm) {
  if (!vrm) return;
  scene.remove(vrm.scene);
  const images = new Set();
  vrm.scene.traverse(obj => {
    for (const material of [].concat(obj.material || [])) {
      for (const value of materialTextures(material)) if (value.source?.data?.close) images.add(value.source.data);
    }
  });
  VRMUtils.deepDispose(vrm.scene);
  for (const image of images) image.close();
  renderer.renderLists.dispose();
}

function materialTextures(material) {
  const values = [...Object.values(material), ...Object.values(material.uniforms || {}).map(u => u.value)];
  // MToon texture accessors live on the prototype, not on enumerable own properties.
  for (const key of ['map', 'normalMap', 'emissiveMap', 'shadeMultiplyTexture', 'shadingShiftTexture', 'matcapTexture', 'rimMultiplyTexture', 'outlineWidthMultiplyTexture', 'uvAnimationMaskTexture']) values.push(material[key]);
  return values.filter(value => value?.isTexture);
}

async function loadBuffer(buffer, fileName, generation) {
  inspectVrm(buffer);
  const started = performance.now();
  const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(buffer, '');
  const vrm = gltf.userData.vrm;
  if (!vrm?.humanoid) { if (vrm) release(vrm); else VRMUtils.deepDispose(gltf.scene); throw new Error('没有可驱动的 VRM 人形骨骼。'); }
  if (generation !== state.generation) { release(vrm); return; }
  try {
    if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse(obj => { if (obj.isMesh) obj.frustumCulled = false; });
    vrm.humanoid.resetNormalizedPose();
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm'), right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
    if (left) left.rotation.z = 1.05;
    if (right) right.rotation.z = -1.05;
    vrm.update(0); vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene, true);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0 || size.y > 100) throw new Error('模型包围盒异常，无法自动取景。');
    vrm.scene.position.x -= center.x; vrm.scene.position.z -= center.z; vrm.scene.position.y -= box.min.y;
    vrm.scene.updateMatrixWorld(true); vrm.springBoneManager?.reset();
    const bones = new Map();
    const names = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
    for (const name of names) { const bone = vrm.humanoid.getNormalizedBoneNode(name); if (bone) bones.set(name, bone); }
    let triangles = 0, meshes = 0;
    const textures = new Set();
    vrm.scene.traverse(obj => {
      if (obj.isMesh && obj.geometry) {
        meshes++; triangles += (obj.geometry.index?.count || obj.geometry.attributes.position?.count || 0) / 3;
        for (const material of [].concat(obj.material || [])) {
          for (const value of materialTextures(material)) textures.add(value);
        }
      }
    });
    const maxTexture = Math.max(0, ...[...textures].map(t => Math.max(t.image?.width || 0, t.image?.height || 0)));
    const old = state.vrm;
    Object.assign(state, { vrm, bones, height: size.y, bytes: buffer.byteLength, loadedMs: Math.round(performance.now() - started),
      name: vrm.meta?.name || vrm.meta?.title || fileName, file: fileName, ready: true, paused: false, time: 0, action: 'idle', actionStart: 0, expression: '',
      expressions: Object.keys(vrm.expressionManager?.expressionMap || {}),
      stats: { triangles: Math.round(triangles), meshes, textures: textures.size, maxTexture, width: size.x, boneCount: Object.keys(vrm.humanoid.normalizedHumanBones || {}).length },
    });
    scene.add(vrm.scene); release(old);
    floor.scale.setScalar(size.y * 1.1); floor.visible = true;
    if (vrm.lookAt) vrm.lookAt.target = gazeTarget;
    gazeTarget.position.set(0, size.y * .9, size.y * 2);
    $('empty').hidden = true; $('status').textContent = '正在预览'; $('status').classList.add('ready');
    $('format').hidden = false; $('format').textContent = `VRM ${vrm.meta?.metaVersion === '0' ? '0.x' : '1.0'}`;
    renderExpressions(); renderInfo(); updateCapabilities(); frameModel('full'); syncControls();
    error('');
  } catch (err) { if (state.vrm !== vrm) release(vrm); throw err; }
}

async function openSource(source) {
  const generation = ++state.generation;
  pendingFetch?.abort(); pendingFetch = new AbortController();
  setLoading(true); error('');
  try {
    let buffer, name;
    if (source instanceof File) {
      if (!/\.vrm$/i.test(source.name)) throw new Error('请打开 .vrm 文件。');
      if (source.size > MAX_MODEL_BYTES) throw new Error('文件超过 128 MiB。');
      name = source.name; buffer = await source.arrayBuffer();
    } else {
      name = source.name;
      const response = await fetch('/sample.vrm', { signal: pendingFetch.signal });
      if (!response.ok) throw new Error('本地样本不存在。可以使用「打开 VRM」选择自己的模型。');
      if (Number(response.headers.get('content-length')) > MAX_MODEL_BYTES) throw new Error('本地样本超过 128 MiB。');
      buffer = await response.arrayBuffer();
    }
    if (generation !== state.generation) return;
    $('loading-label').textContent = '正在解析骨骼、贴图与表情…';
    await loadBuffer(buffer, name, generation);
  } catch (err) {
    if (generation === state.generation && err.name !== 'AbortError') {
      error(`${err.message}${state.ready ? ' 已保留当前模型。' : ''}`);
      if (!state.ready) { $('status').textContent = '等待打开模型'; $('empty').hidden = false; }
    }
  } finally { if (generation === state.generation) setLoading(false); }
}

function renderExpressions() {
  $('expressions').replaceChildren(); $('expression-count').textContent = state.expressions.length;
  if (!state.expressions.length) {
    const p = document.createElement('p'); p.className = 'no-content'; p.textContent = '这个模型没有声明可用表情。'; $('expressions').append(p);
  }
  for (const name of state.expressions) {
    const button = document.createElement('button'); button.className = 'expression-button'; button.dataset.expression = name;
    button.title = `试用表情：${name}`;
    const title = document.createElement('strong'); title.textContent = expressionNames[name] || name;
    const subtitle = document.createElement('small'); subtitle.textContent = expressionNames[name] ? name : '自定义表情';
    button.append(title, subtitle);
    button.onclick = () => { state.expression = state.expression === name ? '' : name; syncControls(); };
    $('expressions').append(button);
  }
}

function renderInfo() {
  const values = [
    ['名称', state.name], ['文件', state.file], ['文件体积', `${(state.bytes / 1024 / 1024).toFixed(2)} MiB`],
    ['三角面', state.stats.triangles.toLocaleString()], ['骨骼', state.stats.boneCount], ['表情', state.expressions.length],
    ['最大贴图边', `${state.stats.maxTexture} px`], ['解析就绪', `${state.loadedMs} ms`],
  ];
  $('model-info').replaceChildren();
  for (const [key, value] of values) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value;
    $('model-info').append(dt, dd);
  }
  $('texture-note').textContent = '原始贴图与全部表情保留。解析读数不包含文件读取时间。';
}

function updateCapabilities() {
  for (const button of document.querySelectorAll('.motion-button')) {
    const motion = motions.find(m => m.id === button.dataset.motion);
    const supported = motion.bones.every(name => state.bones.has(name));
    button.dataset.unsupported = String(!supported);
    if (!supported) button.title = '该模型缺少这个试动作需要的骨骼。';
  }
  const manager = state.vrm.expressionManager;
  $('blink').dataset.unsupported = String(!manager?.getExpression('blink'));
  $('talk').dataset.unsupported = String(!manager?.getExpression('aa'));
  $('gaze').dataset.unsupported = String(!state.vrm.lookAt);
}

function turn(name, x = 0, y = 0, z = 0, blend = 1) {
  const node = state.bones.get(name); if (!node) return;
  rotation.setFromEuler(euler.set(x, y, z));
  node.quaternion.slerp(rotation, blend);
}

function applyPose() {
  const vrm = state.vrm, t = state.time, amp = state.amplitude;
  vrm.humanoid.resetNormalizedPose();
  turn('leftUpperArm', 0, 0, 1.05); turn('rightUpperArm', 0, 0, -1.05);
  turn('leftLowerArm', -.09, 0, .04); turn('rightLowerArm', -.09, 0, -.04);
  turn('spine', Math.sin(t * 1.5) * .012 * amp, 0, Math.sin(t * .65) * .012 * amp);
  turn('neck', Math.sin(t * .8) * .014 * amp, Math.sin(t * .5) * .02 * amp);
  const motion = motions.find(m => m.id === state.action);
  let phase = t - state.actionStart;
  if (state.action !== 'idle' && phase >= motion.duration) {
    if (state.loop) { phase %= motion.duration; state.actionStart = t - phase; }
    else { state.action = 'idle'; state.actionStart = t; syncControls(); }
  }
  const weight = state.action === 'idle' ? 0 : envelope(phase, motion.duration);
  if (state.action === 'wave') {
    turn('rightUpperArm', -.15, 0, .35, weight);
    turn('rightLowerArm', 0, 0, 1.62, weight);
    turn('rightHand', 0, Math.sin(phase * 9) * .32 * amp, Math.sin(phase * 9) * .18 * amp, weight);
    turn('head', 0, -.06 * amp, -.06 * amp, weight);
  } else if (state.action === 'nod') {
    turn('head', Math.sin(phase * 5.4) * .23 * amp, 0, 0, weight);
  } else if (state.action === 'shake') {
    turn('head', 0, Math.sin(phase * 5.1) * .32 * amp, 0, weight);
  } else if (state.action === 'bow') {
    const bend = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, phase / motion.duration))), 1.5) * amp;
    turn('hips', .1 * bend, 0, 0); turn('spine', .45 * bend, 0, 0); turn('head', .12 * bend, 0, 0);
  } else if (state.action === 'walk') {
    const stride = Math.sin(phase * 6.5) * .38 * amp;
    turn('leftUpperLeg', stride, 0, 0, weight); turn('rightUpperLeg', -stride, 0, 0, weight);
    turn('leftLowerLeg', Math.max(0, -Math.sin(phase * 6.5)) * .6 * amp, 0, 0, weight);
    turn('rightLowerLeg', Math.max(0, Math.sin(phase * 6.5)) * .6 * amp, 0, 0, weight);
    turn('leftUpperArm', -stride * .65, 0, 1.05, weight); turn('rightUpperArm', stride * .65, 0, -1.05, weight);
  }
  const progress = state.action === 'idle' ? 0 : Math.min(1, phase / motion.duration);
  $('progress').style.width = `${progress * 100}%`;
  $('time').textContent = state.action === 'idle' ? (state.paused ? '已暂停' : '自由预览') : `${Math.min(phase, motion.duration).toFixed(1)} / ${motion.duration.toFixed(1)}s`;
  const manager = vrm.expressionManager;
  if (manager) {
    manager.resetValues();
    if (state.expression) manager.setValue(state.expression, state.weight);
    if (state.blink && manager.getExpression('blink') && !manager.blinkExpressionNames.includes(state.expression)) {
      const blinkPhase = t % 4.4;
      if (blinkPhase > 4.1) manager.setValue('blink', Math.max(0, Math.sin((blinkPhase - 4.1) / .3 * Math.PI)));
    }
    if (state.talk && !manager.mouthExpressionNames.includes(state.expression)) manager.setValue('aa', (.18 + Math.pow(Math.sin(t * 9), 2) * .55) * amp);
  }
  if (vrm.lookAt) {
    const autoGaze = state.gaze && !manager?.lookAtExpressionNames.includes(state.expression);
    vrm.lookAt.autoUpdate = autoGaze;
    if (!autoGaze) {
      vrm.lookAt.reset(); vrm.lookAt.update(0);
      // A reset through an expression-based lookAt applier also clears gaze weights.
      // Let an explicitly selected native gaze expression own that channel afterward.
      if (manager?.lookAtExpressionNames.includes(state.expression)) manager.setValue(state.expression, state.weight);
    }
    gazeTarget.position.set(pointer.x * state.height * .7, state.height * (.88 + pointer.y * .28), state.height * 2);
  }
}

function tick(now) {
  frameId = requestAnimationFrame(tick);
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, .05)); lastFrame = now;
  if (document.hidden || !renderer) return;
  const start = performance.now();
  controls.update();
  if (state.ready) { if (!state.paused) state.time += dt; applyPose(); state.vrm.update(state.paused ? 0 : dt); }
  renderer.render(scene, camera);
  state.frames++; metricFrames++; state.renderMs = performance.now() - start;
  if (now - metricStart >= 1000) {
    const fps = Math.round(metricFrames / ((now - metricStart) / 1000));
    $('metrics').textContent = state.ready ? `${fps} fps · ${Math.round(renderer.info.render.triangles / 1000)}k 渲染三角面 · ${renderer.info.render.calls} 次绘制` : '等待模型';
    metricStart = now; metricFrames = 0;
  }
}

function resetAll() {
  if (!state.ready) return;
  Object.assign(state, { expression: '', action: 'idle', actionStart: state.time, paused: false, talk: false });
  $('talk').checked = false;
  state.vrm.expressionManager?.resetValues(); state.vrm.lookAt?.reset();
  applyPose(); state.vrm.update(0); state.vrm.scene.updateMatrixWorld(true); state.vrm.springBoneManager?.reset();
  syncControls();
}

function bindUI() {
  for (const motion of motions) {
    const button = document.createElement('button'); button.className = 'motion-button'; button.dataset.motion = motion.id;
    const icon = document.createElement('span'); icon.className = 'motion-icon'; icon.textContent = motion.icon; icon.ariaHidden = 'true';
    const copy = document.createElement('span'), name = document.createElement('strong'), note = document.createElement('small');
    name.textContent = motion.name; note.textContent = motion.note; copy.append(name, note); button.append(icon, copy);
    button.onclick = () => { state.action = motion.id; state.actionStart = state.time; state.paused = false; syncControls(); };
    $('motions').append(button);
  }
  $('open').onclick = () => $('file').click();
  $('file').onchange = () => { const file = $('file').files[0]; if (file) openSource(file); $('file').value = ''; };
  $('sample').onclick = () => openSource({ name: 'aldina.vrm' });
  $('pause').onclick = () => { state.paused = !state.paused; syncControls(); };
  $('reset').onclick = resetAll;
  $('neutral').onclick = () => { state.expression = ''; syncControls(); };
  $('amplitude').oninput = () => {
    state.amplitude = Number($('amplitude').value) / 100;
    $('amplitude-value').textContent = `${Math.round(state.amplitude * 100)}%`;
  };
  $('weight').oninput = () => { state.weight = Number($('weight').value) / 100; $('weight-value').textContent = `${Math.round(state.weight * 100)}%`; };
  for (const id of ['blink', 'gaze', 'talk', 'loop']) $(id).onchange = () => { state[id] = $(id).checked; };
  $('full').onclick = () => frameModel('full'); $('face').onclick = () => frameModel('face'); $('home').onclick = () => frameModel();
  for (const button of document.querySelectorAll('[data-bg]')) button.onclick = () => {
    state.background = button.dataset.bg; $('stage').dataset.background = state.background;
    grid.visible = state.background === 'grid';
    for (const b of document.querySelectorAll('[data-bg]')) b.classList.toggle('active', b === button);
  };
  $('capture').onclick = () => {
    const floorVisible = floor.visible, gridVisible = grid.visible;
    floor.visible = grid.visible = false; renderer.render(scene, camera);
    const a = document.createElement('a'); a.download = `${state.file.replace(/\.vrm$/i, '')}-preview.png`;
    a.href = renderer.domElement.toDataURL('image/png'); a.click();
    floor.visible = floorVisible; grid.visible = gridVisible; renderer.render(scene, camera);
  };
  $('help').onclick = () => $('about').showModal(); $('close-help').onclick = () => $('about').close();
  $('about').onclick = event => { if (event.target === $('about')) { const r = $('about').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('about').close(); } };
  let dragDepth = 0;
  $('stage').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('stage').classList.add('dragging'); });
  $('stage').addEventListener('dragleave', event => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('stage').classList.remove('dragging'); } });
  $('stage').addEventListener('dragover', event => event.preventDefault());
  $('stage').addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; $('stage').classList.remove('dragging');
    const files = [...event.dataTransfer.files];
    if (files.length !== 1) { error('每次请拖入一个 .vrm 文件。'); return; }
    openSource(files[0]);
  });
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());
  syncControls();
}

// Read-only diagnostics for local acceptance checks, never a remote model/AI interface.
Object.defineProperty(window, '__vrmPreview', { value: Object.freeze({ inspect: () => ({
  ready: state.ready, loading: state.loading, file: state.file, version: state.vrm?.meta?.metaVersion,
  time: state.time, action: state.action, paused: state.paused, expression: state.expression, frames: state.frames,
  stats: { ...state.stats }, render: renderer ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries } : null,
  expressions: [...state.expressions], weights: Object.fromEntries(state.expressions.map(n => [n, state.vrm?.expressionManager?.getValue(n)])),
  bones: Object.fromEntries([...state.bones].map(([name, b]) => [name, b.quaternion.toArray()])),
  camera: camera?.position.toArray(), height: state.height,
}) }) });

try {
  bindUI(); initScene(); frameId = requestAnimationFrame(tick);
  const info = await fetch('/api/info').then(r => r.json());
  if (info.sample) { $('sample').onclick = () => openSource(info.sample); await openSource(info.sample); }
  else { $('status').textContent = '等待打开模型'; $('sample').hidden = true; }
} catch (err) { error(`预览初始化失败：${err.message}`); }

window.addEventListener('pagehide', () => {
  state.generation++; pendingFetch?.abort(); cancelAnimationFrame(frameId); resizeObserver?.disconnect(); controls?.dispose();
  release(state.vrm); floor?.geometry.dispose(); floor?.material.map.dispose(); floor?.material.dispose(); grid?.geometry.dispose(); grid?.material.dispose(); renderer?.dispose();
}, { once: true });
