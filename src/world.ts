/**
 * Live2D 模型一键安装 World。
 *
 * 交互全在面板里（dist/webui.js，手写 ESM，不打 bundle）：
 *   拖入 / 粘贴 / 选择文件 → 一键打包 → 卡片安装
 * 导入自动识别，打包与安装独立触发；重启 Coo 不重跑。
 *
 * 打包做两遍：先出默认取景的包，再去无头 Chrome 里量尺寸 + 拍封面，
 * 带着量出来的 fit 重建一次，最后把封面拷回去。
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  cp, mkdir, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises';
import { dirname, join, basename, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  World, WorldHost, WorldWebUiDecl, ToolDef, WorldStreamSocket,
} from 'cortico/core/types.ts';
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import { adaptationSummary, buildPack, dirSize, editPack, installPack, packDetail, scanModel, type ScanSummary } from './pipeline.ts';
import { PackImporter, filesFromBundle, filesFromZip, thumbOf } from './import.ts';
import { captureCover } from './cover.ts';
import { readClipboardPaths } from './clipboard.ts';
import { FigureAutomation, automationMode } from './automation.mjs';
import {
  CORE_HOME, CORE_FILE, CORE_URLS, CORE_VERSION, LICENSE_FILES,
  coreState, ensureCore,
} from './core.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const WORKBENCH_DIR = join(PACKAGE_DIR, 'workbench');
const VERSION = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8')).version as string;
// Bump only when the notice changes, independently of the package version.
const NOTICE_REVISION = 1;

export interface Live2dSection {
  enabled: boolean;
  modelDir?: string;
  figuresDir?: string;
  workDir?: string;
  /** 安装完就删掉那份打包产物。 */
  autoDelete?: boolean;
  /** 打包时拍封面（默认开）。 */
  cover?: boolean;
  /** 贴图最长边：2048 / 1024 / 512 / 4096，original = 原精度不缩放。 */
  texture?: string;
  clean?: boolean;
  assistMotions?: boolean;
  assistGear?: string;
  assistAuto?: boolean;
  modelRoots?: string;
}

type Phase = 'idle' | 'loading' | 'done' | 'error';

interface StepState {
  phase: Phase;
  hint: string;
  at?: number;
}

interface BuildState {
  packDir: string;
  bytes: number;
  words: number;
  cover: boolean;
  fit: boolean;
  at: number;
}

/** 一份打包产物（列表里的卡片）。 */
interface BuildRecord extends BuildState {
  id: string;
}

interface AutomationModel { id: string; kind: 'pack' | 'live2d'; title: string; dir: string; file: string }
interface NativeConfig { version: number; bindings: unknown[]; resources: unknown[] }

interface Persisted {
  modelDir: string;
  scan?: ScanSummary & { at: number };
  build?: BuildState;
  /** 历史打包，最新在前，手动清理前保留。 */
  builds?: BuildRecord[];
  install?: { target: string; at: number; buildId?: string };
  /** 用户同意 Live2D 许可、并取到核心组件的时间。 */
  coreConsentAt?: number;
  distributionNotice?: { revision: number; at: number };
}

const IDLE: StepState = { phase: 'idle', hint: '未执行' };

export class Live2dWorld implements World {
  readonly id = 'figure';
  private readonly opts: {
    getConfig: () => Live2dSection;
    persist: (patch: Record<string, unknown>) => void;
    dataDir: string;
  };
  private state: Persisted = { modelDir: '' };
  private steps = { scan: { ...IDLE }, build: { ...IDLE }, install: { ...IDLE } };
  private log: string[] = [];
  private busy = false;
  private activeAction: Promise<unknown> | null = null;
  private stopping = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private streams = new Set<WorldStreamSocket>();
  /** 核心组件是否就绪（start 时探一次，取到后更新）。 */
  private coreReady = false;
  /** 导入待装清单（zip / 文件夹）。 */
  private importer = new PackImporter();
  private host: WorldHost | null = null;
  private automation: FigureAutomation;

  constructor(opts: Live2dWorld['opts']) {
    this.opts = opts;
    this.automation = new FigureAutomation({
      getConfig: () => this.opts.getConfig(), getHost: () => this.host, dataDir: opts.dataDir,
      recentRoots: () => { const dir = this.state.modelDir || this.opts.getConfig().modelDir; return dir ? [dir] : []; },
      warn: (message: string) => this.say(message),
      execute: (model: AutomationModel, native: NativeConfig, signal?: AbortSignal) => this.executeAutomation(model, native, signal),
      evidence: (catalog: {model: AutomationModel}, native: unknown, samples: Array<{id:string;time:number}>, signal?: AbortSignal) => this.actionEvidence(catalog.model, native, samples, signal),
    });
  }

  envPromptVars(): Record<string, string> | null {
    return {};
  }

  tools(): ToolDef[] {
    return this.automation.tools() as ToolDef[];
  }

