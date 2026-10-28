/**
 * 导入现成的形象包：一个 zip，或者一个（拖入 / 选中的）文件夹。
 *
 * 做法照 Coopanion 的桌宠：文件先在临时目录里摊开，找出 figure.json 所在的目录（最多 3 层），
 * 列出来让人挑，再整份拷进 figures/。zip 用 fflate 解，不落中间文件。
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { unzipSync } from 'fflate';

/** 一次 zip 导入最多这么多（未解压）。 */
export const IMPORT_MAX = 32 * 1024 * 1024;
/** 文件夹是分块传的，上限放宽得多。 */
export const UPLOAD_MAX = 512 * 1024 * 1024;
/** figure.json 最多在选中目录下面几层。 */
export const PACK_DEPTH = 3;
/** 面板自己拼的文件夹包（与桌宠同一套格式）：路径长度 + 路径 + 内容长度 + 内容。 */
export const BUNDLE_TYPE = 'application/x-figure-files';
const THUMB_MAX = 1024 * 1024;
const IMAGE: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export interface ImportFile {
  path: string;
  bytes: Uint8Array;
}

export interface StagedPack {
  dir: string;
  id: string;
  nameZh: string;
  nameEn: string;
  version: string;
  author: string | null;
  /** 解包后的大小。 */
  bytes: number;
  axes: number;
  words: number;
  thumb: string | null;
  /** 已经装在 figures/ 里的版本，没有就是 null。 */
  installed: string | null;
}

export interface StagedModel {
  dir: string;
  /** .model3.json 去掉后缀，当标题。 */
  title: string;
  files: number;
  bytes: number;
  installed: string | null;
}

export interface StageResult {
  token: string;
  packs: StagedPack[];
  models: StagedModel[];
  problems: Array<{ dir: string; reason: string }>;
}

/** 路径拆成段；空、绝对路径、越界的一律不要。 */
function segments(path: string): string[] | null {
  const parts = path.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
  if (!parts.length || /^[a-z]:/i.test(path) || path.startsWith('/') || path.startsWith('\\')) return null;
  return parts.some((p) => p === '..' || /[<>:"|?*\u0000-\u001f]/.test(p)) ? null : parts;
}

/** zip 里的文件（目录跳过）；返回字符串表示读不了。 */
export function filesFromZip(bytes: Uint8Array): ImportFile[] | string {
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => { total += f.originalSize; return !f.name.endsWith('/') && total <= IMPORT_MAX; },
    });
  } catch (err) {
    return `解压失败：${(err as Error).message}`;
  }
  if (total > IMPORT_MAX) return `压缩包太大：解压后超过 ${IMPORT_MAX / 1048576} MB`;
  const files = Object.entries(entries).map(([path, data]) => ({ path, bytes: data }));
  if (files.reduce((n, f) => n + f.bytes.length, 0) > IMPORT_MAX) return `压缩包太大：解压后超过 ${IMPORT_MAX / 1048576} MB`;
  return files;
}

/** 面板拼的文件夹包。 */
export function filesFromBundle(bytes: Uint8Array): ImportFile[] | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  const files: ImportFile[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) return '文件夹数据不完整';
    const pathLen = view.getUint32(at, true); at += 4;
    if (at + pathLen + 4 > bytes.length) return '文件夹数据不完整';
    const path = text.decode(bytes.subarray(at, at + pathLen)); at += pathLen;
    const size = view.getUint32(at, true); at += 4;
    if (at + size > bytes.length) return '文件夹数据不完整';
    files.push({ path, bytes: bytes.subarray(at, at + size) });
    at += size;
  }
  return files;
}

/** root 下最多 depth 层里，含 figure.json 的目录（不往包里钻）。 */
async function findPacks(root: string, depth: number, rel = ''): Promise<string[]> {
  const here = join(root, ...rel.split('/').filter(Boolean));
  const entries = await readdir(here, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name === 'figure.json')) return [rel];
  if (depth === 0) return [];
  const found: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) found.push(...await findPacks(root, depth - 1, rel ? `${rel}/${e.name}` : e.name));
  }
  return found;
}

/** root 下最多 depth 层里，含 .model3.json 的目录（不往打好的包里钻）。 */
async function findModels(root: string, depth: number, rel = ''): Promise<string[]> {
  const here = join(root, ...rel.split('/').filter(Boolean));
  const entries = await readdir(here, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase());
  if (files.includes('figure.json')) return [];
  if (files.some((n) => n.endsWith('.model3.json'))) return [rel];
  if (depth === 0) return [];
  const found: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) found.push(...await findModels(root, depth - 1, rel ? `${rel}/${e.name}` : e.name));
  }
  return found;
}

/** 目录体积，列卡片时给一句。 */
async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) total += await dirBytes(full);
    else if (e.isFile()) total += (await stat(full)).size;
  }
  return total;
}

