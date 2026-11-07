import { childPath } from './paths.ts';
import { installPack } from './pipeline.ts';
import { readPackManifest } from './pack-manifest.ts';
/**
 * 导入现成的形象包：一个 zip，或者一个（拖入 / 选中的）文件夹。
 *
 * 做法照 Coopanion 的桌宠：文件先在临时目录里摊开，找出 figure.json 所在的目录（最多 3 层），
 * 列出来让人挑，再整份拷进 figures/。zip 用 fflate 解，不落中间文件。
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
const FILES_MAX = 20000;
const pathKey = (path: string) => process.platform === 'win32' ? path.replace(/\\/g, '/').toLowerCase() : path.replace(/\\/g, '/');
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
  file: string;
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
  try { childPath('.', path); return path.split(/[\\/]/); } catch { return null; }
}

/** zip 里的文件（目录跳过）；返回字符串表示读不了。 */
export function filesFromZip(bytes: Uint8Array): ImportFile[] | string {
  if (bytes.byteLength > IMPORT_MAX) return 'ZIP 超过 32 MB，请选择解压后的文件夹';
  let total = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => { total += f.originalSize; count++; return !f.name.endsWith('/') && total <= IMPORT_MAX && count <= FILES_MAX; },
    });
  } catch (err) {
    return `解压失败：${(err as Error).message}`;
  }
  if (total > IMPORT_MAX) return `压缩包太大：解压后超过 ${IMPORT_MAX / 1048576} MB`;
  if (count > FILES_MAX) return '压缩包中的文件过多';
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
async function dirInfo(dir: string): Promise<{bytes:number;files:number}> {
  let total = 0,files=0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {const child=await dirInfo(full);total+=child.bytes;files+=child.files;}
    else if (e.isFile()) {total += (await stat(full)).size;files++;}
  }
  return {bytes:total,files};
}
const dirBytes=async(dir:string):Promise<number>=>(await dirInfo(dir)).bytes;

