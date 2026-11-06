/**
 * 从动作语料里学出 VRM 的"运动协同基"。
 *
 * 思路：把所有 VRMA 的归一化骨骼四元数展平成向量，做 PCA。
 * 前 k 个主成分就是这套语料真正需要的自由度——多一个不多，少一个会丢信息。
 *
 * 输出：
 *   - 解释方差曲线（k = 1..16）
 *   - k 达到 90% / 95% / 99% 的位置
 *   - 每个主成分主要在动哪几根骨
 *   - 重建角度误差（度）
 *   - .local/synergies.json（均值 + 基向量，供后续控制器使用）
 *
 * 只读本地素材，不联网。
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';

const DIRS = ['assets/animations/quaternius', 'assets/animations/overte', 'assets/animations/mixamo'];
const MAX_FRAMES = 9000;
const COMPONENTS = 16;
const DEG = 180 / Math.PI;

const loader = new GLTFLoader();
loader.register((p) => new VRMAnimationLoaderPlugin(p));

// ---------- 读语料 ----------
const clips = [];
for (const dir of DIRS) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.vrma')); } catch { continue; }
  for (const file of files) {
    const bytes = await readFile(join(dir, file));
    try {
      const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      const animation = gltf.userData.vrmAnimations?.[0];
      if (animation) clips.push({ id: basename(file, extname(file)), dir, animation });
    } catch { /* 坏文件跳过 */ }
  }
}

// ---------- 取所有片段都有的骨骼 ----------
const sets = clips.map((c) => new Set(c.animation.humanoidTracks.rotation.keys()));
const common = [...sets[0].keys()].filter((name) => sets.every((s) => s.has(name))).sort();
if (common.length < 8) throw new Error('公共骨骼太少，语料不一致');
const D = common.length * 4;

// ---------- 逐段采样（四元数符号连续） ----------
function sample(clip) {
  const tracks = clip.animation.humanoidTracks.rotation;
  const first = tracks.get(common[0]);
  const times = first.times;
  const frames = [];
  for (let i = 0; i < times.length; i++) {
    const row = new Float64Array(D);
    for (let b = 0; b < common.length; b++) {
      const t = tracks.get(common[b]);
      const q = new THREE.Quaternion(t.values[i * 4], t.values[i * 4 + 1], t.values[i * 4 + 2], t.values[i * 4 + 3]);
      if (i > 0) {
        const prev = new THREE.Quaternion(row[b * 4], row[b * 4 + 1], row[b * 4 + 2], row[b * 4 + 3]);
        if (prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      }
      row[b * 4] = q.x; row[b * 4 + 1] = q.y; row[b * 4 + 2] = q.z; row[b * 4 + 3] = q.w;
    }
    frames.push(row);
  }
  return frames;
}

const sampled = clips.map((c) => ({ id: c.id, frames: sample(c) })).filter((c) => c.frames.length > 1);

// ---------- 两遍对齐：先算均值，再统一每段的整体符号 ----------
function meanOf(list) {
  const m = new Float64Array(D);
  let n = 0;
  for (const c of list) for (const row of c.frames) { for (let i = 0; i < D; i++) m[i] += row[i]; n++; }
  for (let i = 0; i < D; i++) m[i] /= Math.max(1, n);
  return m;
}
const rough = meanOf(sampled);
for (const c of sampled) {
  const first = c.frames[0];
  let dot = 0;
  for (let i = 0; i < D; i++) dot += first[i] * rough[i];
  if (dot < 0) for (const row of c.frames) for (let i = 0; i < D; i++) row[i] = -row[i];
}

// ---------- 均匀抽样到 MAX_FRAMES ----------
const totalFrames = sampled.reduce((n, c) => n + c.frames.length, 0);
const stride = Math.max(1, Math.ceil(totalFrames / MAX_FRAMES));
const rows = [];
for (const c of sampled) for (let i = 0; i < c.frames.length; i += stride) rows.push(c.frames[i]);
const mean = meanOf([{ frames: rows }]);
const N = rows.length;

// ---------- 协方差 ----------
const C = new Float64Array(D * D);
for (const row of rows) {
  for (let i = 0; i < D; i++) {
    const xi = row[i] - mean[i];
    if (!xi) continue;
    for (let j = i; j < D; j++) C[i * D + j] += xi * (row[j] - mean[j]);
  }
}
for (let i = 0; i < D; i++) for (let j = i; j < D; j++) {
  const v = C[i * D + j] / Math.max(1, N - 1);
  C[i * D + j] = v; C[j * D + i] = v;
}
let trace = 0; for (let i = 0; i < D; i++) trace += C[i * D + i];

// ---------- 幂迭代 + 收缩 ----------
let seed = 1234567;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const basis = [], eigenvalues = [];
for (let k = 0; k < COMPONENTS; k++) {
  const v = new Float64Array(D);
  for (let i = 0; i < D; i++) v[i] = rnd() - .5;
  let norm = Math.hypot(...v); for (let i = 0; i < D; i++) v[i] /= norm;
  for (let it = 0; it < 80; it++) {
    const w = new Float64Array(D);
    for (let i = 0; i < D; i++) {
      let s = 0;
      for (let j = 0; j < D; j++) s += C[i * D + j] * v[j];
      w[i] = s;
    }
    norm = Math.hypot(...w); if (!norm) break;
    for (let i = 0; i < D; i++) v[i] = w[i] / norm;
  }
  let lambda = 0;
  for (let i = 0; i < D; i++) {
    let s = 0;
    for (let j = 0; j < D; j++) s += C[i * D + j] * v[j];
    lambda += v[i] * s;
  }
  basis.push(v); eigenvalues.push(Math.max(0, lambda));
  for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) C[i * D + j] -= lambda * v[i] * v[j];
}

