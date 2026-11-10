/**
 * 构建流水线：调工作台自带的 convert.mjs，不做任何渲染相关的增强。
 * 只依赖 Node + 文件系统，不需要浏览器、不需要 Coo 的 figure-frame。
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { canonicalPath, childPath, containsPath } from './paths.ts';
import { parseFigureJson, readPackManifest } from './pack-manifest.ts';
import { packFingerprint } from './pack-fingerprint.ts';
import { EMOTION_EFFECT_REACH, emotionStyleModule, normalizeEmotionEffect } from '../workbench/tools/emotion-effect.mjs';
import { BODY_CROP_AXIS, BODY_CROP_OPTIONS, normalizeBodyCrop } from '../workbench/pack/backends/crop-config.js';
import { normalizeGazeConfig } from '../workbench/pack/backends/gaze-config.js';

/** Imported packages may not redirect copying or editing outside their own directory. */
export async function assertRegularTree(root: string): Promise<void> {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('形象包目录不能是链接或特殊文件');
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('形象包中不能包含符号链接');
    if (entry.isDirectory()) await assertRegularTree(path);
    else if (!entry.isFile()) throw new Error('形象包中包含不支持的特殊文件');
  }
}

const RUNTIME_BACKENDS = ['live2d.js', 'native-actions.js', 'wardrobe.js', 'wardrobe-slots.js', 'render-config.js',
  'render-quality.js', 'role-values.js', 'soullink.js', 'bongo.js', 'voice-playback.js', 'body-crop.js', 'crop-config.js', 'gaze-config.js'];

/** Update the runtime of a private, validated pack copy without changing its model or entry. */
export async function refreshPackRuntime(runtime: string, pack: string): Promise<void> {
  for (const file of RUNTIME_BACKENDS) await cp(join(runtime, 'backends', file), join(pack, 'backends', file));
  await cp(join(runtime, 'backends', 'emotion-effects'), join(pack, 'backends', 'emotion-effects'), { recursive: true });
  const effectStyle = join(pack, 'backends', 'emotion-style.js');
  if (!existsSync(effectStyle)) await cp(join(runtime, 'backends', 'emotion-style.js'), effectStyle);
  await cp(join(runtime, 'figure-voice.json'), join(pack, 'figure-voice.json'));
}

