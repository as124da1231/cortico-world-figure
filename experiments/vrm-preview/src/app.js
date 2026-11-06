import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { inspectVrm, MAX_MODEL_BYTES } from './model-file.mjs';
import { motions } from './motion.mjs';
import { AvatarPerformance } from './performance.js';
import { LocalSpeech } from './speech.js';
import { motionLibraries, previewsFor } from './motion-libraries.mjs';
import {
  BINDING_WORDS, BINDING_SOURCES, bindingStats, exportBindings,
  loadBindings, resetBindings, saveBindings, sourceById,
} from './bindings.mjs';

const $ = id => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {
  vrm: null, name: '', file: '', bytes: 0, height: 1.6, loadedMs: 0,
  time: 0, action: 'idle', actionStart: 0, amplitude: .8, expression: '', weight: 1,
  paused: reducedMotion, blink: true, gaze: true, talk: false, loop: false, life: !reducedMotion, performance: null,
  view: 'full', background: 'light', generation: 0, loading: false, ready: false,
  frames: 0, renderMs: 0, stats: {}, expressions: [], bones: new Map(), animations: new Map(), assetWarning: '',
  demoSpeech: null, wide: false, scenario: '',
  library: 'quaternius', libraries: new Map(), modelOrigin: null, modelRotation: null,
};
let renderer, scene, camera, controls, floor, grid, gazeTarget, resizeObserver;
let lastFrame = performance.now(), metricStart = lastFrame, metricFrames = 0, pointer = new THREE.Vector2();
let frameId = 0, pendingFetch;
let pointerDown = null;
const hitRay = new THREE.Raycaster();
let command = 0;
const speech = new LocalSpeech(mode => {
  if (!state.performance) return;
  if (mode === 'speak') state.performance.engage('speak');
  else if (mode === 'complete') state.performance.engage('listen');
  else state.performance.engage('idle');
});
function cancelSequence({ interrupt = false, stopMovement = true } = {}) {
  command++; state.scenario = ''; speech.stop();
  state.performance?.stopPreview();
  if (stopMovement) state.performance?.locomotion.stop();
  if (interrupt) { state.talk = false; $('talk').checked = false; state.performance?.engage('interrupt'); }
}
function activateLibrary(id, { cancel = true } = {}) {
  const animations = state.libraries.get(id);
  if (!animations?.has('balanced')) return false;
  if (cancel) cancelSequence();
  state.library = id; state.animations = animations;
  if (state.vrm) {
    state.performance?.dispose();
    state.vrm.scene.position.copy(state.modelOrigin); state.vrm.scene.quaternion.copy(state.modelRotation);
    state.performance = new AvatarPerformance(state.vrm, state.height, { animations });
    if (state.vrm.lookAt) state.vrm.lookAt.target = gazeTarget;
    state.vrm.springBoneManager?.reset(); state.action = 'idle'; updatePerformance(0); updateCapabilities();
  }
  $('motion-library').value = id;
  $('library-note').textContent = animations.library.note;
  renderLibraryDialog(); syncControls(); return true;
}
function renderLibraryDialog() {
  $('library-title').textContent = motionLibraries.find(library => library.id === state.library).name;
  $('library-clips').replaceChildren();
  for (const entry of previewsFor(state.library)) {
    const button = document.createElement('button'); button.className = 'library-clip'; button.dataset.preview = entry.id;
    const title = document.createElement('strong'), note = document.createElement('span');
    title.textContent = entry.name; note.textContent = entry.note; button.append(title, note);
    button.disabled = !state.animations.has(entry.id);
    if (button.disabled) button.title = '这段素材未能加载，请重新启动后刷新。';
    button.onclick = () => {
      cancelSequence(); state.performance.engage('idle'); state.paused = false;
      state.performance.playPreview(entry.id, { loop: state.loop && entry.loop });
      $('library-dialog').close(); syncControls();
    };
    $('library-clips').append(button);
  }
}
async function compareWalks() {
  cancelSequence(); const token = command; state.paused = false; state.wide = true; frameModel('full');
  try {
    for (const id of ['overte', 'quaternius']) {
      if (token !== command || !state.ready) return;
      if (!activateLibrary(id, { cancel: false })) throw new Error('对比素材尚未就绪，请重新启动试验台后刷新。');
      state.scenario = `${motionLibraries.find(library => library.id === id).name} · 同一路线`;
      if (!state.performance.walk()) throw new Error('这一套的行走素材未能加载。');
      const start = state.performance.time;
      while (token === command && state.ready && state.performance.locomotion.active) {
        if (state.performance.time - start > 20) throw new Error('对比行走未能结束，请复位后重试。');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const settled = state.performance.time;
      while (token === command && state.ready && state.performance.time - settled < 1) await new Promise(resolve => requestAnimationFrame(resolve));
    }
  } catch (err) { if (token === command) error(err.message); }
  if (token === command) state.scenario = '';
}
async function saySample(token = command) {
  if (!state.demoSpeech) { error('本机没有可用的试听语音，可以打开一段本地音频。'); return false; }
  const response = await fetch('/demo-speech.wav');
  if (!response.ok) throw new Error('本地试听语音未就绪，请重新启动试验台或打开音频。');
  const bytes = await response.arrayBuffer();
  if (token !== command || !state.ready) return false;
  return speech.play(bytes, state.demoSpeech.text);
}
async function runScenario() {
  cancelSequence(); const token = command; state.paused = false; void speech.pause(false);
  const valid = () => token === command && state.ready;
  const wait = async (seconds, condition) => {
    const start = state.performance.time;
    while (valid() && (condition ? !condition() : state.performance.time - start < seconds)) {
      if (condition && state.performance.time - start > seconds) throw new Error('行走没有按时结束，请先复位再试。');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return valid();
  };
  try {
    state.scenario = '注意到你'; state.performance.engage('notice');
    if (!await wait(.65)) return;
    state.scenario = '走近一点'; state.wide = true; frameModel('full');
    if (!state.performance.walk()) throw new Error('行走素材未能读取，请重新启动试验台后刷新。');
    if (!await wait(18, () => !state.performance.locomotion.active)) return;
    state.scenario = '认真听着'; state.performance.engage('listen');
    if (!await wait(1.8)) return;
    state.scenario = '想一想'; state.performance.engage('think');
    if (!await wait(1.5)) return;
    state.scenario = '轻声回应';
    const completed = await saySample(token);
    if (!valid()) return;
    if (!completed) { state.performance.engage('idle'); state.scenario = ''; return; }
    state.scenario = '等你接着说'; state.performance.engage('listen');
    if (!await wait(2.5)) return;
    state.performance.engage('idle'); state.scenario = '';
  } catch (err) { if (valid()) { state.scenario = ''; state.performance.engage('idle'); error(err.message); } }
}
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
  for (const el of document.querySelectorAll('.motion-button,.expression-button,.bound-motion,[data-engagement],#motion-library,#library-open,#compare-walk,#scenario,#say,#open-audio,#interrupt,#pause,#reset,#capture,#neutral,#amplitude,#weight,#full,#face,#home,#blink,#gaze,#talk,#loop,#life')) {
    el.disabled = unavailable || (el.dataset.unsupported === 'true');
  }
  $('pause').textContent = state.paused ? '▶' : 'Ⅱ';
  $('pause').ariaLabel = state.paused ? '继续播放' : '暂停播放';
  const performanceState = state.performance?.snapshot();
  $('current-action').textContent = performanceState?.locomotion.active ? '走几步' : performanceState?.gesture?.name || performanceState?.idleName || '自然待机';
  $('current-expression').textContent = state.expression ? (expressionNames[state.expression] || state.expression) : '未选表情';
  for (const el of document.querySelectorAll('.motion-button')) {
    const active = el.dataset.motion === state.action;
    el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
  }
  for (const el of document.querySelectorAll('.expression-button')) {
    const active = el.dataset.expression === state.expression;
    el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
  }
  for (const el of document.querySelectorAll('.bound-motion')) {
    const active = el.dataset.word === state.action;
    el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
  }
  updateBindingSummary();
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
    if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) pointerDown.moved = true;
    const dragging = pointerDown?.moved;
    state.performance?.setPointer(pointer.x, pointer.y, !dragging);
  });
  renderer.domElement.addEventListener('pointerleave', () => { state.performance?.setPointer(pointer.x, pointer.y, false); pointerDown = null; });
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button === 0) pointerDown = { x: event.clientX, y: event.clientY, moved: false };
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (pointerDown && !pointerDown.moved && event.button === 0 && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 6 && state.ready && !state.paused) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
      hitRay.setFromCamera(pointer, camera);
      if (hitRay.intersectObject(state.vrm.scene, true).length) state.performance.react(state.life);
    }
    pointerDown = null;
  });
  renderer.domElement.addEventListener('pointercancel', () => { pointerDown = null; });
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
    const width = state.wide ? Math.max(state.stats.width, height * 1.65) : state.stats.width;
    distance = Math.max(height * 1.18 / (2 * Math.tan(halfFov)), width * 1.25 / (2 * Math.tan(halfFov) * camera.aspect));
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
    const armFrame = vrm.meta?.metaVersion === '0' ? 1 : -1;
    if (left) left.rotation.z = 1.05 * armFrame;
    if (right) right.rotation.z = -1.05 * armFrame;
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
    const origin = vrm.scene.position.clone(), rotation = vrm.scene.quaternion.clone();
    const nextPerformance = new AvatarPerformance(vrm, size.y, { animations: state.animations });
    const old = state.vrm, oldPerformance = state.performance;
    Object.assign(state, { vrm, bones, height: size.y, bytes: buffer.byteLength, loadedMs: Math.round(performance.now() - started),
      name: vrm.meta?.name || vrm.meta?.title || fileName, file: fileName, ready: true, paused: reducedMotion, time: 0, action: 'idle', actionStart: 0, expression: '',
      expressions: Object.keys(vrm.expressionManager?.expressionMap || {}),
      stats: { triangles: Math.round(triangles), meshes, textures: textures.size, maxTexture, width: size.x, boneCount: Object.keys(vrm.humanoid.normalizedHumanBones || {}).length },
    });
    state.performance = nextPerformance; state.modelOrigin = origin; state.modelRotation = rotation;
    scene.add(vrm.scene); oldPerformance?.dispose(); release(old);
    floor.scale.setScalar(size.y * 1.1); floor.visible = true;
    if (vrm.lookAt) vrm.lookAt.target = gazeTarget;
    gazeTarget.position.set(0, size.y * .9, size.y * 2);
    $('empty').hidden = true; $('status').textContent = '正在预览'; $('status').classList.add('ready');
    $('format').hidden = false; $('format').textContent = `VRM ${vrm.meta?.metaVersion === '0' ? '0.x' : '1.0'}`;
    renderExpressions(); renderInfo(); updateCapabilities(); frameModel('full'); renderBoundMotions(); syncControls();
    error(state.assetWarning);
  } catch (err) { if (state.vrm !== vrm) release(vrm); throw err; }
}

