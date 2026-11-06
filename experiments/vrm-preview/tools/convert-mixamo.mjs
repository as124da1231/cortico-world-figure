/**
 * Mixamo FBX → VRMA（VRMC_vrm_animation）。
 *
 * 为什么离线烘焙：运行时不需要 FBXLoader，也不需要重定向；形象包里只有标准 VRMA，
 * 由 @pixiv/three-vrm-animation 的官方适配直接播放。
 *
 * 骨骼映射与坐标处理沿用 convert-quaternius.mjs 的做法：
 *   源骨骼在 T-pose 下的世界朝向 → 每帧相对旋转 → 对齐到 VRM 规范骨架。
 *
 * 用法：
 *   node tools/convert-mixamo.mjs <input.fbx> <id> [outputDir]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const input = resolve(process.argv[2] || '');
const id = String(process.argv[3] || 'mixamo').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const output = resolve(process.argv[4] || join(project, 'assets/animations/mixamo'));
const UNIT = 0.01; // Mixamo 用厘米，VRM 用米

/** Mixamo 骨骼名 → VRM humanoid 名。手指暂不导出，运行时由 VRM 自己的骨长决定。 */
const MAPPING = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head',
  leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftArm', leftLowerArm: 'LeftForeArm', leftHand: 'LeftHand',
  rightShoulder: 'RightShoulder', rightUpperArm: 'RightArm', rightLowerArm: 'RightForeArm', rightHand: 'RightHand',
  leftUpperLeg: 'LeftUpLeg', leftLowerLeg: 'LeftLeg', leftFoot: 'LeftFoot', leftToes: 'LeftToeBase',
  rightUpperLeg: 'RightUpLeg', rightLowerLeg: 'RightLeg', rightFoot: 'RightFoot', rightToes: 'RightToeBase',
};

const bytes = await readFile(input);
const fbx = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
if (!fbx.animations.length) throw new Error(`FBX 里没有动画：${input}`);
const clip = fbx.animations[0];

const byMixamo = new Map();
fbx.traverse((o) => { if (o.isBone && !byMixamo.has(o.name)) byMixamo.set(o.name, o); });
const bones = new Map();
for (const [vrm, mixamo] of Object.entries(MAPPING)) {
  const bone = byMixamo.get(`mixamorig${mixamo}`) || byMixamo.get(mixamo);
  if (!bone) throw new Error(`缺少骨骼：mixamorig${mixamo}`);
  bones.set(vrm, bone);
}

// T-pose 基准：FBX 默认姿势就是绑定姿势，先不播动画。
fbx.updateMatrixWorld(true);
const rest = new Map();
for (const [name, bone] of bones) {
  let parent = bone.parent;
  while (parent && ![...bones.values()].includes(parent)) parent = parent.parent;
  const parentName = parent ? [...bones].find(([, b]) => b === parent)?.[0] ?? null : null;
  rest.set(name, {
    world: bone.getWorldQuaternion(new THREE.Quaternion()),
    position: bone.getWorldPosition(new THREE.Vector3()).multiplyScalar(UNIT),
    parent: parentName,
  });
}

// 用双手朝向建立横向基准，和 Quaternius 转换保持一致。
const leftHand = bones.get('leftHand').getWorldPosition(new THREE.Vector3());
const rightHand = bones.get('rightHand').getWorldPosition(new THREE.Vector3());
const x = leftHand.clone().sub(rightHand); x.y = 0; x.normalize();
const basis = new THREE.Matrix4().makeBasis(x, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(x, new THREE.Vector3(0, 1, 0)));
const align = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
const alignInverse = align.clone().invert();

const mixer = new THREE.AnimationMixer(fbx);
const action = mixer.clipAction(clip);
action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); mixer.setTime(0);

const restHip = rest.get('hips').position.clone();
const fps = 30;
const count = Math.max(1, Math.round(clip.duration * fps));
const times = [], hipTrack = [], rotations = new Map([...bones.keys()].map((name) => [name, []]));