/** Stamp the chosen effect into a private copy of a Figure-generated pack. */
export async function setPackEmotionEffect(pack: string, value: unknown, size: unknown): Promise<void> {
  const style = normalizeEmotionEffect(value);
  const styleFile = join(pack, 'backends', 'emotion-style.js');
  const manifestFile = join(pack, 'figure.json');
  const manifestText = await readFile(manifestFile, 'utf8');
  const manifest = parseFigureJson(manifestText);
  const hasOurReach = manifest.effects?.reach === EMOTION_EFFECT_REACH;
  if (style !== 'native' && !hasOurReach) {
    manifest.effects = { ...manifest.effects, reach: EMOTION_EFFECT_REACH };
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  } else if (style === 'native' && hasOurReach) {
    delete manifest.effects.reach;
    if (Object.keys(manifest.effects).length === 0) delete manifest.effects;
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  await writeFile(styleFile, emotionStyleModule(style, size), 'utf8');
}

async function profileFiles(root: string): Promise<Array<{file:string;text:string}>> {
  const models = join(root, 'models');
  const info = await lstat(models).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('模型目录不能是链接或特殊文件');
  const profiles = [];
  for (const entry of await readdir(models, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('模型目录不能包含符号链接');
    if (!entry.isDirectory()) continue;
    const file = join(models, entry.name, 'profile.js');
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('表演配置不能是链接或特殊文件');
    profiles.push({file,text:await readFile(file,'utf8')});
  }
  return profiles;
}

async function editableLive2dProfile(root: string, profiles: Awaited<ReturnType<typeof profileFiles>>) {
  const profile = profiles.length === 1 ? profiles[0] : null;
  if (!profile || !/^\s*(?:\/\*[\s\S]*?\*\/\s*)?export default \{/.test(profile.text)
      || !/\r?\n};\s*$/.test(profile.text) || /^  bongo:/m.test(profile.text)) return null;
  const buildFile = join(root, 'build.json');
  const info = await lstat(buildFile).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 4 * 1048576) return null;
  const build = await readFile(buildFile, 'utf8').then(parseFigureJson).catch(() => null);
  return build?.tool === 'cortico-live2d-pack' && build.sourceFormat !== 'bongocat' ? profile : null;
}

function setCropAxis(manifest: any, mode: string) {
  const full = {id: BODY_CROP_OPTIONS.full, name:{zh:'全身',en:'Full body'}};
  const upper = {id: BODY_CROP_OPTIONS.upper, name:{zh:'上半身',en:'Upper body'}};
  const options = mode === 'upper' ? [upper, full] : [full, upper];
  const axis = {id: BODY_CROP_AXIS, name:{zh:'取景',en:'Framing'}, options};
  const axes = Array.isArray(manifest.axes) ? manifest.axes : [];
  const index = axes.findIndex((item: {id?:string}) => item?.id === BODY_CROP_AXIS);
  if (index >= 0 && (axes[index].options?.length !== 2
      || !options.every(option => axes[index].options.some((old: {id:string}) => old.id === option.id)))) {
    throw Error('取景栏位与已有装扮分组重复');
  }
  if (index >= 0) axes[index] = axis;
  else axes.push(axis);
  manifest.axes = axes;
  for (const preset of Array.isArray(manifest.presets) ? manifest.presets : []) {
    if (!options.some(option => option.id === preset.pick?.[BODY_CROP_AXIS])) {
      preset.pick = {...preset.pick, [BODY_CROP_AXIS]: options[0].id};
    }
  }
}

function readProfileSetting(profile: string, key: 'crop' | 'gaze') {
  const line = new RegExp(`^  ${key}: (\\{[^\\r\\n]*\\}),\\r?$`, 'm').exec(profile);
  try { return line ? parseFigureJson(line[1]) : undefined; }
  catch { return undefined; }
}

function writeProfileSetting(profile: string, key: 'crop' | 'gaze', value: object) {
  return profile.replace(new RegExp(`^  ${key}: [^\\r\\n]*\\r?\\n`, 'gm'), '')
    .replace(/\r?\n};\s*$/, () => `\n  ${key}: ${JSON.stringify(value)},\n};\n`);
}

export async function packDetail(root: string) {
  const file = join(root, 'figure.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('形象清单不能是链接或特殊文件');
  const manifest = parseFigureJson(await readFile(file,'utf8'));
  let bodyGain = 1.8, style = 'natural', tunable = false;
  const profiles = await profileFiles(root);
  for (const profile of profiles) {
    const gain = /"bodyGain":\s*([-\d.]+)/.exec(profile.text);
    const kind = /"style":\s*"([^"]+)"/.exec(profile.text);
    if (gain && kind) { bodyGain = Number(gain[1]); style = kind[1]; tunable = true; break; }
  }
  const string = (value: unknown) => typeof value === 'string' ? value : '';
  const about = (value: unknown) => value === '—' ? '' : string(value);
  const profile = await editableLive2dProfile(root, profiles);
  const presentation = profile ? {
    crop: normalizeBodyCrop(readProfileSetting(profile.text, 'crop')),
    gaze: normalizeGazeConfig(readProfileSetting(profile.text, 'gaze')),
  } : {};
  return {nameZh:string(manifest.name?.zh),nameEn:string(manifest.name?.en),aboutZh:about(manifest.about?.zh),aboutEn:about(manifest.about?.en),bodyGain,style,tunable,...presentation};
}

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

/** 跑一次 node 脚本，收集输出。 */
export function runNode(args: string[], cwd: string, signal?: AbortSignal): Promise<RunResult> {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    let out = '';
    let err = '';
    const abort = () => { child.kill(); };
    signal?.addEventListener('abort', abort, {once:true});
    child.stdout?.setEncoding('utf8').on('data', (text: string) => { out += text; });
    child.stderr?.setEncoding('utf8').on('data', (text: string) => { err += text; });
    child.once('error', (e) => resolve({ code: -1, out, err: String(e?.message ?? e) }));
    child.once('close', (code) => { signal?.removeEventListener('abort',abort); resolve({ code: code ?? -1, out, err }); });
  });
}