async function openSource(source) {
  cancelSequence();
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
    ['待机来源', state.performance.snapshot().idleSource],
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
    const supported = motion.bones.every(name => state.bones.has(name)) && (motion.id !== 'walk' || state.performance.locomotion.available);
    button.dataset.unsupported = String(!supported);
    if (!supported) button.title = '该模型缺少这个试动作需要的骨骼。';
  }
  const manager = state.vrm.expressionManager;
  $('blink').dataset.unsupported = String(!manager?.getExpression('blink'));
  $('talk').dataset.unsupported = String(!manager?.getExpression('aa'));
  $('gaze').dataset.unsupported = String(!state.bones.has('head'));
}

function updatePerformance(dt) {
  speech.step();
  state.performance.engagement.audio(speech.energy, speech.progress);
  state.performance.update(dt, state, camera, gazeTarget);
  state.time = state.performance.time;
  const current = state.performance.snapshot();
  const action = current.locomotion.active ? 'walk' : current.preview?.id || current.gesture?.id || 'idle';
  if (state.action !== action) { state.action = action; syncControls(); }
  const actionName = current.locomotion.active ? '走几步' : current.preview?.name || current.gesture?.name || current.idleName;
  if ($('current-action').textContent !== actionName) $('current-action').textContent = actionName;
  const clip = current.preview || current.gesture;
  $('progress').style.width = `${speech.playing ? speech.progress * 100 : clip ? (clip.time % clip.duration) / clip.duration * 100 : 0}%`;
  const labels = { attend: '在留意你', linger: '目送片刻', glance: '稍稍看看周围', rest: '自在待机', notice: '注意到你', listen: '认真听着', think: '想一想', speak: '轻声回应' };
  const phases = { left: '转过身', right: '转过身', start: '迈出一步', walk: '走近一点', stop: '慢慢站稳', idle: '站稳了' };
  $('status').textContent = state.paused ? '已暂停' : current.locomotion.active ? phases[current.locomotion.phase] : current.preview ? `${current.preview.name} · 动作预览` : labels[current.engagement.mode === 'idle' ? current.behavior.mode : current.engagement.mode] || '自在待机';
  $('interaction-status').textContent = state.scenario || (speech.playing ? speech.text || '正在播放本地音频' : labels[current.engagement.mode] || '在这里，等你开口');
  for (const button of document.querySelectorAll('[data-engagement]')) button.setAttribute('aria-pressed', String(button.dataset.engagement === current.engagement.mode));
  floor.position.x = state.vrm.scene.position.x; floor.position.z = state.vrm.scene.position.z;
  $('time').textContent = clip ? `${(clip.time % clip.duration).toFixed(1)} / ${clip.duration.toFixed(1)}s` : state.paused ? '已暂停' : state.life ? current.idleName : '自由预览';
}

