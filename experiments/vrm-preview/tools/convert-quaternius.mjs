import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(process.argv[2] || join(project, '.local/vendor/quaternius-source/Universal Animation Library[Standard]'));
const output = join(project, 'assets/animations/quaternius');
const selected = {
  idle: 'Idle_Loop', talking: 'Idle_Talking_Loop', walk: 'Walk_Loop', 'walk-formal': 'Walk_Formal_Loop',
  jog: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop', dance: 'Dance_Loop', interact: 'Interact',
  'sit-enter': 'Sitting_Enter', 'sit-idle': 'Sitting_Idle_Loop', 'sit-talking': 'Sitting_Talking_Loop', 'sit-exit': 'Sitting_Exit',
};
const mapping = { hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03', neck: 'neck_01', head: 'Head' };
for (const [side, suffix] of [['left', 'l'], ['right', 'r']]) {
  for (const [name, node] of Object.entries({ Shoulder: 'clavicle', UpperArm: 'upperarm', LowerArm: 'lowerarm', Hand: 'hand', UpperLeg: 'thigh', LowerLeg: 'calf', Foot: 'foot', Toes: 'ball' })) mapping[side + name] = `${node}_${suffix}`;
  for (const [finger, node] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Little', 'pinky']]) {
    const joints = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    joints.forEach((joint, i) => { mapping[side + finger + joint] = `${node}_0${i + 1}_${suffix}`; });
  }
}
const loader = new GLTFLoader();
async function load(name) {
  const bytes = await readFile(join(source, 'Unreal-Godot', name));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return { ...gltf, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const model = await load('UAL1_Standard.glb'), rooted = await load('UAL1_Standard_RM.glb');
if (model.sha256 !== '69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997' || rooted.sha256 !== 'be684571ed655a1b892c2c07e6e2aeca053b606c442d34004adaf1d944090d01') {
  throw new Error('Input files differ from the pinned Standard v3.0 source; review source metadata before converting.');
}
const mixer = new THREE.AnimationMixer(model.scene), rootMixer = new THREE.AnimationMixer(rooted.scene);
function play(mixer, clips, name) {
  mixer.stopAllAction(); const clip = clips.find(clip => clip.name === name);
  if (!clip) throw new Error(`Source clip missing: ${name}`);
  const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); mixer.setTime(0);
  return clip;
}
play(mixer, model.animations, 'A_TPose'); model.scene.updateMatrixWorld(true);
const bones = new Map(Object.entries(mapping).map(([name, source]) => [name, model.scene.getObjectByName(source)]));
if ([...bones.values()].some(bone => !bone)) throw new Error('Source humanoid mapping is incomplete');
const byNode = new Map([...bones].map(([name, node]) => [node, name]));
const x = bones.get('leftHand').getWorldPosition(new THREE.Vector3()).sub(bones.get('rightHand').getWorldPosition(new THREE.Vector3()));
x.y = 0; x.normalize();
const basis = new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)));
const align = new THREE.Quaternion().setFromRotationMatrix(basis).invert(), alignInverse = align.clone().invert();
const rest = new Map([...bones].map(([name, bone]) => {
  let parent = bone.parent; while (parent && !byNode.has(parent)) parent = parent.parent;
  return [name, { world: bone.getWorldQuaternion(new THREE.Quaternion()), position: bone.getWorldPosition(new THREE.Vector3()).applyQuaternion(align), parent: parent ? byNode.get(parent) : null }];
}));
const restHip = rest.get('hips').position;
const catalog = [];
await mkdir(output, { recursive: true });
for (const [id, take] of Object.entries(selected)) {
  const clip = play(mixer, model.animations, take); play(rootMixer, rooted.animations, take);
  const count = Math.max(1, Math.round(clip.duration * 30)), times = [], hips = [], rotations = new Map([...bones.keys()].map(name => [name, []]));
  const rootTimes = [], rootDistances = [], rootNode = rooted.scene.getObjectByName('root');
  let rootStart;
  for (let i = 0; i <= count; i++) {
    const time = i / count * clip.duration; times.push(time); mixer.setTime(time); rootMixer.setTime(time);
    model.scene.updateMatrixWorld(true); rooted.scene.updateMatrixWorld(true);
    const p = bones.get('hips').getWorldPosition(new THREE.Vector3()).applyQuaternion(align);
    hips.push(p.x - restHip.x, p.y, p.z - restHip.z);
    for (const [name, bone] of bones) {
      const reference = rest.get(name), world = bone.getWorldQuaternion(new THREE.Quaternion());
      const delta = reference.parent
        ? rest.get(reference.parent).world.clone().multiply(bones.get(reference.parent).getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).multiply(reference.world.clone().invert())
        : world.multiply(reference.world.clone().invert());
      delta.premultiply(align).multiply(alignInverse).normalize();
      const values = rotations.get(name);
      if (values.length && new THREE.Quaternion().fromArray(values, values.length - 4).dot(delta) < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      values.push(...delta.toArray());
    }
    const root = rootNode.getWorldPosition(new THREE.Vector3()).applyQuaternion(align);
    rootStart ||= root.clone(); rootTimes.push(time); rootDistances.push(Math.max(0, root.z - rootStart.z));
  }
  const nodes = [], humanBones = {}, index = new Map([...bones.keys()].map((name, i) => [name, i]));
  for (const [name] of bones) {
    const reference = rest.get(name), p = reference.position.clone();
    if (reference.parent) p.sub(rest.get(reference.parent).position);
    const children = [...rest].filter(([, r]) => r.parent === name).map(([n]) => index.get(n));
    nodes.push({ name, translation: p.toArray(), ...(children.length ? { children } : {}) }); humanBones[name] = { node: index.get(name) };
  }
  const parts = [], views = [], accessors = [], channels = [], samplers = [];
  let bytes = 0;
  const accessor = (values, type, width, bounds = false) => {
    const data = Buffer.from(new Float32Array(values).buffer); parts.push(data);
    views.push({ buffer: 0, byteOffset: bytes, byteLength: data.length }); bytes += data.length;
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: values.length / width, type, ...(bounds ? { min: [values[0]], max: [values.at(-1)] } : {}) });
    return accessors.length - 1;
  };
  const input = accessor(times, 'SCALAR', 1, true);
  for (const [name, values] of rotations) {
    const output = accessor(values, 'VEC4', 4); samplers.push({ input, output, interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: index.get(name), path: 'rotation' } });
  }
  const position = accessor(hips, 'VEC3', 3); samplers.push({ input, output: position, interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: index.get('hips'), path: 'translation' } });
  const travel = rootDistances.at(-1), rootMotion = travel > .05 ? { times: rootTimes, distances: rootDistances, restHipsHeight: restHip.y, distance: travel } : null;
  const json = { asset: { version: '2.0', generator: 'Coo VRM preview / Quaternius CC0 conversion', copyright: 'Quaternius (CC0-1.0)', extras: { sourceTake: take, ...(rootMotion ? { rootMotion } : {}) } }, extensionsUsed: ['VRMC_vrm_animation'], extensionsRequired: ['VRMC_vrm_animation'], extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones } } }, scene: 0, scenes: [{ nodes: [index.get('hips')] }], nodes, buffers: [{ byteLength: bytes }], bufferViews: views, accessors, animations: [{ name: take, samplers, channels }] };
  const raw = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 0x20); raw.copy(jsonChunk);
  const binary = Buffer.concat(parts), header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8); header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, jsonChunk, binHeader, binary]); await writeFile(join(output, `${id}.vrma`), glb);
  catalog.push({ id, file: `${id}.vrma`, sourceTake: take, duration: clip.duration, bytes: glb.length, sha256: createHash('sha256').update(glb).digest('hex'), rootMotionDistance: rootMotion?.distance || 0 });
}
await writeFile(join(output, 'UPSTREAM-LICENSE.txt'), await readFile(join(source, 'License.txt')));
await writeFile(join(output, 'UPSTREAM-README.txt'), await readFile(join(source, 'README.txt')));
const report = { author: 'Quaternius', source: 'https://quaternius.itch.io/universal-animation-library', edition: 'Standard v3.0 (free)', license: 'CC0-1.0', archiveSha256: 'cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724', inputFiles: { 'UAL1_Standard.glb': model.sha256, 'UAL1_Standard_RM.glb': rooted.sha256 }, sourceClipCount: model.animations.length, fps: 30, modifications: 'Retarget from the supplied T-pose to canonical VRMA humanoid rotations. Retain original in-place poses, extract root travel separately from the supplied RM variant. Remove source meshes, skins and unused clips. No generated motion.', clips: catalog };
await writeFile(join(output, 'sources.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ clips: catalog.length, sourceClips: model.animations.length, restHipsHeight: restHip.y, motions: catalog.map(c => ({ id: c.id, duration: c.duration, travel: c.rootMotionDistance })) }, null, 2));