export interface ScanSummary {
  id: string;
  title: string;
  params: number;
  roles: number;
  unmapped: string[];
  expressions: number;
  textures: number;
  adaptation?: AdaptationSummary;
}

export interface AdaptationSummary {
  corrected: string[];
  limited: string[];
  warnings: string[];
}

/** Explain the existing automatic fallback without exposing parameter editing. */
export function adaptationSummary(plan: { mappingDiagnostics?: unknown; mappingWarnings?: unknown; unmapped?: unknown }): AdaptationSummary {
  const corrected = new Set<string>(); const limited = new Set<string>();
  for (const d of Array.isArray(plan.mappingDiagnostics) ? plan.mappingDiagnostics : []) {
    if (!d || typeof d.role !== 'string') continue;
    if (d.kind === 'physics-input' || d.kind === 'semantic-alias') corrected.add(d.role);
    if (d.kind === 'physics-output' || d.kind === 'unverified-control') limited.add(d.role);
  }
  for (const role of Array.isArray(plan.unmapped) ? plan.unmapped : []) if (typeof role === 'string') limited.add(role);
  return { corrected: [...corrected], limited: [...limited],
    warnings: (Array.isArray(plan.mappingWarnings) ? plan.mappingWarnings : []).filter((v): v is string => typeof v === 'string') };
}

/** `convert.mjs --json`：只读模型，不产出包。 */
export async function scanModel(workbenchDir: string, modelDir: string): Promise<ScanSummary> {
  const r = await runNode([join(workbenchDir, 'tools', 'convert.mjs'), '--model', modelDir, '--json'], workbenchDir);
  if (r.code !== 0) throw new Error((r.err || r.out || '扫描失败').trim().slice(0, 400));
  const start = r.out.indexOf('{');
  if (start < 0) throw new Error('扫描没有返回 JSON');
  const plan = JSON.parse(r.out.slice(start));
  return {
    id: String(plan.id ?? ''),
    title: String(plan.title ?? plan.id ?? ''),
    params: Number(plan.params ?? 0),
    roles: Array.isArray(plan.roles) ? plan.roles.length : 0,
    unmapped: Array.isArray(plan.unmapped) ? plan.unmapped : [],
    expressions: Array.isArray(plan.expressions) ? plan.expressions.length : 0,
    textures: Array.isArray(plan.textures) ? plan.textures.length : 0,
    adaptation: adaptationSummary(plan),
  };
}

