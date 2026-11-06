import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { HandModel, FINGERS, HAND_CHAINS } from './hand-model.mjs';

const $ = (id) => document.getElementById(id);

const state = {
  vrm: null,
  model: new HandModel(),
  bones: new Map(),
  rest: new Map(),
  axes: new Map(),
  handRest: null,
  handAxes: null,
  recording: null,
  runs: [],
  ready: false,
};

let scene, camera, renderer, clock;

init().catch((err) => fail(err.message));

async function init() {
  setupScene();
  await loadVrm();
  bindUi();
  resize();
  window.addEventListener('resize', resize);
  animate();
  state.ready = true;
  $('status').textContent = '手部就绪';
  $('status').classList.add('ready');
}

function setupScene() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  $('viewport').appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899bb, 2.2);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(0.6, 1.2, 1.4);
  scene.add(hemi, key);
  clock = new THREE.Clock();
}

async function loadVrm() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync('/sample.vrm');
  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((obj) => { if (obj.isMesh) obj.frustumCulled = false; });
  scene.add(vrm.scene);
  state.vrm = vrm;
  vrm.scene.updateMatrixWorld(true);

  captureRig();
  frameHand();
}

const cap = (s) => s[0].toUpperCase() + s.slice(1);

function captureRig() {
  const humanoid = state.vrm.humanoid;
  const bone = (name) => humanoid.getNormalizedBoneNode(name);
  const joints = [];
  for (const finger of FINGERS) {
    for (const name of HAND_CHAINS[finger].bones) {
      const b = bone(`right${cap(name)}`);
      if (b) joints.push([name, b]);
    }
  }
  const hand = bone('rightHand');
  const indexBase = bone('rightIndexProximal');
  const littleBase = bone('rightLittleProximal');
  if (!hand || !indexBase || !littleBase) throw new Error('模型缺少右手骨骼');

  hand.updateWorldMatrix(true, false);
  const side = new THREE.Vector3()
    .subVectors(indexBase.getWorldPosition(new THREE.Vector3()), littleBase.getWorldPosition(new THREE.Vector3()))
    .normalize();
  const wristPos = hand.getWorldPosition(new THREE.Vector3());
  const palmNormal = new THREE.Vector3().crossVectors(side, new THREE.Vector3(0, 1, 0)).normalize();
  if (palmNormal.lengthSq() < 1e-4) palmNormal.set(0, 0, 1);

  for (const [name, b] of joints) {
    const restWorld = b.getWorldQuaternion(new THREE.Quaternion());
    const restLocal = b.quaternion.clone();
    const jointPos = b.getWorldPosition(new THREE.Vector3());
    const child = b.children.find((c) => c.isBone) || b;
    const dir = new THREE.Vector3().subVectors(child.getWorldPosition(new THREE.Vector3()), jointPos).normalize();
    let axisWorld = new THREE.Vector3().crossVectors(dir, side).normalize();
    if (axisWorld.lengthSq() < 1e-5) axisWorld.copy(palmNormal);

    // 用一个小角度试探，确认正方向是朝掌心（朝手腕）弯
    const probe = restLocal.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(
        axisWorld.clone().applyQuaternion(restWorld.clone().invert()).normalize(), 0.2,
      ),
    );
    const before = child.getWorldPosition(new THREE.Vector3());
    b.quaternion.copy(probe); b.updateWorldMatrix(true, true);
    const after = child.getWorldPosition(new THREE.Vector3());
    b.quaternion.copy(restLocal); b.updateWorldMatrix(true, true);
    const towardWrist = new THREE.Vector3().subVectors(wristPos, jointPos).normalize();
    if (after.sub(before).dot(towardWrist) < 0) axisWorld.negate();

    state.bones.set(name, b);
    state.rest.set(name, restLocal);
    state.axes.set(name, axisWorld.applyQuaternion(restWorld.clone().invert()).normalize());
  }

  state.bones.set('hand', hand);
  state.rest.set('hand', hand.quaternion.clone());
  const flexWorld = side.clone();
  const devWorld = palmNormal.clone();
  const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
  state.handAxes = {
    flex: flexWorld.applyQuaternion(handWorld.clone().invert()).normalize(),
    deviation: devWorld.applyQuaternion(handWorld.clone().invert()).normalize(),
  };
  state.handRest = hand.quaternion.clone();
}

function frameHand() {
  const hand = state.bones.get('hand');
  const p = hand.getWorldPosition(new THREE.Vector3());
  const d = 0.62;
  camera.position.set(p.x + d * 0.35, p.y + d * 0.18, p.z + d);
  camera.up.set(0, 1, 0);
  camera.lookAt(p.x, p.y, p.z);
  camera.near = 0.01;
  camera.far = 10;
  camera.updateProjectionMatrix();
}

function applyPose() {
  const q = new THREE.Quaternion();
  for (const finger of FINGERS) {
    for (const name of HAND_CHAINS[finger].bones) {
      const bone = state.bones.get(name);
      if (!bone) continue;
      const angle = state.model.joints.get(name)?.q ?? 0;
      bone.quaternion.copy(state.rest.get(name)).multiply(q.setFromAxisAngle(state.axes.get(name), angle));
    }
  }
  const hand = state.bones.get('hand');
  const flex = state.model.joints.get('hand:flex')?.q ?? 0;
  const dev = state.model.joints.get('hand:deviation')?.q ?? 0;
  hand.quaternion.copy(state.handRest)
    .multiply(q.setFromAxisAngle(state.handAxes.flex, flex))
    .multiply(q.setFromAxisAngle(state.handAxes.deviation, dev));
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.ready) {
    state.model.step(dt);
    applyPose();
    if (state.vrm) state.vrm.update(dt);
    recordSample();
    updateReadout();
  }
  renderer.render(scene, camera);
}