function tick(now) {
  frameId = requestAnimationFrame(tick);
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, .05)); lastFrame = now;
  if (document.hidden || !renderer) return;
  const start = performance.now();
  controls.update();
  if (state.ready) updatePerformance(state.paused ? 0 : dt);
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
  cancelSequence(); state.wide = false;
  Object.assign(state, { expression: '', action: 'idle', actionStart: 0, time: 0, paused: false, talk: false });
  $('talk').checked = false;
  state.performance.reset(); updatePerformance(0); state.vrm.springBoneManager?.reset(); frameModel('full');
  syncControls();
}

// ---------- 动作绑定工作台 ----------
let bindings = loadBindings();

function bindingAssetPool(source) {
  if (!source) return null;
  if (source.id.startsWith('m/')) return state.libraries.get('mixamo') || null;
  if (source.id.startsWith('o/')) return state.libraries.get('overte') || null;
  return state.libraries.get('quaternius') || state.libraries.get(state.library) || null;
}

function updateBindingSummary() {
  const stats = bindingStats(bindings);
  $('binding-count').textContent = `${stats.bound} / ${stats.total}`;
  $('binding-model').textContent = state.file ? state.file.replace(/\.vrm$/i, '') : '未载入模型';
}

function renderBoundMotions() {
  const host = $('bound-motions');
  if (!host) return;
  const bound = BINDING_WORDS.filter((word) => sourceById(bindings[word.id]));
  $('bound-count').textContent = String(bound.length);
  host.replaceChildren();
  if (!state.ready) {
    const note = document.createElement('p');
    note.className = 'no-content'; note.textContent = '载入后显示已绑定的动作';
    host.appendChild(note);
    return;
  }
  if (!bound.length) {
    const note = document.createElement('p');
    note.className = 'no-content'; note.textContent = '还没有绑定动作，点下面的「编辑绑定」。';
    host.appendChild(note);
    return;
  }
  for (const word of bound) {
    const source = sourceById(bindings[word.id]);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'expression-button bound-motion';
    button.dataset.word = word.id;
    button.title = source.label;
    const strong = document.createElement('strong'); strong.textContent = word.zh;
    const small = document.createElement('small');
    small.textContent = source.label.replace(/^[^·]+·\s*/, '');
    button.append(strong, small);
    button.onclick = () => previewBinding(word);
    host.appendChild(button);
  }
}

