/**
 * 构建流水线：调工作台自带的 convert.mjs，不做任何渲染相关的增强。
 * 只依赖 Node + 文件系统，不需要浏览器、不需要 Coo 的 figure-frame。
 */
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { childPath, packId } from './paths.ts';

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

/** 跑一次 node 脚本，收集输出。 */
export function runNode(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    child.stderr?.on('data', (b: Buffer) => { err += b.toString(); });
    child.once('error', (e) => resolve({ code: -1, out, err: String(e?.message ?? e) }));
    child.once('close', (code) => resolve({ code: code ?? -1, out, err }));
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
  opts: { fit?: unknown; maxTexture?: number; clean?: boolean; corePath?: string } = {},
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
  if (opts.clean) args.push('--clean');
  let overrideFile = '';
  if (opts.fit) {
    overrideFile = join(workDir, `overrides-${Date.now()}.json`);
    await writeFile(overrideFile, JSON.stringify({ fit: opts.fit }, null, 2), 'utf8');
    args.push('--overrides', overrideFile);
  }
  try {
    const r = await runNode(args, workbenchDir);
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

/** 先复制到同级临时目录，同名先备份，再交换目录；失败恢复旧安装。 */
export async function installPack(
  packDir: string,
  figuresDir: string,
  opts: { backupRoot?: string; keep?: number } = {},
): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packDir, 'figure.json'), 'utf8'));
  const id = packId(manifest.id);
  const target = childPath(figuresDir, id);
  const source = resolve(packDir);
  const inside = (a: string, b: string): boolean => {
    const rel = relative(a, b);
    return !rel || (rel.split(sep)[0] !== '..' && !rel.includes(':'));
  };
  if (inside(source, target) || inside(target, source)) throw new Error('安装目录不能与打包目录重叠');
  await mkdir(figuresDir, { recursive: true });
  const nonce = randomUUID();
  const pending = childPath(figuresDir, `.${id}-install-${nonce}`);
  const previous = childPath(figuresDir, `.${id}-previous-${nonce}`);
  let moved = false;
  try {
    // Copy and verify before touching the installed figure.
    await cp(source, pending, { recursive: true, dereference: false });
    const copied = JSON.parse(await readFile(join(pending, 'figure.json'), 'utf8'));
    if (copied.id !== id) throw new Error('复制后的形象包校验失败');
    if (existsSync(target)) {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('安装目标不能是符号链接');
      if (opts.backupRoot) {
        const backup = childPath(opts.backupRoot, `${id}.bak-${Date.now()}-${nonce}`);
        if (inside(target, resolve(opts.backupRoot))) throw new Error('备份目录不能位于安装目标内部');
        await mkdir(opts.backupRoot, { recursive: true });
        await cp(target, backup, { recursive: true });
      }
      await rename(target, previous);
      moved = true;
    }
    try {
      await rename(pending, target);
    } catch (e) {
      if (moved) { await rename(previous, target); moved = false; }
      throw e;
    }
  } finally {
    await rm(pending, { recursive: true, force: true }).catch(() => {});
  }
  if (moved) await rm(previous, { recursive: true, force: true }).catch(() => {});
  if (opts.backupRoot) {
    const keep = Math.max(1, opts.keep ?? 2);
    const olds = (await readdir(opts.backupRoot).catch(() => []))
      .filter((n) => n.startsWith(`${id}.bak-`)).sort();
    for (const n of olds.slice(0, Math.max(0, olds.length - keep))) {
      await rm(childPath(opts.backupRoot, n), { recursive: true, force: true }).catch(() => {});
    }
  }
  return target;
}

export interface PackEdit {
  nameZh?: string;
  nameEn?: string;
  aboutZh?: string;
  aboutEn?: string;
  bodyGain?: number;
  style?: string;
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
  const file = join(packDir, 'figure.json');
  const original = await readFile(file, 'utf8');
  const manifest = JSON.parse(original);
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
  }
  const opt = Array.isArray(manifest.axes) ? manifest.axes[0]?.options?.[0] : null;
  if (opt && (patch.nameZh || patch.nameEn)) {
    opt.name = { ...(opt.name ?? {}) };
    if (patch.nameZh) opt.name.zh = patch.nameZh;
    if (patch.nameEn) opt.name.en = patch.nameEn;
  }
  writes.push({ file, before: original, after: JSON.stringify(manifest, null, 2) + '\n' });

  if (Number.isFinite(patch.bodyGain) || patch.style) {
    const models = join(packDir, 'models');
    for (const dir of await readdir(models)) {
      const prof = join(models, dir, 'profile.js');
      if (!existsSync(prof)) continue;
      const before = await readFile(prof, 'utf8');
      let s = before;
      if (Number.isFinite(patch.bodyGain)) {
        s = s.replace(/"bodyGain":\s*[-\d.]+/g, `"bodyGain": ${patch.bodyGain}`);
      }
      if (patch.style) {
        s = s.replace(/"style":\s*"[^"]*"/g, `"style": "${patch.style}"`);
      }
      writes.push({ file: prof, before, after: s });
    }
  }
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