async function thumbOf(dir: string, file: unknown): Promise<string | null> {
  if (typeof file !== 'string' || !file) return null;
  const type = IMAGE[extname(file).toLowerCase()];
  if (!type) return null;
  try {
    const full = join(dir, file);
    if ((await stat(full)).size > THUMB_MAX) return null;
    return `data:${type};base64,${(await readFile(full)).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * 一次只留一个待装清单：新的导入会把上一个丢掉。安装时只往 figures/ 里写，
 * 同名先备份（与打包产物安装走同一套 backups 目录）。
 */
export class PackImporter {
  private staged: { token: string; root: string } | null = null;
  private uploads = new Map<string, { root: string; bytes: number }>();

  /** 摊开文件、读包；`installed` 用来标出哪些已经装过（只用于显示）。 */
  async stage(files: ImportFile[], fromFolders: boolean, installed: Map<string, string>): Promise<StageResult | { error: string }> {
    await this.cancel();
    if (files.reduce((n, f) => n + f.bytes.length, 0) > IMPORT_MAX) {
      return { error: `内容太大：超过 ${IMPORT_MAX / 1048576} MB` };
    }
    const root = await mkdtemp(join(tmpdir(), 'figure-import-'));
    const written = await this.materialize(root, files);
    if (typeof written === 'string') {
      await rm(root, { recursive: true, force: true });
      return { error: written };
    }
    return this.finish(root, fromFolders, installed);
  }

  /** 文件夹分批上传：先要一个临时目录，再一块块写，最后扫描。 */
  async beginUpload(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'figure-upload-'));
    const token = randomUUID();
    this.uploads.set(token, { root, bytes: 0 });
    return token;
  }

  /** 往临时目录里追加一批文件；超过上限就拒绝。 */
  async appendUpload(token: string, files: ImportFile[]): Promise<{ files: number } | { error: string }> {
    const up = this.uploads.get(token);
    if (!up) return { error: '这次上传已经过期，重新选一次' };
    for (const f of files) {
      up.bytes += f.bytes.length;
      if (up.bytes > UPLOAD_MAX) return { error: `内容太大：超过 ${UPLOAD_MAX / 1048576} MB` };
    }
    const written = await this.materialize(up.root, files);
    if (typeof written === 'string') return { error: written };
    return { files: files.length };
  }

  /** 上传完，扫描临时目录。 */
  async finishUpload(token: string, fromFolders: boolean, installed: Map<string, string>): Promise<StageResult | { error: string }> {
    const up = this.uploads.get(token);
    if (!up) return { error: '这次上传已经过期，重新选一次' };
    this.uploads.delete(token);
    await this.cancel();
    const result = await this.finish(up.root, fromFolders, installed);
    if ('error' in result) return result;
    if (this.staged) this.staged.token = token;
    return { ...result, token };
  }

  private async materialize(root: string, files: ImportFile[]): Promise<string | null> {
    for (const f of files) {
      const parts = segments(f.path);
      if (!parts) return `路径不合法：${f.path}`;
      await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
      await writeFile(join(root, ...parts), f.bytes);
    }
    return null;
  }

  /** 扫描临时目录，登记成待装清单。 */
  private async finish(root: string, fromFolders: boolean, installed: Map<string, string>): Promise<StageResult | { error: string }> {
    try {
      const packs: StagedPack[] = [];
      const models: StagedModel[] = [];
      const problems: StageResult['problems'] = [];

      for (const dir of await findPacks(root, PACK_DEPTH + (fromFolders ? 1 : 0))) {
        const full = join(root, ...dir.split('/').filter(Boolean));
        let manifest: Record<string, unknown>;
        try {
          manifest = JSON.parse(await readFile(join(full, 'figure.json'), 'utf8'));
        } catch (err) {
          problems.push({ dir, reason: `figure.json 读不了：${(err as Error).message}` });
          continue;
        }
        const id = String(manifest.id ?? '').trim();
        if (!id) { problems.push({ dir, reason: 'figure.json 里没有 id' }); continue; }
        if (packs.some((p) => p.id === id)) { problems.push({ dir, reason: `同一个包里有两个 ${id}` }); continue; }
        const name = (manifest.name ?? {}) as { zh?: unknown; en?: unknown };
        packs.push({
          dir,
          id,
          nameZh: typeof name.zh === 'string' ? name.zh : id,
          nameEn: typeof name.en === 'string' ? name.en : id,
          version: typeof manifest.version === 'string' ? manifest.version : '',
          author: typeof manifest.author === 'string' ? manifest.author : null,
          bytes: await dirBytes(full).catch(() => 0),
          axes: Array.isArray(manifest.axes) ? manifest.axes.length : 0,
          words: Array.isArray(manifest.vocab) ? manifest.vocab.length : 0,
          thumb: await thumbOf(full, manifest.thumb),
          installed: installed.get(id) ?? null,
        });
      }

      for (const dir of await findModels(root, PACK_DEPTH + (fromFolders ? 1 : 0))) {
        const full = join(root, ...dir.split('/').filter(Boolean));
        const entries = await readdir(full, { withFileTypes: true });
        const entry = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.model3.json'));
        if (!entry) continue;
        models.push({
          dir,
          title: entry.name.replace(/\.model3\.json$/i, ''),
          files: entries.filter((e) => e.isFile()).length,
          bytes: await dirBytes(full).catch(() => 0),
          installed: null,
        });
      }

      if (!packs.length && models.length === 1 && models[0].dir === '') {
        // 模型就摊在上传目录的根上：给它一个跟 .model3.json 同名的子目录，
        // 这样打包出来的 id 是模型名，而不是临时目录的名字。
        const title = models[0].title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'model';
        const sub = join(root, title);
        await mkdir(sub, { recursive: true });
        for (const e of await readdir(root, { withFileTypes: true })) {
          if (e.name === title) continue;
          await rename(join(root, e.name), join(sub, e.name)).catch(() => {});
        }
        models[0].dir = title;
      }

      if (!packs.length && !models.length) {
        await rm(root, { recursive: true, force: true });
        return { token: '', packs: [], models: [], problems };
      }
      const token = randomUUID();
      this.staged = { token, root };
      return { token, packs, models, problems };
    } catch (err) {
      await rm(root, { recursive: true, force: true });
      return { error: `解包失败：${(err as Error).message}` };
    }
  }

  /** 把挑中的目录整份拷进 `figuresDir/<id>`；同名目录要先进 `replace`。 */
  async install(
    token: string,
    dirs: readonly string[],
    replace: readonly string[],
    opts: { figuresDir: string; backupRoot?: string; keep?: number },
  ): Promise<{ installed: Array<{ id: string; target: string }> } | { conflicts: string[] } | { error: string }> {
    const staged = this.staged;
    if (!staged || staged.token !== token) return { error: '这次导入已经过期，重新选一次' };
    if (!dirs.length) return { error: '没有选中要装的包' };

    const chosen: Array<{ dir: string; id: string }> = [];
    for (const dir of dirs) {
      const full = join(staged.root, ...dir.split('/').filter(Boolean));
      let id = '';
      try {
        const m = JSON.parse(await readFile(join(full, 'figure.json'), 'utf8'));
        id = String(m.id ?? '').trim();
      } catch { /* 目录里已经没有 figure.json */ }
      if (id) chosen.push({ dir, id });
    }
    if (!chosen.length) return { error: '挑中的包已经不在临时目录里了' };

    const conflicts = chosen.filter((c) => existsSync(join(opts.figuresDir, c.id))).map((c) => c.id);
    if (conflicts.some((id) => !replace.includes(id))) return { conflicts };

    // 先用掉 token，避免并发重复安装
    this.staged = null;
    try {
      await mkdir(opts.figuresDir, { recursive: true });
      const out: Array<{ id: string; target: string }> = [];
      for (const c of chosen) {
        const source = join(staged.root, ...c.dir.split('/').filter(Boolean));
        const target = join(opts.figuresDir, c.id);
        if (existsSync(target) && opts.backupRoot) {
          await mkdir(opts.backupRoot, { recursive: true });
          await cp(target, join(opts.backupRoot, `${c.id}.bak-${Date.now()}`), { recursive: true });
          const keep = Math.max(1, opts.keep ?? 2);
          const olds = (await readdir(opts.backupRoot)).filter((n) => n.startsWith(`${c.id}.bak-`)).sort();
          for (const n of olds.slice(0, Math.max(0, olds.length - keep))) {
            await rm(join(opts.backupRoot, n), { recursive: true, force: true });
          }
        }
        await rm(target, { recursive: true, force: true });
        await cp(source, target, { recursive: true });
        out.push({ id: c.id, target });
      }
      return { installed: out };
    } finally {
      await rm(staged.root, { recursive: true, force: true });
    }
  }

  async cancel(): Promise<void> {
    const staged = this.staged;
    this.staged = null;
    if (staged) await rm(staged.root, { recursive: true, force: true }).catch(() => {});
    for (const up of this.uploads.values()) await rm(up.root, { recursive: true, force: true }).catch(() => {});
    this.uploads.clear();
  }

  /** 待装清单里某个目录的绝对路径；token 不对就说没有。 */
  resolve(token: string, dir: string): string | null {
    const staged = this.staged;
    if (!staged || staged.token !== token) return null;
    if (!dir) return staged.root;
    const parts = segments(dir);
    if (!parts) return null;
    return join(staged.root, ...parts);
  }
}