for (let i = 0; i <= count; i++) {
  const time = i / count * clip.duration;
  times.push(+time.toFixed(6));
  mixer.setTime(time); fbx.updateMatrixWorld(true);
  const hip = bones.get('hips').getWorldPosition(new THREE.Vector3()).applyQuaternion(align).multiplyScalar(UNIT);
  hipTrack.push(hip.x - restHip.x, hip.y - restHip.y, hip.z - restHip.z);
  for (const [name, bone] of bones) {
    const reference = rest.get(name);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    const parentRest = reference.parent ? rest.get(reference.parent) : null;
    const parentBone = reference.parent ? bones.get(reference.parent) : null;
    const delta = parentRest && parentBone
      ? parentRest.world.clone()
        .multiply(parentBone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world))
        .multiply(reference.world.clone().invert())
      : world.multiply(reference.world.clone().invert());
    delta.premultiply(align).multiply(alignInverse).normalize();
    const values = rotations.get(name);
    if (values.length && new THREE.Quaternion().fromArray(values, values.length - 4).dot(delta) < 0) {
      delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    }
    values.push(...delta.toArray());
  }
}

// ---- 写 GLB（与 convert-quaternius.mjs 相同的结构）----
const names = [...bones.keys()];
const index = new Map(names.map((name, i) => [name, i]));
const nodes = [], humanBones = {};
for (const name of names) {
  const reference = rest.get(name);
  const p = reference.position.clone();
  if (reference.parent) p.sub(rest.get(reference.parent).position);
  const children = [...rest].filter(([, r]) => r.parent === name).map(([n]) => index.get(n));
  nodes.push({ name, translation: p.toArray(), ...(children.length ? { children } : {}) });
  humanBones[name] = { node: index.get(name) };
}

const parts = [], views = [], accessors = [], channels = [], samplers = [];
let offset = 0;
const accessor = (values, type, width, bounds = false) => {
  const data = Buffer.from(new Float32Array(values).buffer); parts.push(data);
  views.push({ buffer: 0, byteOffset: offset, byteLength: data.length }); offset += data.length;
  accessors.push({ bufferView: views.length - 1, componentType: 5126, count: values.length / width, type, ...(bounds ? { min: [values[0]], max: [values.at(-1)] } : {}) });
  return accessors.length - 1;
};
const inputAccessor = accessor(times, 'SCALAR', 1, true);
for (const name of names) {
  const values = rotations.get(name);
  const outputAccessor = accessor(values, 'VEC4', 4);
  samplers.push({ input: inputAccessor, output: outputAccessor, interpolation: 'LINEAR' });
  channels.push({ sampler: samplers.length - 1, target: { node: index.get(name), path: 'rotation' } });
}
const hipAccessor = accessor(hipTrack, 'VEC3', 3);
samplers.push({ input: inputAccessor, output: hipAccessor, interpolation: 'LINEAR' });
channels.push({ sampler: samplers.length - 1, target: { node: index.get('hips'), path: 'translation' } });

const json = {
  asset: {
    version: '2.0',
    generator: 'Coo VRM workbench / Mixamo FBX conversion',
    extras: { sourceTake: clip.name, sourceFile: input.split(/[\\/]/).pop() },
  },
  extensionsUsed: ['VRMC_vrm_animation'],
  extensionsRequired: ['VRMC_vrm_animation'],
  extensions: { VRMC_vrm_animation: { specVersion: '1.0', humanoid: { humanBones } } },
  scene: 0,
  scenes: [{ nodes: [index.get('hips')] }],
  nodes,
  buffers: [{ byteLength: offset }],
  bufferViews: views,
  accessors,
  animations: [{ name: id, samplers, channels }],
};

const rawJson = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 0x20);
rawJson.copy(jsonChunk);
const binary = Buffer.concat(parts);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonChunk, binHeader, binary]);

await mkdir(output, { recursive: true });
const file = join(output, `${id}.vrma`);
await writeFile(file, glb);
console.log(JSON.stringify({
  id, file, bytes: glb.length, duration: +clip.duration.toFixed(3),
  bones: names.length, sha256: createHash('sha256').update(glb).digest('hex'),
}, null, 2));