export async function thumbOf(dir: string, file: unknown): Promise<string | null> {
  if (typeof file !== 'string' || !file) return null;
  const type = IMAGE[extname(file).toLowerCase()];
  if (!type) return null;
  try {
    const full = childPath(dir, file);
    const info = await lstat(full), rel = relative(await realpath(dir), await realpath(full));
    if (!info.isFile() || info.isSymbolicLink() || !rel || rel.split(sep)[0] === '..' || isAbsolute(rel) || info.size > THUMB_MAX) return null;
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
  private staged: { token: string; root: string; packs: Set<string>; models:Set<string>;entries:Map<string,string>;local?:Map<string,string> } | null = null;
  private uploads = new Map<string, { root: string; bytes: number; paths: Set<string>; chunks: Map<string,{written:number;total:number}> }>();

  /** AI jobs outlive the panel's import token. Keep only owned upload data in a separate cache. */
  async preserveForAutomation(token: string, cacheRoot: string, activePaths:string[]=[]): Promise<Map<string,string>> {
    const staged = this.staged;
    if (!staged || staged.token !== token) throw new Error('这次导入已经过期，重新选一次');
    await this.pruneAutomationInputs(cacheRoot,activePaths);
    const base = resolve(cacheRoot), destination = join(base, token), paths = new Map<string,string>();
    const inside = (root:string,file:string) => { const rel=relative(root,file);return !rel || rel !== '..' && !rel.startsWith('..'+sep) && !isAbsolute(rel); };
    const owned = [...new Set([...staged.models,...staged.packs])].map(dir=>({dir,source:this.resolve(token,dir)!}));
    if (owned.some(item=>inside(staged.root,item.source))) {
      if (inside(staged.root,destination) || inside(destination,staged.root)) throw new Error('自动化缓存与导入目录不能重叠');
      if (!existsSync(join(destination,'.figure-import-cache'))) {
        if(existsSync(destination))throw new Error('自动化缓存路径已占用');
        await mkdir(base,{recursive:true});
        try { await cp(staged.root,destination,{recursive:true,force:false,errorOnExist:true});await writeFile(join(destination,'.figure-import-cache'),'1'); }
        catch(error){const rel=relative(base,resolve(destination));if(rel&&rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel))await rm(destination,{recursive:true,force:true}).catch(()=>{});throw error;}
      }
    }
    for(const {dir,source} of owned) paths.set(dir,inside(staged.root,source)?join(destination,relative(staged.root,source)):source);
    return paths;
  }

  /** Only our marked, expired UUID caches can be removed; user model folders are never targets. */
  async pruneAutomationInputs(cacheRoot:string,activePaths:string[]=[]):Promise<void> {
    const base=resolve(cacheRoot);
    for(const entry of await readdir(base,{withFileTypes:true}).catch(()=>[])) {
      if(!entry.isDirectory()||entry.isSymbolicLink()||! /^[a-f0-9-]{36}$/i.test(entry.name))continue;
      const target=resolve(base,entry.name),rel=relative(base,target),marker=join(target,'.figure-import-cache');
      if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))continue;
      if(activePaths.some(path=>{const child=relative(target,resolve(path));return !child||child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child);}))continue;
      const info=await lstat(marker).catch(()=>null);
      if(info?.isFile()&&!info.isSymbolicLink()&&Date.now()-info.mtimeMs>60*60000)await rm(target,{recursive:true,force:true}).catch(()=>{});
    }
  }

  /** Local clipboard/picker input stays read-only; only the owned temp root is removed. */
  async stageLocal(paths:string[],installed:Map<string,string>):Promise<StageResult|{error:string}> {
    if(!paths.length||paths.length>16)return {error:'请选择 1–16 个模型文件夹或 ZIP'};
    await this.cancel();
    const root=await mkdtemp(join(tmpdir(),'figure-local-'));
    const sources:Array<{dir:string;full:string;entryFile?:string}>=[];
    try {
      let bytes=0;
      for(const [i,input] of [...new Set(paths)].entries()) {
        if(!isAbsolute(input))throw new Error('需要本机绝对路径');
        const info=await stat(input);let full=input,entryFile:string|undefined;
        if(info.isFile()) {
          if(/\.zip$/i.test(input)) {
            if(info.size>IMPORT_MAX)throw new Error('ZIP 超过 32 MB，请选择解压后的文件夹');
            const files=filesFromZip(await readFile(input));if(typeof files==='string')throw new Error(files);
            bytes+=files.reduce((sum,f)=>sum+f.bytes.length,0);if(bytes>UPLOAD_MAX)throw new Error('导入内容超过 512 MB');
            full=join(root,`zip-${i}`);await mkdir(full);
            const error=await this.materialize(full,files);if(error)throw new Error(error);
          } else if(/(?:\.model3\.json|[\\/]figure\.json)$/i.test(input)){full=dirname(input);entryFile=basename(input);}
          else throw new Error('请选择模型目录、model3.json、figure.json 或 ZIP');
        }
        sources.push({dir:`source-${i}`,full,entryFile});
      }
      return this.finish(root,false,installed,sources);
    } catch(e){await rm(root,{recursive:true,force:true});return {error:String((e as Error).message??e)};}
  }

  /** 摊开文件、读包；`installed` 用来标出哪些已经装过（只用于显示）。 */
  async stage(files: ImportFile[], fromFolders: boolean, installed: Map<string, string>): Promise<StageResult | { error: string }> {
    await this.cancel();
    if (files.reduce((n, f) => n + f.bytes.length, 0) > IMPORT_MAX) {
      return { error: `内容太大：超过 ${IMPORT_MAX / 1048576} MB` };
    }
    const root = await mkdtemp(join(tmpdir(), 'figure-import-'));
    try {
      const written = await this.materialize(root, files);
      if (typeof written === 'string') throw new Error(written);
      return this.finish(root, fromFolders, installed);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      return { error: (error as Error).message };
    }
  }

  /** 文件夹分批上传：先要一个临时目录，再一块块写，最后扫描。 */
  async beginUpload(): Promise<string> {
    await this.cancel();
    const root = await mkdtemp(join(tmpdir(), 'figure-upload-'));
    const token = randomUUID();
    this.uploads.set(token, { root, bytes: 0, paths: new Set(), chunks: new Map() });
    return token;
  }

  /** 往临时目录里追加一批文件；超过上限就拒绝。 */
  async appendUpload(token: string, files: ImportFile[]): Promise<{ files: number } | { error: string }> {
    const up = this.uploads.get(token);
    if (!up) return { error: '这次上传已经过期，重新选一次' };
    const paths = new Set<string>();
    for (const f of files) {
      const key = pathKey(f.path);
      if (!segments(f.path) || up.paths.has(key) || up.chunks.has(key) || paths.has(key) || up.paths.size + paths.size >= FILES_MAX) {
        await this.cancel(); return { error: '文件路径无效、重复或数量过多' };
      }
      paths.add(key);
      up.bytes += f.bytes.length;
      if (up.bytes > UPLOAD_MAX) { await this.cancel(); return { error: `内容太大：超过 ${UPLOAD_MAX / 1048576} MB` }; }
    }
    try {
      const written = await this.materialize(up.root, files);
      if (typeof written === 'string') throw new Error(written);
    } catch (error) { await this.cancel(); return { error: (error as Error).message }; }
    for (const path of paths) up.paths.add(path);
    return { files: files.length };
  }

  /** Large textures are transferred in bounded requests instead of one oversized JSON body. */
  async appendChunk(token: string, file: ImportFile, offset: number, total: number): Promise<{written:number}|{error:string}> {
    const up = this.uploads.get(token);
    if (!up) return { error: '这次上传已经过期，重新选一次' };
    try {
      const parts = segments(file.path), key = pathKey(file.path);
      if (!parts || !Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || offset < 0 || total < 0 || total > UPLOAD_MAX
        || offset + file.bytes.length > total || up.paths.has(key)) throw new Error('文件分块或路径无效');
      const pending = up.chunks.get(key);
      if ((pending && (pending.written !== offset || pending.total !== total)) || (!pending && offset !== 0)) throw new Error('文件分块顺序不完整');
      if (up.bytes + file.bytes.length > UPLOAD_MAX || (!pending && up.paths.size + up.chunks.size >= FILES_MAX)) throw new Error('导入内容超过限制');
      const full = childPath(up.root, file.path);
      await mkdir(join(up.root, ...parts.slice(0, -1)), {recursive:true});
      if (offset && (await stat(full)).size !== offset) throw new Error('文件分块校验失败，请重新导入');
      await writeFile(full, file.bytes, {flag:offset ? 'a' : 'w'});
      up.bytes += file.bytes.length;
      const written = offset + file.bytes.length;
      if (written === total) { up.chunks.delete(key); up.paths.add(key); }
      else up.chunks.set(key, {written,total});
      return {written};
    } catch (error) { await this.cancel(); return {error:(error as Error).message}; }
  }

  /** 上传完，扫描临时目录。 */
  async finishUpload(token: string, fromFolders: boolean, installed: Map<string, string>): Promise<StageResult | { error: string }> {
    const up = this.uploads.get(token);
    if (!up) return { error: '这次上传已经过期，重新选一次' };
    if (up.chunks.size) return {error:'文件尚未传输完整，请重新导入'};
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
  private async finish(root: string, fromFolders: boolean, installed: Map<string, string>,sources?:Array<{dir:string;full:string;entryFile?:string}>): Promise<StageResult | { error: string }> {
    try {
      const packs: StagedPack[] = [];
      const models: StagedModel[] = [];
      const problems: StageResult['problems'] = [];
      const local=new Map<string,string>();
      const candidates=async(kind:'pack'|'model')=>{
        const out:Array<{dir:string;full:string;entryFile?:string}>=[];
        for(const source of sources??[{dir:'',full:root}]) {
          if(source.entryFile && (kind==='pack') !== (source.entryFile.toLowerCase()==='figure.json'))continue;
          const dirs=source.entryFile?['']:await (kind==='pack'?findPacks:findModels)(source.full,PACK_DEPTH+(fromFolders?1:0));
          for(const rel of dirs) {
          const dir=[source.dir,rel].filter(Boolean).join('/'),full=join(source.full,...rel.split('/').filter(Boolean));
          out.push({dir,full,entryFile:source.entryFile});if(sources)local.set(dir,full);
          }
        }
        return out;
      };

      for (const {dir,full} of await candidates('pack')) {
        let manifest;
        try {
          manifest = await readPackManifest(full);
        } catch (err) {
          problems.push({ dir, reason: `figure.json 读不了：${(err as Error).message}` });
          continue;
        }
        const { id } = manifest;
        if (packs.some((p) => p.id.toLowerCase() === id.toLowerCase())) { problems.push({ dir, reason: `同一个包里有两个 ${id}` }); continue; }
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

      for (const {dir,full,entryFile} of await candidates('model')) {
        const entries = await readdir(full, { withFileTypes: true });
        const entry = entries.find((e) => e.isFile() && (entryFile ? e.name === entryFile : e.name.toLowerCase().endsWith('.model3.json')));
        if (!entry) continue;
        const info=await dirInfo(full).catch(()=>({bytes:0,files:0}));
        models.push({
          dir,
          file: entry.name,
          title: entry.name.replace(/\.model3\.json$/i, ''),
          files: info.files,
          bytes: info.bytes,
          installed: null,
        });
      }

      if (!sources && !packs.length && models.length === 1 && models[0].dir === '') {
        // 模型就摊在上传目录的根上：给它一个跟 .model3.json 同名的子目录，
        // 这样打包出来的 id 是模型名，而不是临时目录的名字。
        const title = models[0].title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'model';
        const sub = join(root, title);
        await mkdir(sub, { recursive: true });
        for (const e of await readdir(root, { withFileTypes: true })) {
          if (e.name === title) continue;
          await rename(join(root, e.name), join(sub, e.name));
        }
        models[0].dir = title;
      }

      if (!packs.length && !models.length) {
        await rm(root, { recursive: true, force: true });
        return { token: '', packs: [], models: [], problems };
      }
      const token = randomUUID();
      this.staged = { token, root, packs: new Set(packs.map((p) => p.dir)),models:new Set(models.map(m=>m.dir)),entries:new Map(models.map(m=>[m.dir,m.file])),...(sources?{local}:{}) };
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
    for (const dir of new Set(dirs)) {
      if (!staged.packs.has(dir)) return { error: '挑中的目录不在待装清单中' };
      const full = this.resolve(token,dir);
      if(!full)return {error:'挑中的目录已失效'};
      try {
        const { id } = await readPackManifest(full);
        chosen.push({ dir, id });
      } catch (error) { return { error: (error as Error).message }; }
    }
    if (!chosen.length) return { error: '挑中的包已经不在临时目录里了' };

    const conflicts = chosen.filter((c) => existsSync(join(opts.figuresDir, c.id))).map((c) => c.id);
    if (conflicts.some((id) => !replace.includes(id))) return { conflicts };

    const out: Array<{ id: string; target: string }> = [];
    for (const c of chosen) {
      const source = this.resolve(token,c.dir);
      if(!source)return {error:'挑中的目录已失效'};
      const target = await installPack(source, opts.figuresDir, opts);
      out.push({ id: c.id, target });
    }
    // Keep the staged files on failure so users can retry.
    for(const chosen of dirs)staged.packs.delete(chosen);
    if(!staged.packs.size&&!staged.models.size)await this.cancel();
    return { installed: out };
  }

  async cancel(token?: string): Promise<void> {
    const staged = this.staged;
    if (staged && (!token || staged.token === token)) {
      this.staged = null;
      await rm(staged.root, { recursive: true, force: true }).catch(() => {});
    }
    for (const [id, up] of this.uploads) if (!token || token === id) {
      this.uploads.delete(id);
      await rm(up.root, { recursive: true, force: true }).catch(() => {});
    }
  }

  resolvePack(token: string, dir: string): string | null {
    if (!this.staged || this.staged.token !== token || !this.staged.packs.has(dir)) return null;
    return this.resolve(token, dir);
  }

  modelFile(token: string, dir: string): string | undefined {
    return this.staged?.token === token ? this.staged.entries.get(dir) : undefined;
  }

  /** 待装清单里某个目录的绝对路径；token 不对就说没有。 */
  resolve(token: string, dir: string): string | null {
    const staged = this.staged;
    if (!staged || staged.token !== token) return null;
    if (!staged.packs.has(dir) && !staged.models.has(dir)) return null;
    if(staged.local)return staged.local.get(dir)??null;
    if (!dir) return staged.root;
    const parts = segments(dir);
    if (!parts) return null;
    return join(staged.root, ...parts);
  }
}
