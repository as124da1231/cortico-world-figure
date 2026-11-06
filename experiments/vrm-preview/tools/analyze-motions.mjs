/**
 * 动作体检：把每个 VRMA 的骨骼曲线量化成可比较的数字。
 *
 * 目的不是"看"动作，而是回答：
 *   这段走路手臂摆了多少度？腿抬了多高？骨盆有没有起伏？
 *   哪一段最像人，哪一段是僵硬的游戏动画。
 *
 * 只读本地素材，不联网、不改模型、不写包。
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

const dirs = ['assets/animations/quaternius', 'assets/animations/overte', 'assets/animations/mixamo'];
const loader = new GLTFLoader();
loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

const DEG = 180 / Math.PI;
const quat = (values, i) => new THREE.Quaternion(values[i], values[i + 1], values[i + 2], values[i + 3]);
const swing = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * DEG;

/** 一条旋转轨道的统计：总摆幅、最大角速度、平均角速度。 */
function trackStats(track) {
  const { times, values } = track;
  const n = times.length;
  let range = 0, maxSpeed = 0, total = 0, prev = quat(values, 0);
  const first = prev.clone();
  for (let i = 1; i < n; i++) {
    const q = quat(values, i * 4);
    const d = swing(prev, q);
    const dt = Math.max(1e-6, times[i] - times[i - 1]);
    range += d;
    total += d;
    maxSpeed = Math.max(maxSpeed, d / dt);
    prev = q;
  }
  range = Math.max(range, swing(first, prev));
  const duration = times[n - 1] - times[0] || 1;
  return { range: +range.toFixed(1), maxSpeed: +maxSpeed.toFixed(0), meanSpeed: +(total / duration).toFixed(0) };
}

const rows = [];
for (const dir of dirs) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.vrma')); } catch { continue; }
  for (const file of files) {
    const path = join(dir, file);
    const bytes = await readFile(path);
    let gltf;
    try {
      gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    } catch (err) {
      rows.push({ clip: basename(file, extname(file)), dir, error: String(err.message).slice(0, 60) });
      continue;
    }
    const animation = gltf.userData.vrmAnimations?.[0];
    if (!animation) { rows.push({ clip: basename(file, extname(file)), dir, error: 'no VRMAnimation' }); continue; }

    const rotation = animation.humanoidTracks?.rotation;
    const translation = animation.humanoidTracks?.translation;
    const names = rotation instanceof Map ? [...rotation.keys()] : [];
    const pick = (name) => rotation?.get?.(name);
    const stats = {};
    for (const name of ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'spine', 'chest', 'head']) {
      const t = pick(name);
      if (t) stats[name] = trackStats(t);
    }
    const hips = { translation: translation?.get?.('hips') };
    let bob = null;
    if (hips?.translation) {
      const v = hips.translation.values;
      let min = Infinity, max = -Infinity;
      for (let i = 1; i < v.length; i += 3) { min = Math.min(min, v[i]); max = Math.max(max, v[i]); }
      bob = +(max - min).toFixed(3);
    }
    const arm = ((stats.leftUpperArm?.range ?? 0) + (stats.rightUpperArm?.range ?? 0)) / 2;
    const leg = ((stats.leftUpperLeg?.range ?? 0) + (stats.rightUpperLeg?.range ?? 0)) / 2;
    const fore = ((stats.leftLowerLeg?.range ?? 0) + (stats.rightLowerLeg?.range ?? 0)) / 2;
    const torso = ((stats.spine?.range ?? 0) + (stats.chest?.range ?? 0)) / 2;
    // 僵硬分：摆幅越低、角速度越平，越像游戏动画。0 最好，100 最僵。
    const liveliness = Math.min(100, Math.round(arm * 0.45 + leg * 0.3 + fore * 0.15 + torso * 0.1));
    rows.push({
      clip: basename(file, extname(file)), dir,
      seconds: +animation.duration.toFixed(2),
      bones: names.length,
      arm: +arm.toFixed(0), leg: +leg.toFixed(0), fore: +fore.toFixed(0), torso: +torso.toFixed(0),
      bob, liveliness,
    });
  }
}

const ok = rows.filter((r) => !r.error).sort((a, b) => b.liveliness - a.liveliness);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('clip', 22), pad('source', 12), pad('sec', 6), pad('arm', 5), pad('leg', 5), pad('fore', 5), pad('torso', 6), pad('bob', 7), 'lively');
for (const r of ok) {
  console.log(pad(r.clip, 22), pad(r.dir.includes('overte') ? 'Overte' : r.dir.includes('mixamo') ? 'Mixamo' : 'Quaternius', 12), pad(r.seconds, 6), pad(r.arm, 5), pad(r.leg, 5), pad(r.fore, 5), pad(r.torso, 6), pad(r.bob ?? '-', 7), r.liveliness);
}
for (const r of rows.filter((x) => x.error)) console.log(pad(r.clip, 22), r.dir, 'ERROR', r.error);