// ---------- 重建误差（角度） ----------
function reconstruct(row, k) {
  const out = new Float64Array(D);
  out.set(mean);
  for (let c = 0; c < k; c++) {
    let a = 0;
    for (let i = 0; i < D; i++) a += basis[c][i] * (row[i] - mean[i]);
    for (let i = 0; i < D; i++) out[i] += a * basis[c][i];
  }
  return out;
}
function angularError(row, k) {
  const r = reconstruct(row, k);
  let sum = 0, n = 0;
  for (let b = 0; b < common.length; b++) {
    const trueQ = new THREE.Quaternion(row[b * 4], row[b * 4 + 1], row[b * 4 + 2], row[b * 4 + 3]).normalize();
    const recQ = new THREE.Quaternion(r[b * 4], r[b * 4 + 1], r[b * 4 + 2], r[b * 4 + 3]).normalize();
    sum += 2 * Math.acos(Math.min(1, Math.abs(trueQ.dot(recQ)))) * DEG; n++;
  }
  return sum / n;
}
const testRows = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 400)) === 0);

// ---------- 报告 ----------
const pad = (s, n) => String(s).padEnd(n);
console.log(`语料 ${sampled.length} 段 / ${totalFrames} 帧，抽样 ${N} 帧`);
console.log(`公共骨骼 ${common.length} 根（${common.join(', ')}）`);
console.log('');
console.log(pad('k', 4), pad('解释方差', 12), pad('累计', 10), pad('重建误差', 10));
let cumulative = 0;
const report = [];
for (let k = 1; k <= COMPONENTS; k++) {
  const ratio = eigenvalues[k - 1] / trace;
  cumulative += ratio;
  const error = testRows.reduce((s, r) => s + angularError(r, k), 0) / testRows.length;
  report.push({ k, ratio, cumulative, error });
  console.log(pad(k, 4), pad((ratio * 100).toFixed(2) + '%', 12), pad((cumulative * 100).toFixed(2) + '%', 10), pad(error.toFixed(2) + '°', 10));
}

const at = (target) => report.find((r) => r.cumulative >= target)?.k ?? '>16';
console.log('');
console.log(`90% 方差需要 k=${at(.90)}；95% k=${at(.95)}；99% k=${at(.99)}`);

// 每个主成分主要动哪几根骨
console.log('\n主成分负载（每根骨 4 个分量的模长）：');
for (let c = 0; c < Math.min(6, COMPONENTS); c++) {
  const loads = common.map((name, b) => ({
    name,
    w: Math.hypot(basis[c][b * 4], basis[c][b * 4 + 1], basis[c][b * 4 + 2], basis[c][b * 4 + 3]),
  })).sort((a, b) => b.w - a.w).slice(0, 4);
  console.log(`  PC${c + 1}  ${loads.map((l) => `${l.name}(${l.w.toFixed(2)})`).join('  ')}`);
}

await mkdir('.local', { recursive: true });
await writeFile(join('.local', 'synergies.json'), JSON.stringify({
  version: 1,
  bones: common,
  dims: D,
  mean: Array.from(mean),
  components: basis.map((v, i) => ({ index: i + 1, eigenvalue: eigenvalues[i], values: Array.from(v) })),
  variance: report,
  clips: sampled.map((c) => c.id),
}, null, 2));
console.log('\n写出 .local/synergies.json');