function openBindings() {
  if (!state.ready) { error('先载入一个 VRM，再绑定动作。'); return; }
  renderBindings(); $('binding-dialog').showModal();
}

function renderBindings() {
  const list = $('binding-list');
  list.replaceChildren();
  for (const word of BINDING_WORDS) {
    const row = document.createElement('div');
    row.className = 'binding-row' + (bindings[word.id] ? '' : ' unbound');

    const label = document.createElement('div');
    label.className = 'binding-word';
    const name = document.createElement('strong'); name.textContent = word.zh;
    const note = document.createElement('small'); note.textContent = `${word.id} · ${word.note}`;
    label.append(name, note);

    const select = document.createElement('select');
    select.className = 'binding-select';
    select.setAttribute('aria-label', `${word.zh} 的动作`);
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = word.empty ? '（暂无可绑素材）' : '（留空 · 走通用兜底）';
    select.appendChild(empty);
    for (const source of BINDING_SOURCES) {
      const option = document.createElement('option');
      option.value = source.id; option.textContent = source.label;
      select.appendChild(option);
    }
    select.value = bindings[word.id] || '';

    const play = document.createElement('button');
    play.type = 'button'; play.className = 'binding-play'; play.textContent = '▶';
    play.title = '在舞台上试播这段动作';
    play.setAttribute('aria-label', `试播 ${word.zh}`);
    play.disabled = !select.value || !state.ready;

    select.onchange = () => {
      bindings[word.id] = select.value;
      row.classList.toggle('unbound', !select.value);
      play.disabled = !select.value || !state.ready;
      saveBindings(bindings);
      updateBindingSummary();
    };
    play.onclick = () => previewBinding(word);

    row.append(label, select, play);
    list.appendChild(row);
  }
  updateBindingSummary();
  renderBoundMotions();
}

