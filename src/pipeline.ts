/**
 * 构建流水线：调工作台自带的 convert.mjs，不做任何渲染相关的增强。
 * 只依赖 Node + 文件系统，不需要浏览器、不需要 Coo 的 figure-frame。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

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
    child.once('exit', (code) => resolve({ code: code ?? -1, out, err }));
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
  const out = join(builds, `${basename(modelDir).replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${Date.now()}`);
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
  } finally {
    if (overrideFile) await rm(overrideFile, { force: true }).catch(() => {});
  }
  if (!existsSync(join(out, 'figure.json'))) throw new Error('构建没有产出 figure.json');
  return out;
}

/** 把一个构建目录装进 figures/：同名先备份，再删旧、复制。 */
export async function installPack(
  packDir: string,
  figuresDir: string,
  opts: { backupRoot?: string; keep?: number } = {},
): Promise<string> {
  const manifest = JSON.parse(await readFile(join(packDir, 'figure.json'), 'utf8'));
  const id = String(manifest.id ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!id) throw new Error('figure.json 里没有可用的 id');
  await mkdir(figuresDir, { recursive: true });
  const target = join(figuresDir, id);

  if (existsSync(target) && opts.backupRoot) {
    await mkdir(opts.backupRoot, { recursive: true });
    const backup = join(opts.backupRoot, `${id}.bak-${Date.now()}`);
    await cp(target, backup, { recursive: true });
    const keep = Math.max(1, opts.keep ?? 2);
    try {
      const olds = (await readdir(opts.backupRoot))
        .filter((n) => n.startsWith(`${id}.bak-`))
        .sort();
      for (const n of olds.slice(0, Math.max(0, olds.length - keep))) {
        await rm(join(opts.backupRoot, n), { recursive: true, force: true });
      }
    } catch { /* 清理失败不影响安装 */ }
  }

  await rm(target, { recursive: true, force: true });
  await cp(packDir, target, { recursive: true });
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
  const file = join(packDir, 'figure.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));

  if (patch.nameZh || patch.nameEn) {
    manifest.name = { ...(manifest.name ?? {}) };
    if (patch.nameZh) manifest.name.zh = patch.nameZh;
    if (patch.nameEn) manifest.name.en = patch.nameEn;
  }
  if (patch.aboutZh || patch.aboutEn) {
    manifest.about = { ...(manifest.about ?? {}) };
    if (patch.aboutZh) manifest.about.zh = patch.aboutZh;
    if (patch.aboutEn) manifest.about.en = patch.aboutEn;
  }
  const opt = Array.isArray(manifest.axes) ? manifest.axes[0]?.options?.[0] : null;
  if (opt && (patch.nameZh || patch.nameEn)) {
    opt.name = { ...(opt.name ?? {}) };
    if (patch.nameZh) opt.name.zh = patch.nameZh;
    if (patch.nameEn) opt.name.en = patch.nameEn;
  }
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  if (Number.isFinite(patch.bodyGain) || patch.style) {
    const models = join(packDir, 'models');
    for (const dir of await readdir(models)) {
      const prof = join(models, dir, 'profile.js');
      if (!existsSync(prof)) continue;
      let s = await readFile(prof, 'utf8');
      if (Number.isFinite(patch.bodyGain)) {
        s = s.replace(/"bodyGain":\s*[-\d.]+/g, `"bodyGain": ${patch.bodyGain}`);
      }
      if (patch.style) {
        s = s.replace(/"style":\s*"[^"]*"/g, `"style": "${patch.style}"`);
      }
      await writeFile(prof, s, 'utf8');
    }
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