function recordSample() {
  if (!state.recording) return;
  const snap = state.model.snapshot();
  state.recording.values.push(snap.joints.indexProximal.angle);
  state.recording.t += 1 / 60;
  if (state.recording.t >= 1.4) {
    state.runs.push(state.recording);
    if (state.runs.length > 2) state.runs.shift();
    state.recording = null;
    drawPlot();
  }
}

function updateReadout() {
  const snap = state.model.snapshot();
  $('stiffness').textContent = snap.stiffness.toFixed(0);
  $('angle').textContent = `${((snap.joints.indexProximal.angle * 180) / Math.PI).toFixed(1)}°`;
  $('coact').textContent = `${Math.round(snap.input.coactivation * 100)}%`;
}

function drawPlot() {
  const canvas = $('plot');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#fbfcff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e7ebf3';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke();
  }
  const colors = ['#7c93c9', '#e2725b'];
  state.runs.forEach((run, i) => {
    const values = run.values;
    const min = Math.min(...values), max = Math.max(...values);
    const span = Math.max(0.02, max - min);
    ctx.strokeStyle = colors[i] || '#999';
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((v, j) => {
      const x = (j / (values.length - 1)) * w;
      const y = h - 10 - ((v - min) / span) * (h - 30);
      if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = colors[i] || '#999';
    ctx.font = '11px sans-serif';
    ctx.fillText(run.label || `run ${i + 1}`, 10, 16 + i * 16);
  });
}

function runImpulse(label) {
  if (state.recording) return;
  state.recording = { label, values: [], t: 0 };
  state.model.impulse(8);
}

function bindUi() {
  const curls = ['thumb', 'index', 'middle', 'ring', 'little'];
  curls.forEach((name, i) => {
    const input = $(`curl-${name}`);
    input.oninput = () => {
      const next = [...state.model.input.curls];
      next[i] = Number(input.value) / 100;
      state.model.setInput({ curls: next });
      $(`curl-${name}-value`).textContent = `${input.value}%`;
    };
  });
  $('opposition').oninput = () => {
    state.model.setInput({ opposition: Number($('opposition').value) / 100 });
    $('opposition-value').textContent = `${$('opposition').value}%`;
  };
  $('wrist-flex').oninput = () => {
    state.model.setInput({ wrist: [Number($('wrist-flex').value) / 100, Number($('wrist-dev').value) / 100] });
  };
  $('wrist-dev').oninput = () => {
    state.model.setInput({ wrist: [Number($('wrist-flex').value) / 100, Number($('wrist-dev').value) / 100] });
  };
  $('coactivation').oninput = () => {
    state.model.setInput({ coactivation: Number($('coactivation').value) / 100 });
  };
  $('reflex').oninput = () => {
    state.model.setInput({ reflex: Number($('reflex').value) / 100 });
  };
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.onclick = () => {
      state.model.applyPreset(button.dataset.preset);
      syncSliders();
    };
  }
  $('impulse-relaxed').onclick = () => {
    $('coactivation').value = 0; state.model.setInput({ coactivation: 0 });
    runImpulse('放松');
  };
  $('impulse-braced').onclick = () => {
    $('coactivation').value = 90; state.model.setInput({ coactivation: 0.9 });
    runImpulse('绷紧');
  };
  $('clear-plot').onclick = () => { state.runs = []; drawPlot(); };
  $('reset').onclick = () => { state.model = new HandModel(); syncSliders(); state.runs = []; drawPlot(); };
  $('export').onclick = () => {
    const data = JSON.stringify(state.model.snapshot(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = 'hand-state.json';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  syncSliders();
}

function syncSliders() {
  const curls = ['thumb', 'index', 'middle', 'ring', 'little'];
  curls.forEach((name, i) => {
    const v = Math.round(state.model.input.curls[i] * 100);
    $(`curl-${name}`).value = v;
    $(`curl-${name}-value`).textContent = `${v}%`;
  });
  $('opposition').value = Math.round(state.model.input.opposition * 100);
  $('opposition-value').textContent = `${$('opposition').value}%`;
  $('wrist-flex').value = Math.round(state.model.input.wrist[0] * 100);
  $('wrist-dev').value = Math.round(state.model.input.wrist[1] * 100);
  $('coactivation').value = Math.round(state.model.input.coactivation * 100);
  $('reflex').value = Math.round(state.model.input.reflex * 100);
}

function resize() {
  const el = $('viewport');
  const w = el.clientWidth, h = el.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function fail(message) {
  $('status').textContent = message;
  $('status').classList.add('bad');
  console.error(message);
}

window.__handLab = {
  state,
  snapshot: () => state.model.snapshot(),
  impulse: (v) => runImpulse(String(v)),
  set: (patch) => { state.model.setInput(patch); syncSliders(); },
  preset: (name) => { state.model.applyPreset(name); syncSliders(); },
  // 调试用：不依赖 rAF，手动推进并立刻重绘
  tick: (steps = 60, dt = 1 / 60) => {
    for (let i = 0; i < steps; i++) state.model.step(dt);
    applyPose();
    if (state.vrm) state.vrm.update(dt * steps);
    updateReadout();
    renderer.render(scene, camera);
    return state.model.snapshot();
  },
  camera: () => ({ position: camera.position.toArray(), aspect: camera.aspect }),
  reframe: () => { resize(); frameHand(); renderer.render(scene, camera); return { position: camera.position.toArray(), aspect: camera.aspect }; },
};