function previewBinding(word) {
  if (!state.ready || !state.performance) return;
  cancelSequence({ stopMovement: true });
  state.performance.engage('idle');
  state.paused = false;
  void speech.pause(false).catch(() => {});

  // 移动类词交给行走控制器：真实位移 + 足部约束，而不是原地播片段。
  if (word.id === 'walk' || word.id === 'run' || word.id === 'turn') {
    state.wide = true; frameModel('full');
    const pace = word.id === 'run' ? 1.25 : word.id === 'turn' ? .7 : 1;
    if (!state.performance.walk(undefined, { pace })) { error('行走素材没有载入，无法走动。'); return; }
    state.action = word.id;
    syncControls();
    return;
  }

  const source = sourceById(bindings[word.id]);
  if (!source) return;
  const pool = bindingAssetPool(source);
  const loop = word.loop === true || source.loop === true;
  if (source.kind === 'gesture') state.performance.playGesture(source.key, { loop });
  else if (word.id === 'sit') {
    // 坐下是两段式：先播进入，再自动接坐姿循环。
    if (!state.performance.playAsset(source.key, { pool, chain: 'preview-sit-idle' })) { error(`这段素材没有载入：${source.label}`); return; }
  } else if (!state.performance.playAsset(source.key, { loop, pool })) { error(`这段素材没有载入：${source.label}`); return; }
  state.action = word.id;
  syncControls();
}

function downloadBindings() {
  const data = exportBindings(bindings, state.file);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.download = `${(state.file || 'vrm').replace(/\.vrm$/i, '')}-bindings.json`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function bindUI() {
  for (const library of motionLibraries) {
    const option = document.createElement('option'); option.value = library.id; option.textContent = library.name; $('motion-library').append(option);
  }
  $('motion-library').onchange = () => { activateLibrary($('motion-library').value); };
  $('library-open').onclick = () => { renderLibraryDialog(); $('library-dialog').showModal(); };
  $('close-library').onclick = () => $('library-dialog').close();
  $('compare-walk').onclick = () => { void compareWalks(); };
  $('bind-open').onclick = openBindings;
  $('edit-bindings').onclick = openBindings;
  $('close-binding').onclick = () => $('binding-dialog').close();
  $('binding-save').onclick = () => {
    saveBindings(bindings);
    $('binding-save').textContent = '已保存';
    setTimeout(() => { $('binding-save').textContent = '保存到本机'; }, 1200);
  };
  $('binding-export').onclick = downloadBindings;
  $('binding-reset').onclick = () => { bindings = resetBindings(); renderBindings(); };
  $('life').checked = state.life;
  for (const motion of motions) {
    const button = document.createElement('button'); button.className = 'motion-button'; button.dataset.motion = motion.id;
    const icon = document.createElement('span'); icon.className = 'motion-icon'; icon.textContent = motion.icon; icon.ariaHidden = 'true';
    const copy = document.createElement('span'), name = document.createElement('strong'), note = document.createElement('small');
    name.textContent = motion.name; note.textContent = motion.note; copy.append(name, note); button.append(icon, copy);
    button.onclick = () => {
      cancelSequence({ stopMovement: false }); state.performance.engage('idle');
      if (motion.id === 'walk') { state.wide = true; frameModel('full'); state.performance.walk(undefined, { pace: 1 }); }
      else state.performance.playGesture(motion.id, { loop: state.loop });
      state.action = motion.id; state.paused = false; void speech.pause(false); syncControls();
    };
    $('motions').append(button);
  }
  $('open').onclick = () => $('file').click();
  $('file').onchange = () => { const file = $('file').files[0]; if (file) openSource(file); $('file').value = ''; };
  $('sample').onclick = () => openSource({ name: 'aldina.vrm' });
  $('pause').onclick = () => { state.paused = !state.paused; void speech.pause(state.paused).catch(err => error(err.message)); syncControls(); };
  $('scenario').onclick = () => { void runScenario(); };
  for (const button of document.querySelectorAll('[data-engagement]')) button.onclick = () => {
    cancelSequence(); state.performance.engage(button.dataset.engagement); state.paused = false; syncControls();
  };
  $('say').onclick = () => { cancelSequence(); state.paused = false; void saySample().catch(err => error(`音频无法播放：${err.message}`)); };
  $('interrupt').onclick = () => { cancelSequence({ interrupt: true }); syncControls(); };
  $('open-audio').onclick = () => $('audio-file').click();
  $('audio-file').onchange = async () => {
    const file = $('audio-file').files[0]; $('audio-file').value = ''; if (!file) return;
    cancelSequence(); const token = command;
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('请选 32 MiB 以内的音频。');
      const bytes = await file.arrayBuffer(); if (token !== command) return;
      state.paused = false; await speech.play(bytes, file.name);
    } catch (err) { if (token === command) error(`音频无法播放：${err.message}`); }
  };
  $('reset').onclick = resetAll;
  $('neutral').onclick = () => { state.expression = ''; syncControls(); };
  $('amplitude').oninput = () => {
    state.amplitude = Number($('amplitude').value) / 100;
    $('amplitude-value').textContent = `${Math.round(state.amplitude * 100)}%`;
  };
  $('weight').oninput = () => { state.weight = Number($('weight').value) / 100; $('weight-value').textContent = `${Math.round(state.weight * 100)}%`; };
  for (const id of ['blink', 'gaze', 'talk', 'loop', 'life']) $(id).onchange = () => { state[id] = $(id).checked; };
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
  performance: state.performance?.snapshot(),
  speech: speech.snapshot(), scenario: state.scenario,
  library: state.library, libraryAssets: Object.fromEntries([...state.libraries].map(([id, assets]) => [id, assets.size])),
}) }) });