  async start(_host: WorldHost): Promise<void> {
    this.host = _host;
    this.stopping = false;
    const saved = await this.readState();
    if (saved) {
      this.state = saved;
      // 旧版本只有单份 build，先补成列表，卡片才不会空
      if (this.state.build && !(this.state.builds?.length)) {
        const b = this.state.build;
        this.state.builds = [{
          id: `${basename(b.packDir) || 'pack'}-${b.at}`,
          packDir: b.packDir, bytes: b.bytes, words: b.words,
          cover: b.cover, fit: b.fit, at: b.at,
        }];
      }
      this.hydrate();
    } else {
      const dir = (this.opts.getConfig().modelDir ?? '').trim();
      if (dir) this.state.modelDir = dir;
    }
    this.coreReady = (await coreState(this.coreDir())).ok;
    await this.automation.start();
    await this.importer.pruneAutomationInputs(join(this.workRoot(),'automation-inputs'),this.automation.activeSources());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.activeAction?.catch(() => {});
    await this.automation.stop();
    await this.saveQueue.catch(() => {});
    this.streams.clear();
    await this.importer.cancel();
    this.host = null;
  }

  /** figures/ 里已装的 id → 版本，导入时标「已装」。 */
  private async installedVersions(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const dir = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
    try {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        try {
          const m = JSON.parse(await readFile(join(dir, e.name, 'figure.json'), 'utf8'));
          out.set(String(m.id ?? e.name), String(m.version ?? ''));
        } catch { /* 不是模型包 */ }
      }
    } catch { /* 目录还不存在 */ }
    return out;
  }

  webUi(language?: string): WorldWebUiDecl {
    const zh = (language ?? 'zh').toLowerCase().startsWith('zh');
    const s = this.state;
    return {
      label: zh ? 'Live2D 模型一键安装' : 'Live2D One-Click Install',
      badges: [
        { label: zh ? '版本' : 'Version', value: `v${VERSION}`, tone: 'plain' },
        { label: zh ? '模型' : 'Model', value: s.scan ? `${s.scan.params}/${s.scan.roles}` : '—', tone: s.scan ? 'on' : 'plain' },
        { label: zh ? '包' : 'Pack', value: s.build ? `${(s.build.bytes / 1048576).toFixed(1)}M` : '—', tone: s.build ? 'on' : 'plain' },
        ...(s.build?.words ? [{ label: zh ? '词' : 'Words', value: s.build.words, tone: 'plain' as const }] : []),
        ...(s.build
          ? [{
              label: zh ? '封面' : 'Cover',
              value: s.build.cover ? '✓' : '—',
              tone: (s.build.cover ? 'on' : 'off') as 'on' | 'off',
            }]
          : []),
        ...(this.coreReady
          ? []
          : [{ label: zh ? '核心' : 'Core', value: zh ? '待获取' : 'missing', tone: 'off' as const }]),
      ],
      lamps: [
        { label: zh ? '扫描' : 'Scan', state: lamp(this.steps.scan), hint: this.steps.scan.hint },
        { label: zh ? '打包' : 'Pack', state: lamp(this.steps.build), hint: this.steps.build.hint },
        { label: zh ? '安装' : 'Install', state: lamp(this.steps.install), hint: this.steps.install.hint },
      ],
      panels: [{
        id: 'workbench',
        title: zh ? 'Live2D 模型一键安装' : 'Live2D One-Click Install',
        description: zh ? '拖入、粘贴或选择文件夹 / ZIP，一键打包' : 'Drop, paste or choose a folder / ZIP, then pack',
      }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      stream: (panel, socket) => {
        if (panel !== 'workbench') return;
        this.streams.add(socket);
        socket.onClose?.(() => this.streams.delete(socket));
        for (const line of this.log.slice(-50)) socket.send?.(line);
      },
      config: [CONFIG_GROUP(zh)],
      promptDocs: [{ key: 'worlds.figure.envPrompt', title: zh ? '模型自动化' : 'Figure automation', description: zh ? '模型识别、动作分析、确认安装与换装的工具流程' : 'Model discovery, action analysis, approved installation and wardrobe workflow', path: join(PACKAGE_DIR, 'src', 'ENV_PROMPT.md'), role: 'envPrompt' }],
    };
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    const readOnly = ['state', 'list', 'license', 'core', 'detail', 'settings', 'assistState'].includes(method);
    if (this.stopping) throw new Error('扩展正在停止');
    if (readOnly) return this.dispatch(panel, method, args);
    if (panel === 'workbench' && method === 'assistApprove') {
      await this.automation.approve(String(args[0] || ''));
      const result = await this.automation.install(String(args[0] || ''));
      try { await this.host?.pushEvent?.({type:'figure.installed',source:this.id,origin:'external',ts:new Date().toISOString(),text:'A figure was installed after the person approved the panel proposal. '+JSON.stringify(result)},{trigger:'debounce'}); }
      catch (error) { this.say(`! 安装已完成，Coo 通知未送达：${errText(error)}`); }
      return result;
    }
    if (this.busy) throw new Error('上一个动作还没结束');
    this.busy = true;
    const action = this.dispatch(panel, method, args);
    this.activeAction = action;
    try { return await action; }
    finally { this.busy = false; this.activeAction = null; }
  }

  private async dispatch(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'workbench') throw new Error(`未知面板：${panel}`);
    const dir = String(args[0] ?? this.state.modelDir ?? '').trim();

    if (method === 'state') {
      return { ...this.snapshot(), log: this.log.slice(-20) };
    }
    if (method === 'settings') {
      const cfg = this.opts.getConfig();
      return { cover: cfg.cover !== false, texture: cfg.texture || 'original', clean: Boolean(cfg.clean),
        autoDelete: Boolean(cfg.autoDelete), figuresDir: cfg.figuresDir || '',
        assistMotions: cfg.assistMotions === true, assistGear: automationMode(cfg).gear, assistAuto: cfg.assistAuto === true, modelRoots: cfg.modelRoots || '' };
    }
    if (method === 'assistState') return { ...automationMode(this.opts.getConfig()), plans: this.automation.pending(), submissions: this.automation.submissions() };
    if (method === 'assistReject') return this.automation.reject(String(args[0] || ''));
    if (method === 'assistAnalyze') {
      const token = String(args[0] || '');
      const dirs = (value: unknown) => Array.isArray(value) ? value.filter((v):v is string => typeof v === 'string').slice(0,20).map(dir=>({dir})) : [];
      this.automation.check();
      return this.queueAnalysis({token,models:dirs(args[1]),packs:dirs(args[2])},true);
    }

    if (method === 'noticeAccept') {
      if (args[0] !== NOTICE_REVISION) throw new Error('须知已更新，请重新阅读');
      const previous = this.state.distributionNotice;
      this.state.distributionNotice = { revision: NOTICE_REVISION, at: Date.now() };
      try { await this.save(); } catch (e) { this.state.distributionNotice = previous; throw e; }
      return this.noticePayload();
    }

    if (method === 'setDir') {
      if (!dir) throw new Error('目录为空');
      if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`);
      this.state.modelDir = dir;
      this.opts.persist({ modelDir: dir });
      await this.save();
      this.say(`目录 → ${dir}`);
      return { state: this.snapshot(), log: [`目录 → ${dir}`] };
    }

    if (method === 'scan') return this.doScan(dir);
    if (method === 'build') return this.doBuild(dir);
    if (method === 'install') return this.doInstall(dir, args[1] ? String(args[1]) : undefined);
    if (method === 'list') {
      return {
        ...this.snapshot(),
        builds: await this.listBuilds(),
        installed: this.state.install && existsSync(this.state.install.target) ? this.state.install : null,
        autoDelete: Boolean(this.opts.getConfig().autoDelete),
        figuresDir: await resolveFigures(this.opts.getConfig(), this.opts.dataDir),
      };
    }
    if (method === 'clearAll') {
      await this.listBuilds();
      const list = this.state.builds ?? [];
      const keep = list.slice(0, 1);
      const drop = list.slice(1);
      for (const b of drop) await rm(b.packDir, { recursive: true, force: true });
      this.state.builds = keep;
      if (this.state.build && !keep.some((b) => b.packDir === this.state.build!.packDir)) {
        delete this.state.build;
      }
      await this.save();
      this.say(`清空旧打包 · 删除 ${drop.length} 份`);
      return { removed: drop.length, state: this.snapshot(), builds: await this.listBuilds() };
    }
    if (method === 'license') {
      const which = String(args[0] ?? 'core');
      const file = which === 'sdk' ? LICENSE_FILES.sdk : LICENSE_FILES.core;
      let text = '';
      try { text = await readFile(join(WORKBENCH_DIR, 'pack', 'sdk', file), 'utf8'); } catch { /* ignore */ }
      return { file, text };
    }
    if (method === 'core') {
      return this.corePayload();
    }
    if (method === 'clipboard') return { paths: await readClipboardPaths() };
    if (method === 'importPaths') {
      const paths = Array.isArray(args[0]) ? args[0].filter((v): v is string => typeof v === 'string') : [];
      const result = await this.importer.stageLocal(paths, await this.installedVersions());
      if ('error' in result) throw new Error(result.error);
      await this.notifyImported(result);
      return result;
    }
    if (method === 'importKeep') {
      this.requireNotice();
      const source = this.importer.resolvePack(String(args[0] ?? ''), String(args[1] ?? ''));
      if (!source) throw new Error('这次导入已经过期，重新选一次');
      const parent = join(this.workRoot(), 'builds', `import-${randomUUID()}`);
      let committed = false;
      try {
        const packDir = await installPack(source, parent);
        const manifest = JSON.parse(await readFile(join(packDir, 'figure.json'), 'utf8'));
        const at = Date.now();
        const record = {
          id: `${manifest.id}-${at}-${randomUUID().slice(0, 8)}`,
          packDir, at, bytes: await dirSize(packDir),
          words: Array.isArray(manifest.vocab) ? manifest.vocab.length : 0,
          cover: Boolean(manifest.thumb), fit: false,
        };
        const previous = { build: this.state.build, builds: this.state.builds };
        this.state.build = record;
        this.state.builds = [record, ...(previous.builds ?? [])];
        try { await this.save(); }
        catch (e) { this.state.build = previous.build; this.state.builds = previous.builds; throw e; }
        committed = true;
        this.say(`已加入打包列表 · ${manifest.id}`);
        return { buildId: record.id, state: this.snapshot() };
      } finally {
        if (!committed) await rm(parent, { recursive: true, force: true }).catch(() => {});
      }
    }
    if (method === 'coreAccept') {
      if (args[0] !== true) throw new Error('需要先同意 Live2D 许可');
      this.say('获取 Live2D 核心组件…');
      await ensureCore(this.coreDir(), (line) => this.say(line));
      this.state.coreConsentAt = Date.now();
      this.coreReady = true;
      await this.save();
      return this.corePayload();
    }
    if (method === 'importStage') {
      const b64 = String(args[0] ?? '');
      const kind = String(args[1] ?? 'zip') === 'folder' ? 'folder' : 'zip';
      if (!b64) throw new Error('没有收到文件');
      const bytes = Buffer.from(b64, 'base64');
      const files = kind === 'folder' ? filesFromBundle(bytes) : filesFromZip(bytes);
      if (typeof files === 'string') throw new Error(files);
      const installed = await this.installedVersions();
      const r = await this.importer.stage(files, kind === 'folder', installed);
      if ('error' in r) throw new Error(r.error);
      this.say(`读到 ${r.packs.length} 个模型包`);
      await this.notifyImported(r);
      return r;
    }
    if (method === 'importInstall') {
      this.requireNotice();
      const token = String(args[0] ?? '');
      const dirs = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
      const replace = Array.isArray(args[2]) ? (args[2] as unknown[]).map(String) : [];
      const figures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
      this.steps.install = { phase: 'loading', hint: '导入安装中…' };
      try {
        const r = await this.importer.install(token, dirs, replace, {
          figuresDir: figures,
          backupRoot: join(dirname(figures), 'figure-backups'),
          keep: 2,
        });
        if ('error' in r) throw new Error(r.error);
        if ('conflicts' in r) { this.steps.install = { ...IDLE, hint: '同名形象需要确认替换' }; return { conflicts: r.conflicts }; }
        const last = r.installed[r.installed.length - 1];
        this.state.install = { target: last.target, at: Date.now() };
        this.steps.install = { phase: 'done', hint: last.target, at: Date.now() };
        let warn;
        try { await this.save(); }
        catch (error) { warn = `形象已安装，但安装记录保存失败：${errText(error)}`; this.say(`! ${warn}`); }
        this.say(`导入完成 · ${r.installed.map((x) => x.id).join('、')}`);
        return { installed: r.installed.map((x) => x.id), state: this.snapshot(), warn };
      } catch (e) {
        this.steps.install = { phase: 'error', hint: errText(e) };
        this.say(`导入失败 · ${errText(e)}`);
        throw e;
      }
    }
    if (method === 'importCancel') {
      await this.importer.cancel(typeof args[0] === 'string' ? args[0] : undefined);
      return { ok: true };
    }
    if (method === 'importBuild') {
      const token = String(args[0] ?? '');
      const dir = String(args[1] ?? '');
      const full = this.importer.resolve(token, dir);
      if (!full || !existsSync(full)) throw new Error('这次导入已经过期，重新选一次');
      const wantInstall = Boolean(args[2]);
      const built = await this.doBuild(full, { remember: false }) as { log?: string[] };
      const buildId = this.state.builds?.[0]?.id;
      let installed: unknown = null;
      if (wantInstall && buildId) installed = await this.doInstall(full, buildId);
      return { ...built, buildId, installed, state: this.snapshot() };
    }
    if (method === 'importBegin') {
      const token = await this.importer.beginUpload();
      return { token };
    }
    if (method === 'importAppend') {
      const token = String(args[0] ?? '');
      const list = Array.isArray(args[1]) ? (args[1] as Array<Record<string, unknown>>) : [];
      const files = list.map((f) => ({
        path: String(f?.path ?? ''),
        bytes: Buffer.from(String(f?.b64 ?? ''), 'base64'),
      }));
      const r = await this.importer.appendUpload(token, files);
      if ('error' in r) throw new Error(r.error);
      return r;
    }
    if (method === 'importAppendChunk') {
      const file = args[1] as Record<string, unknown> | undefined;
      if (!file || typeof file.path !== 'string' || typeof file.b64 !== 'string') throw new Error('文件分块无效');
      const result = await this.importer.appendChunk(String(args[0] ?? ''), {path:file.path,bytes:Buffer.from(file.b64,'base64')}, Number(file.offset), Number(file.total));
      if ('error' in result) throw new Error(result.error);
      return result;
    }
    if (method === 'importFinish') {
      const token = String(args[0] ?? '');
      const fromFolders = Boolean(args[1]);
      const installed = await this.installedVersions();
      const r = await this.importer.finishUpload(token, fromFolders, installed);
      if ('error' in r) throw new Error(r.error);
      this.say(`读到 ${r.models.length + r.packs.length} 个模型 / 模型包`);
      await this.notifyImported(r);
      return r;
    }
    if (method === 'detail') {
      const id = String(args[0] ?? '');
      const rec = (this.state.builds ?? []).find((b) => b.id === id);
      if (!rec || !existsSync(rec.packDir)) throw new Error('没有这份打包产物');
      return packDetail(rec.packDir);
    }
    if (method === 'edit') {
      const id = String(args[0] ?? '');
      const patch = (args[1] ?? {}) as Record<string, unknown>;
      const rec = (this.state.builds ?? []).find((b) => b.id === id);
      if (!rec || !existsSync(rec.packDir)) throw new Error('没有这份打包产物');
      await editPack(rec.packDir, patch as never);
      this.say(`改名 / 调参 · ${id}`);
      return { ok: true, builds: await this.listBuilds() };
    }
    if (method === 'setAuto') {
      const on = Boolean(args[0]);
      this.opts.persist({ autoDelete: on });
      return { autoDelete: on };
    }
    if (method === 'remove') {
      await this.removeBuild(String(args[0] ?? ''));
      return { state: this.snapshot(), builds: await this.listBuilds() };
    }
    throw new Error(`未知方法：${panel}.${method}`);
  }

  private async doScan(dir: string): Promise<unknown> {
    this.guard(dir);
    this.steps.scan = { phase: 'loading', hint: '扫描中…' };
    this.say(`扫描 ${dir}`);
    try {
      const t0 = Date.now();
      const scan = await scanModel(WORKBENCH_DIR, dir);
      const hint = `${scan.title || scan.id} · ${scan.params} 参数 / ${scan.roles} role`
        + (scan.unmapped.length ? ` · 未映射 ${scan.unmapped.slice(0, 4).join('/')}` : '');
      this.steps.scan = { phase: 'done', hint, at: Date.now() };
      this.state.modelDir = dir;
      this.state.scan = { ...scan, at: Date.now() };
      delete this.state.build;
      this.steps.build = { ...IDLE, hint: '需要重新打包' };
      this.steps.install = { ...IDLE };
      await this.save();
      this.say(`扫描完成 · ${hint} · ${Date.now() - t0} ms`);
      return { state: this.snapshot(), log: [`扫描完成 · ${Date.now() - t0} ms`] };
    } catch (e) {
      this.steps.scan = { phase: 'error', hint: errText(e) };
      this.say(`扫描失败 · ${errText(e)}`);
      throw e;
    }
  }

  private async doBuild(dir: string, opts: { remember?: boolean; native?: unknown; modelFile?: string; signal?: AbortSignal } = {}): Promise<unknown> {
    opts.signal?.throwIfAborted();
    this.guard(dir);
    this.requireNotice();
    // Core 不随包分发：没下载/没校验过就不打包，别产出跑不起来的形象包
    const core = await coreState(this.coreDir());
    if (!core.ok) throw new Error('缺少 Live2D 核心组件：先在面板上方同意许可并获取');
    const logs: string[] = [];
    const push = (line: string) => { logs.push(line); this.say(line); };
    const temporary = new Set<string>();
    let committed = false;
    try {
      this.steps.build = { phase: 'loading', hint: '打包中…' };
      this.steps.install = { ...IDLE, hint: '打包后需要安装' };
      push(`打包 ${dir}`);

      let t0 = Date.now();
      const maxTexture = textureLimit(this.opts.getConfig().texture);
      const clean = this.opts.getConfig().clean === true;
      let packDir = await buildPack(WORKBENCH_DIR, dir, this.workRoot(), { maxTexture, clean, corePath: core.file, native: opts.native, modelFile: opts.modelFile, signal: opts.signal });
      temporary.add(packDir);
      push(`初版包就绪 · ${Date.now() - t0} ms`);

      this.steps.build = { phase: 'loading', hint: '量尺寸 / 拍封面…' };
      t0 = Date.now();
      const shot = this.opts.getConfig().cover === false
        ? { ok: false, error: '设置里关闭了封面', fit: null as unknown }
        : await captureCover(packDir, WORKBENCH_DIR, 60000, [], opts.signal);
      opts.signal?.throwIfAborted();
      if (shot.ok) push(`封面 + 尺寸 · ${Date.now() - t0} ms`);
      else push(`! 封面跳过：${shot.error ?? '未知原因'}`);

      // 量出了 fit 就带着它重建一次，把取景写进 profile
      let finalDir = packDir;
      if (shot.fit) {
        t0 = Date.now();
        const rebuilt = await buildPack(WORKBENCH_DIR, dir, this.workRoot(), { fit: shot.fit, maxTexture, clean, corePath: core.file, native: opts.native, modelFile: opts.modelFile, signal: opts.signal });
        temporary.add(rebuilt);
        // 封面跟着走
        const thumb = join(packDir, 'thumb');
        if (existsSync(thumb)) {
          await cp(thumb, join(rebuilt, 'thumb'), { recursive: true });
          const file = join(rebuilt, 'figure.json');
          const manifest = JSON.parse(await readFile(file, 'utf8'));
          manifest.thumb = 'thumb/cover.png';
          if (Array.isArray(manifest.axes) && manifest.axes[0]?.options?.[0]) {
            manifest.axes[0].options[0].thumb = 'thumb/opt-model.png';
          }
          await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        }
        await rm(packDir, { recursive: true, force: true }).catch(() => {});
        finalDir = rebuilt;
        push(`按量出的取景重建 · ${Date.now() - t0} ms`);
      }

      opts.signal?.throwIfAborted();
      const bytes = await dirSize(finalDir);
      const manifest = JSON.parse(await readFile(join(finalDir, 'figure.json'), 'utf8'));
      const words = Array.isArray(manifest.vocab) ? manifest.vocab.length : 0;
      const hint = `${(bytes / 1048576).toFixed(1)} MB · ${words} 词`
        + (shot.ok ? ' · 封面 ✓' : '')
        + (shot.fit ? ' · 已贴合' : '');
      this.steps.build = { phase: 'done', hint, at: Date.now() };
      let report;
      try { report = JSON.parse(await readFile(join(finalDir, 'build.json'), 'utf8')); } catch { /* Optional for older converters. */ }
      const previous = {modelDir:this.state.modelDir,builds:this.state.builds,build:this.state.build,scan:this.state.scan,scanStep:this.steps.scan};
      if (report?.model) {
        this.state.scan = {...report.model,unmapped:report.unmapped??[],adaptation:adaptationSummary(report),at:Date.now()};
        this.steps.scan = {phase:'done',hint:`${report.model.title} · ${report.model.params} 参数 / ${report.model.roles} role`,at:Date.now()};
      } else { delete this.state.scan; this.steps.scan = {...IDLE}; }
      if (opts.remember !== false) this.state.modelDir = dir;
      const rec: BuildRecord = {
        id: `${manifest.id || 'pack'}-${Date.now()}`,
        packDir: finalDir, bytes, words,
        cover: shot.ok, fit: Boolean(shot.fit), at: Date.now(),
      };
      this.state.builds = [rec, ...(this.state.builds ?? [])];
      this.state.build = {
        packDir: finalDir, bytes, words, cover: shot.ok, fit: Boolean(shot.fit), at: Date.now(),
      };
      try { await this.save(); }
      catch (error) {
        this.state.modelDir = previous.modelDir; this.state.builds = previous.builds; this.state.build = previous.build;
        this.state.scan = previous.scan; this.steps.scan = previous.scanStep;
        throw error;
      }
      committed = true;
      push(`打包完成 · ${hint}`);
      const adaptation = report ? adaptationSummary(report) : undefined;
      return { state: this.snapshot(), log: logs, adaptation, warn: shot.ok ? undefined : `封面跳过：${shot.error ?? ''}` };
    } catch (e) {
      this.steps.build = { phase: 'error', hint: errText(e) };
      push(`打包失败 · ${errText(e)}`);
      throw e;
    } finally {
      if (!committed) for (const target of temporary) {
        const rel = relative(resolve(this.workRoot(), 'builds'), resolve(target));
        if (rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) await rm(target, {recursive:true,force:true}).catch(()=>{});
      }
    }
  }

  private async doInstall(dir: string, buildId?: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    this.requireNotice();
    const chosen = buildId
      ? (this.state.builds ?? []).find((b) => b.id === buildId)
      : this.state.build;
    if (!chosen || !existsSync(chosen.packDir)) throw new Error('先打包，再安装');
    this.steps.install = { phase: 'loading', hint: '安装中…' };
    try {
      const figures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
      const target = await installPack(chosen.packDir, figures, {
        backupRoot: join(dirname(figures), 'figure-backups'),
        keep: 2,
        signal,
      });
      this.steps.install = { phase: 'done', hint: target, at: Date.now() };
      this.state.install = { target, at: Date.now(), buildId };
      // 装完就删掉这份打包产物（开关打开时）
      if (this.opts.getConfig().autoDelete) {
        const rec = (this.state.builds ?? []).find((b) => b.packDir === chosen.packDir);
        if (rec) {
          try { await this.removeBuild(rec.id, { quiet: true }); this.say('已按开关删除打包产物'); }
          catch (e) { this.say(`! 安装已完成，清理打包产物失败：${errText(e)}`); }
        }
      }
      let warn;
      try { await this.save(); }
      catch (error) { warn = `形象已安装，但安装记录保存失败：${errText(error)}`; this.say(`! ${warn}`); }
      this.say(`安装完成 · ${target}`);
      return { state: this.snapshot(), log: [`安装到 ${target}`], warn };
    } catch (e) {
      this.steps.install = { phase: 'error', hint: errText(e) };
      this.say(`安装失败 · ${errText(e)}`);
      throw e;
    }
  }

  private async notifyImported(result: any): Promise<void> {
    try { const notified = await this.queueAnalysis(result); if(notified?.queued&&'count' in notified)this.say(`已交给 Coo 分析 · ${notified.count} 个模型`); }
    catch (error) { this.say(`! 导入成功，AI 分析通知未送达：${errText(error)}`); }
  }

  private async queueAnalysis(result: {token:string;models?:Array<{dir:string}>;packs?:Array<{dir:string}>},repeat=false) {
    if(this.opts.getConfig().assistMotions!==true||!result.token)return {queued:false};
    const paths=await this.importer.preserveForAutomation(result.token,join(this.workRoot(),'automation-inputs'),this.automation.activeSources());
    return this.automation.imported(result,(_token:string,dir:string)=>paths.get(dir),repeat);
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.stopping || this.busy) throw new Error('上一个动作还没结束，请稍后重试');
    this.busy = true;
    const pending = action(); this.activeAction = pending;
    try { return await pending; }
    finally { this.busy = false; this.activeAction = null; }
  }

  private actionEvidence(model: AutomationModel, native: unknown, samples: Array<{id:string;time:number}>, signal?: AbortSignal) {
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      const core = await coreState(this.coreDir());
      if (!core.ok) throw new Error('尚未获取 Live2D Core，使用文本分析');
      const scratch = join(this.workRoot(), `analysis-${randomUUID()}`);
      try {
        this.say('生成动作关键帧…');
        const pack = await buildPack(WORKBENCH_DIR, model.dir, scratch, {native,modelFile:model.file,maxTexture:1024,corePath:core.file,signal});
        const result = await captureCover(pack, WORKBENCH_DIR, 45000, samples, signal);
        signal?.throwIfAborted();
        if (!result.ok) throw new Error(result.error || '关键帧渲染失败');
        return result.evidence || [];
      } finally { await rm(scratch,{recursive:true,force:true}).catch(()=>{}); }
    });
  }

  private executeAutomation(model: AutomationModel, native: NativeConfig, signal?: AbortSignal) {
    return this.exclusive(async () => {
      this.requireNotice(); signal?.throwIfAborted();
      if (this.opts.getConfig().assistMotions !== true) throw new Error('AI 自动适配已关闭');
      if (model.kind === 'pack') {
        const target = await installPack(model.dir, await resolveFigures(this.opts.getConfig(),this.opts.dataDir), {backupRoot:join(this.opts.dataDir,'figure-backups'),keep:2,signal});
        const manifest = JSON.parse(await readFile(join(target,'figure.json'),'utf8'));
        this.state.install = {target,at:Date.now()};
        let warning;
        try { await this.save(); } catch (error) { warning = `形象已安装，但安装记录保存失败：${errText(error)}`; this.say(`! ${warning}`); }
        return {figureId:manifest.id,target,installed:true,mappings:[],warning};
      }
      await this.doBuild(model.dir, {native,modelFile:model.file,remember:false,signal});
      signal?.throwIfAborted();
      if (this.opts.getConfig().assistMotions !== true) throw new Error('AI 自动适配已关闭，打包产物保留，尚未安装');
      const record = this.state.builds?.[0];
      if (!record) throw new Error('打包未产出可安装模型');
      const manifest = JSON.parse(await readFile(join(record.packDir,'figure.json'),'utf8'));
      signal?.throwIfAborted();
      await this.doInstall(model.dir,record.id,signal);
      return {figureId:manifest.id,target:this.state.install?.target,installed:true,mappings:native.bindings};
    });
  }

  /** 打包历史，最新在前。卡片封面用 128 小图，转 data URL 给面板。 */
  private async listBuilds(): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let dropped = false;
    for (const b of this.state.builds ?? []) {
      if (!existsSync(b.packDir)) { dropped = true; continue; }
      let thumb = '';
      thumb = await thumbOf(b.packDir, 'thumb/opt-model.png') ?? '';
      let packId = '';
      let nameZh = '';
      let nameEn = '';
      let adaptation;
      try { adaptation = adaptationSummary(JSON.parse(await readFile(join(b.packDir, 'build.json'), 'utf8'))); }
      catch { /* older or imported packs may not include a build report */ }
      try {
        const m = JSON.parse(await readFile(join(b.packDir, 'figure.json'), 'utf8'));
        if (!thumb) thumb = await thumbOf(b.packDir, m.thumb) ?? '';
        packId = typeof m.id === 'string' ? m.id : '';
        nameZh = typeof m.name?.zh === 'string' ? m.name.zh : '';
        nameEn = typeof m.name?.en === 'string' ? m.name.en : '';
      } catch { /* 读不到就用 id */ }
      out.push({
        id: b.id, packId, nameZh, nameEn, bytes: b.bytes, words: b.words, cover: b.cover, fit: b.fit, at: b.at,
        exists: true, thumb,
        adaptation,
      });
    }
    if (dropped) {
      // Reads above yield to an in-flight build; prune the current list, never an older snapshot.
      const alive = (this.state.builds ?? []).filter((b) => existsSync(b.packDir));
      this.state.builds = alive;
      if (this.state.build && !alive.some((b) => b.packDir === this.state.build!.packDir)) {
        delete this.state.build;
      }
      await this.save();
    }
    return out;
  }

  private async removeBuild(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
    const list = this.state.builds ?? [];
    const idx = list.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('没有这份打包产物');
    const rec = list[idx];
    await rm(rec.packDir, { recursive: true, force: true });
    list.splice(idx, 1);
    this.state.builds = list;
    if (this.state.build?.packDir === rec.packDir) delete this.state.build;
    if (!opts.quiet) this.say(`删除打包产物 · ${id}`);
    await this.save();
  }

  private snapshot(): Record<string, unknown> {
    const s = this.state;
    return {
      dir: s.modelDir || (this.opts.getConfig().modelDir ?? ''),
      scan: s.scan ? {
        title: s.scan.title, id: s.scan.id,
        params: s.scan.params, roles: s.scan.roles,
        unmapped: s.scan.unmapped ?? [],
        adaptation: s.scan.adaptation,
      } : null,
      build: s.build ? {
        bytes: s.build.bytes, words: s.build.words, cover: s.build.cover, fit: s.build.fit,
      } : null,
      install: s.install ? { target: s.install.target } : null,
      builds: (s.builds ?? []).map((b) => ({ id: b.id, bytes: b.bytes, at: b.at })),
      autoDelete: Boolean(this.opts.getConfig().autoDelete),
      coreReady: this.coreReady,
      automation: { ...automationMode(this.opts.getConfig()), plans: this.automation.pending(), submissions: this.automation.submissions() },
      version: VERSION,
      notice: this.noticePayload(),
      busy: this.busy,
      steps: {
        scan: this.steps.scan, build: this.steps.build, install: this.steps.install,
      },
    };
  }

  private guard(dir: string): void {
    if (!dir) throw new Error('先选择模型目录');
    if (!existsSync(dir)) throw new Error(`目录不存在：${dir}`);
  }

  private say(line: string): void {
    this.log.push(line);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    for (const s of this.streams) {
      try { s.send?.(line); } catch { /* ignore */ }
    }
  }

  private workRoot(): string {
    return this.opts.getConfig().workDir?.trim() || join(this.opts.dataDir, 'figure');
  }

  /** 核心组件的缓存目录；清旧打包只删 builds/，不会碰到它。 */
  private coreDir(): string {
    return join(this.workRoot(), 'sdk');
  }

  private noticePayload(): { revision: number; acknowledged: boolean } {
    return { revision: NOTICE_REVISION, acknowledged: this.state.distributionNotice?.revision === NOTICE_REVISION };
  }

  private requireNotice(): void {
    if (!this.noticePayload().acknowledged) throw new Error('请先阅读并确认面板右上角的形象包分发须知');
  }

  /** 面板要的核心状态：文件是否就绪、版本、官方地址、同意时间。 */
  private async corePayload(): Promise<Record<string, unknown>> {
    const state = await coreState(this.coreDir());
    return {
      ...state,
      notice: this.noticePayload(),
      versionLabel: VERSION,
      file: CORE_FILE,
      version: CORE_VERSION,
      urls: CORE_URLS,
      home: CORE_HOME,
      consentAt: this.state.coreConsentAt ?? null,
    };
  }

  private stateFile(): string {
    return join(this.opts.dataDir, 'figure', 'state.json');
  }

  private async readState(): Promise<Persisted | null> {
    try {
      return JSON.parse(await readFile(this.stateFile(), 'utf8')) as Persisted;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new Error(`读取形象状态失败：${errText(e)}`);
    }
  }

  private async save(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2);
    const file = this.stateFile();
    const task = this.saveQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      try { await writeFile(tmp, data, 'utf8'); await rename(tmp, file); }
      finally { await rm(tmp, { force: true }).catch(() => {}); }
    });
    this.saveQueue = task;
    await task;
  }

  private hydrate(): void {
    const s = this.state;
    if (s.scan) {
      this.steps.scan = {
        phase: 'done',
        hint: `${s.scan.title || s.scan.id} · ${s.scan.params} 参数 / ${s.scan.roles} role`,
        at: s.scan.at,
      };
    }
    if (s.build) {
      this.steps.build = {
        phase: 'done',
        hint: `${(s.build.bytes / 1048576).toFixed(1)} MB · ${s.build.words} 词`
          + (s.build.cover ? ' · 封面 ✓' : '')
          + (s.build.fit ? ' · 已贴合' : ''),
        at: s.build.at,
      };
    }
    if (s.install) {
      this.steps.install = { phase: 'done', hint: s.install.target, at: s.install.at };
    }
  }
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e).slice(0, 300);

function lamp(s: StepState): 'online' | 'loading' | 'error' | 'offline' {
  if (s.phase === 'loading') return 'loading';
  if (s.phase === 'done') return 'online';
  if (s.phase === 'error') return 'error';
  return 'offline';
}

async function resolveFigures(cfg: Live2dSection, dataDir: string): Promise<string> {
  const explicit = cfg.figuresDir?.trim();
  if (explicit) return explicit;
  let dir = dataDir;
  for (let i = 0; i < 4 && dir && dir !== dirname(dir); i += 1) {
    const candidate = join(dir, 'figures');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  const fallback = join(dataDir, 'figures');
  await mkdir(fallback, { recursive: true });
  return fallback;
}

function CONFIG_GROUP(zh: boolean): ConfigGroup {
  return {
    id: 'figure',
    owner: 'world:figure',
    schema: {
      type: 'object',
      title: zh ? 'Live2D 模型一键安装' : 'Live2D One-Click Install',
      description: zh
        ? '面板里选目录、打包、安装；这里只放高级项。'
        : 'Use the panel for folder, pack and install; this tab keeps advanced options.',
      properties: {
        'worlds.figure.cover': {
          type: 'boolean',
          title: zh ? '打包时拍封面' : 'Capture a cover when packing',
          description: zh ? '关掉就不启动无头浏览器，也不量尺寸' : 'Off: skip headless render',
          'x-hot': true,
        },
        'worlds.figure.texture': {
          type: 'string',
          title: zh ? '贴图精度' : 'Texture size',
          enum: ['original', '4096', '2048', '1024', '512'],
          'x-hot': true,
          description: zh
            ? '打包时把贴图最长边缩到多少。original 是默认，原精度不缩放；往下选越小包越小、越省显存'
            : 'Longest texture edge when packing. original is the default; smaller sizes use less VRAM',
        },
        'worlds.figure.clean': {
          type: 'boolean',
          title: zh ? '清理' : 'Clean',
          'x-hot': true,
        },
        'worlds.figure.autoDelete': {
          type: 'boolean',
          title: zh ? '安装后删除打包产物' : 'Delete the pack after install',
          description: zh ? '仅在安装成功后删除对应打包产物，保留原始素材。' : 'Delete the corresponding pack only after installation succeeds; keep source files.',
          'x-hot': true,
        },
        'worlds.figure.figuresDir': {
          type: 'string',
          title: zh ? '安装目录（可留空）' : 'Install folder (optional)',
          description: zh ? '留空 = Coo 自己的 figures' : 'Empty = Coo figures',
          'x-hot': true,
          'x-path': { kind: 'directory' },
        },
        'worlds.figure.assistMotions': {type:'boolean',title:zh?'AI 自动适配':'AI action mapping',description:zh?'让 Coo 分析原生动作、生成方案并协助安装':'Let Coo inspect native actions, prepare a proposal and install it','x-hot':true},
        'worlds.figure.assistGear': {type:'string',enum:['auto','text','image'],title:zh?'分析方式':'Analysis mode','x-hot':true},
        'worlds.figure.assistAuto': {type:'boolean',title:zh?'全自动执行':'Automatic execution',description:zh?'高置信度方案直接安装；不确定动作保留通用表现':'Install confident mappings directly; keep generic behavior for uncertain actions','x-hot':true},
        'worlds.figure.modelRoots': {type:'string',title:zh?'模型搜索目录':'Model search folders',description:zh?'每行一个目录，仅在这些目录和最近使用的模型目录内按名字查找':'One folder per line; name searches stay within these and recent model folders','x-hot':true},
      },
    },
  };
}

/** 配置里的贴图上限；original / 空 / 非法一律当原精度（0 = 不缩放）。 */
function textureLimit(value: unknown): number {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v || v === 'original') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