/** 构建形象包到 workDir/builds/<id>-<ts>，返回目录。fit 会作为 overrides 传回 convert。 */
export async function buildPack(
  workbenchDir: string,
  modelDir: string,
  workDir: string,
  opts: { fit?: unknown; native?: unknown; render?: unknown; emotionEffect?: string; emotionEffectSize?: string; modelFile?: string; maxTexture?: number; clean?: boolean; corePath?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const builds = join(workDir, 'builds');
  await mkdir(builds, { recursive: true });
  const out = join(builds, `${basename(modelDir).replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  const args = [
    join(workbenchDir, 'tools', 'convert.mjs'),
    '--model', modelDir,
    '--out', out,
    '--force',
    '--max-texture', String(Math.max(0, Math.trunc(opts.maxTexture ?? 2048))),
  ];
  if (opts.corePath) args.push('--core', opts.corePath);
  if (opts.modelFile) args.push('--model-file', opts.modelFile);
  if (opts.clean) args.push('--clean');
  let overrideFile = '';
  if (opts.fit || opts.native || opts.render || opts.emotionEffect || opts.emotionEffectSize) {
    overrideFile = join(workDir, `overrides-${randomUUID()}.json`);
    await writeFile(overrideFile, JSON.stringify({ fit: opts.fit, native: opts.native, render: opts.render, emotionEffect: opts.emotionEffect, emotionEffectSize: opts.emotionEffectSize }, null, 2), 'utf8');
    args.push('--overrides', overrideFile);
  }
  try {
    const r = await runNode(args, workbenchDir, opts.signal);
    opts.signal?.throwIfAborted();
    if (r.code !== 0) throw new Error((r.err || r.out || '构建失败').trim().slice(0, 400));
    if (!existsSync(join(out, 'figure.json'))) throw new Error('构建没有产出 figure.json');
  } catch (e) {
    await rm(out, { recursive: true, force: true });
    throw e;
  } finally {
    if (overrideFile) await rm(overrideFile, { force: true }).catch(() => {});
  }
  return out;
}

/** Coo identifies a pack by its manifest ID, independently of the containing folder. */
export async function findInstalledTargets(figuresDir: string, id: string, ignore?: string): Promise<string[]> {
  const target = childPath(figuresDir, id);
  const entries = await readdir(figuresDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const occupied = [];
  for (const entry of entries) {
    const path = join(figuresDir, entry.name);
    if (path === ignore) continue;
    if (process.platform === 'win32' ? path.toLowerCase() === target.toLowerCase() : path === target) {
      occupied.push(path);
      continue;
    }
    if (!entry.isDirectory()) continue;
    const file = join(path, 'figure.json');
    const info = await lstat(file).catch(() => null);
    if (!info?.isFile() || info.size > 4 * 1048576) continue;
    const existingId = await readFile(file, 'utf8').then(text => parseFigureJson(text)?.id).catch(() => null);
    if (existingId === id) occupied.push(path);
  }
  return occupied.sort();
}

/** 先复制到同级临时目录，同 ID 先备份，再交换目录；失败恢复旧安装。 */
export async function installPack(
  packDir: string,
  figuresDir: string,
  opts: { backupRoot?: string; keep?: number; onWarning?: (message: string) => void; signal?: AbortSignal; expectedFingerprint?: string; beforeSwap?: (replacesOtherPack: boolean) => void; prepare?: (pending: string) => Promise<void> } = {},
): Promise<string> {
  opts.signal?.throwIfAborted();
  await assertRegularTree(packDir);
  const { id } = await readPackManifest(packDir);
  figuresDir = await canonicalPath(figuresDir);
  const target = childPath(figuresDir, id);
  const source = await canonicalPath(packDir);
  if (containsPath(source, target) || containsPath(target, source)) throw new Error('安装目录不能与打包目录重叠');
  await mkdir(figuresDir, { recursive: true });
  const nonce = randomUUID();
  const pending = childPath(figuresDir, `.${id}-install-${nonce}`);
  const moved: Array<{ path: string; previous: string }> = [];
  try {
    // Copy and verify before touching the installed figure.
    await cp(source, pending, { recursive: true, dereference: false });
    await assertRegularTree(pending);
    await opts.prepare?.(pending);
    const pendingHash = opts.expectedFingerprint ? await packFingerprint(pending, opts.signal) : undefined;
    if (opts.expectedFingerprint && pendingHash !== opts.expectedFingerprint) {
      throw new Error('形象包内容已改变，请重新分析确认');
    }
    const copied = await readPackManifest(pending);
    if (copied.id !== id) throw new Error('复制后的形象包校验失败');
    opts.signal?.throwIfAborted();
    const occupied = await findInstalledTargets(figuresDir, id, pending);
    for (const path of occupied) {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('安装目标不能是符号链接');
      if (containsPath(path, source) || containsPath(source, path)) throw new Error('安装目录不能与打包目录重叠');
    }
    let replacesOtherPack = occupied.length > 0;
    let approvedHash: string | undefined;
    if (opts.beforeSwap && occupied.length === 1) {
      const installedHash = await packFingerprint(occupied[0], opts.signal).catch(() => undefined);
      opts.signal?.throwIfAborted();
      if (installedHash && installedHash === (pendingHash ?? await packFingerprint(pending, opts.signal))) {
        replacesOtherPack = false;
        approvedHash = installedHash;
      }
    }
    opts.beforeSwap?.(replacesOtherPack);
    if (opts.backupRoot && occupied.length) {
      const backupRoot = await canonicalPath(opts.backupRoot);
      if (occupied.some(path => containsPath(path, backupRoot))) throw new Error('备份目录不能位于安装目标内部');
      await mkdir(backupRoot, { recursive: true });
      for (const [index, path] of occupied.entries()) {
        const backup = childPath(backupRoot, `${id}.bak-${Date.now()}-${nonce}-${index}`);
        await cp(path, backup, { recursive: true });
      }
    }
    const current = await findInstalledTargets(figuresDir, id, pending);
    if (JSON.stringify(current) !== JSON.stringify(occupied)) throw new Error('安装目标已改变，请重新确认');
    if (approvedHash && await packFingerprint(occupied[0], opts.signal).catch(() => undefined) !== approvedHash) replacesOtherPack = true;
    opts.signal?.throwIfAborted();
    opts.beforeSwap?.(replacesOtherPack);
    for (const [index, path] of occupied.entries()) {
      const previous = childPath(figuresDir, `.${id}-previous-${nonce}-${index}`);
      await rename(path, previous);
      moved.push({ path, previous });
    }
    await rename(pending, target);
  } catch (error) {
    for (const { path, previous } of moved.reverse()) {
      await rename(previous, path).catch(() => opts.onWarning?.(`旧形象恢复失败，已保留在 ${previous}`));
    }
    throw error;
  } finally {
    await rm(pending, { recursive: true, force: true }).catch(() => {});
  }
  for (const { previous } of moved) {
    await rm(previous, { recursive: true, force: true }).catch(() => opts.onWarning?.('安装已完成，旧副本暂未移除'));
  }
  if (opts.backupRoot) {
    const keep = Math.max(1, opts.keep ?? 2, moved.length);
    const olds = (await readdir(opts.backupRoot).catch(() => []))
      .filter((n) => n.startsWith(`${id}.bak-`)).sort();
    for (const n of olds.slice(0, Math.max(0, olds.length - keep))) {
      await rm(childPath(opts.backupRoot, n), { recursive: true, force: true }).catch(() => {});
    }
  }
  return target;
}

type BodyCrop = ReturnType<typeof normalizeBodyCrop>;

export interface PackEdit {
  nameZh?: string;
  nameEn?: string;
  aboutZh?: string;
  aboutEn?: string;
  bodyGain?: number;
  style?: string;
  crop?: Omit<BodyCrop, 'curve'> & { curve?: number };
  gaze?: ReturnType<typeof normalizeGazeConfig>;
}

/**
 * 直接改一份已打包产物：figure.json 的名字/一句话，profile.js 的身体幅度与风格。
 * 不重新打包，秒级生效。
 */
export async function editPack(packDir: string, patch: PackEdit): Promise<void> {
  for (const key of ['nameZh', 'nameEn', 'aboutZh', 'aboutEn'] as const) {
    const value = patch[key];
    if (value !== undefined && (typeof value !== 'string' || (key.startsWith('name') ? /[\u0000-\u001f]/ : /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/).test(value) || value.length > (key.startsWith('name') ? 120 : 1000))) {
      throw new Error('名字或一句话包含无效字符，或内容过长');
    }
    if (key.startsWith('name') && value !== undefined && !value.trim()) throw new Error('名字不能为空');
  }
  if (patch.bodyGain !== undefined && (!Number.isFinite(patch.bodyGain) || patch.bodyGain < 0.5 || patch.bodyGain > 3)) throw new Error('身体幅度应为 0.5–3');
  if (patch.style !== undefined && !['natural', 'lively', 'calm', 'shy'].includes(patch.style)) throw new Error('动作风格无效');
  const cropPatch = patch.crop;
  const crop = cropPatch === undefined ? undefined : normalizeBodyCrop(cropPatch);
  if (crop && (!cropPatch || Object.entries(crop).some(([key,value]) =>
    (key !== 'curve' || cropPatch.curve !== undefined) && cropPatch[key as keyof BodyCrop] !== value))) throw Error('取景选项无效');
  const gazePatch = patch.gaze;
  const gaze = gazePatch === undefined ? undefined : normalizeGazeConfig(gazePatch);
  if (gaze && (gazePatch?.enabled !== gaze.enabled || gazePatch?.speed !== gaze.speed)) throw Error('视线跟随选项无效');
  const file = join(packDir, 'figure.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('形象清单不能是链接或特殊文件');
  const original = await readFile(file, 'utf8');
  const manifest = parseFigureJson(original);
  const writes: Array<{ file: string; before: string; after: string }> = [];

  if (patch.nameZh || patch.nameEn) {
    manifest.name = { ...(manifest.name ?? {}) };
    if (patch.nameZh) manifest.name.zh = patch.nameZh;
    if (patch.nameEn) manifest.name.en = patch.nameEn;
  }
  if (patch.aboutZh !== undefined || patch.aboutEn !== undefined) {
    manifest.about = { ...(manifest.about ?? {}) };
    if (patch.aboutZh !== undefined) manifest.about.zh = patch.aboutZh;
    if (patch.aboutEn !== undefined) manifest.about.en = patch.aboutEn;
    if (!Object.values(manifest.about).some(v => typeof v === 'string' && v.trim())) {
      manifest.about[patch.aboutZh !== undefined ? 'zh' : 'en'] = '—';
    }
  }
  const modelAxis = Array.isArray(manifest.axes) ? manifest.axes.find((axis: any) => axis?.id === 'model') : null;
  const opt = modelAxis?.options?.length === 1 ? modelAxis.options[0] : null;
  if (opt && (patch.nameZh || patch.nameEn)) {
    opt.name = { ...(opt.name ?? {}) };
    if (patch.nameZh) opt.name.zh = patch.nameZh;
    if (patch.nameEn) opt.name.en = patch.nameEn;
  }
  if (Number.isFinite(patch.bodyGain) || patch.style || crop || gaze) {
    const profiles = await profileFiles(packDir);
    const live2dProfile = (crop || gaze) && await editableLive2dProfile(packDir, profiles);
    if (crop && !live2dProfile) throw Error('这份形象包不支持上半身取景');
    if (gaze && !live2dProfile) throw Error('这份形象包不支持视线跟随设置');
    if ((patch.bodyGain !== undefined && !profiles.some(p => /"bodyGain":\s*[-\d.]+/.test(p.text)))
      || (patch.style !== undefined && !profiles.some(p => /"style":\s*"[^"]*"/.test(p.text)))) throw new Error('这个形象包不支持通用表演配置');
    for (const {file:prof,text:before} of profiles) {
      let s = before;
      if (Number.isFinite(patch.bodyGain)) {
        s = s.replace(/"bodyGain":\s*[-\d.]+/g, `"bodyGain": ${patch.bodyGain}`);
      }
      if (patch.style) {
        s = s.replace(/"style":\s*"[^"]*"/g, `"style": "${patch.style}"`);
      }
      if (live2dProfile && prof === live2dProfile.file) {
        if (crop) {
          const nextCrop = cropPatch?.curve === undefined
            ? { ...crop, curve: normalizeBodyCrop(readProfileSetting(before, 'crop')).curve } : crop;
          s = writeProfileSetting(s, 'crop', nextCrop);
        }
        if (gaze) s = writeProfileSetting(s, 'gaze', gaze);
      }
      if (s !== before) writes.push({ file: prof, before, after: s });
    }
    if (crop) setCropAxis(manifest, crop.mode);
  }
  const nextManifest = JSON.stringify(manifest, null, 2) + '\n';
  if (nextManifest !== original) writes.unshift({ file, before: original, after: nextManifest });
  const applied: typeof writes = [];
  const atomicWrite = async (file: string, data: string) => {
    const tmp = `${file}.edit-${randomUUID()}`;
    try { await writeFile(tmp, data, 'utf8'); await rename(tmp, file); }
    finally { await rm(tmp, { force: true }).catch(() => {}); }
  };
  try {
    for (const edit of writes) { await atomicWrite(edit.file, edit.after); applied.push(edit); }
  } catch (e) {
    for (const edit of applied.reverse()) await atomicWrite(edit.file, edit.before);
    throw e;
  }
}

/** 目录体积，用来在回执里报一句。 */export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const walk = async (p: string): Promise<void> => {
    for (const e of await readdir(p, { withFileTypes: true })) {
      const full = join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else total += (await stat(full)).size;
    }
  };
  await walk(dir);
  return total;
}