async function loadMotionAssets() {
  const loader = new GLTFLoader(); loader.register(parser => new VRMAnimationLoaderPlugin(parser));
  const cache = new Map();
  const load = url => {
    if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then(gltf => {
      const animation = gltf.userData.vrmAnimations?.[0];
      if (!animation || !Number.isFinite(animation.duration) || animation.duration <= 0 || animation.restHipsPosition.y <= 0) throw new Error('无有效 VRM 动画');
      animation.rootMotion = gltf.parser.json.asset.extras?.rootMotion || null;
      return animation;
    }));
    return cache.get(url);
  };
  for (const library of motionLibraries) {
    const assets = new Map(); assets.library = library;
    const results = await Promise.allSettled(Object.entries(library.assets).map(async ([id, url]) => [id, await load(url)]));
    for (const result of results) if (result.status === 'fulfilled') assets.set(...result.value);
    state.libraries.set(library.id, assets);
    if (assets.size !== Object.keys(library.assets).length) state.assetWarning = '部分动作素材未能读取。可切换另一套动作；缺少的预览会置灰，重新启动后刷新可重试。';
    $('motion-library').querySelector(`option[value="${library.id}"]`).disabled = !assets.has('balanced');
  }
  if (!state.libraries.get(state.library).has('balanced')) state.library = 'overte';
  activateLibrary(state.library, { cancel: false });
}

try {
  bindUI(); initScene(); frameId = requestAnimationFrame(tick);
  const [info] = await Promise.all([fetch('/api/info').then(r => r.json()), loadMotionAssets()]);
  state.demoSpeech = info.demoSpeech;
  if (info.sample) { $('sample').onclick = () => openSource(info.sample); await openSource(info.sample); }
  else { $('status').textContent = '等待打开模型'; $('sample').hidden = true; }
} catch (err) { error(`预览初始化失败：${err.message}`); }

window.addEventListener('pagehide', () => {
  cancelSequence(); speech.dispose();
  state.generation++; pendingFetch?.abort(); cancelAnimationFrame(frameId); resizeObserver?.disconnect(); controls?.dispose();
  state.performance?.dispose(); release(state.vrm); floor?.geometry.dispose(); floor?.material.map.dispose(); floor?.material.dispose(); grid?.geometry.dispose(); grid?.material.dispose(); renderer?.dispose();
}, { once: true });
document.addEventListener('visibilitychange', () => { void speech.pause(document.hidden || state.paused).catch(() => {}); });
