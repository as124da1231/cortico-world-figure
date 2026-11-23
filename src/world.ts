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
import { createHash, randomUUID } from 'node:crypto';
import { lstat, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from 'node:fs/promises';
import { dirname, join, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  World, WorldHost, WorldWebUiDecl, ToolDef, WorldStreamSocket, RunPhase,
} from 'cortico/core/types.ts';
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import { adaptationSummary, assertRegularTree, buildPack, dirSize, editPack, installPack, packDetail, refreshPackRuntime, scanModel, setPackAppearance, type ScanSummary } from './pipeline.ts';
import { canonicalPath, containsPath, isInsideRoot, packId } from './paths.ts';
import { parseFigureJson, readPackManifest } from './pack-manifest.ts';
import { PackImporter, filesFromBundle, filesFromZip, thumbOf, type StageResult } from './import.ts';
import { FIGURE_IMPORT } from './import-limits.mjs';
import { captureCover, captureWardrobeThumbnails, type CoverResult } from './cover.ts';
import { readClipboardPaths } from './clipboard.ts';
import { FigureAutomation, automationMode } from './automation.mjs';
import {adaptationMode,aiEnabled} from './adaptation.mjs';
import {ManualSessions,LIBRARY,writeNativePack} from './manual.ts';
import { openEditorInBrowser, serveBrowserEditor, type BrowserDraft, type BrowserEditor } from './browser-editor.ts';
import { FigurePerformance, preserveSavedActions, writePerformanceMove, type PerformanceConfig } from './performance.ts';
import { PERFORMANCE_ASSET } from '../workbench/pack/backends/performance-plan.js';
import {findModels,inspectNative,nativeConfig} from '../workbench/tools/native-catalog.mjs';
import {packFingerprint} from './pack-fingerprint.ts';
import { qualityPolicy } from '../workbench/pack/backends/render-quality.js';
import { EMOTION_EFFECT_SIZES, normalizeEmotionEffects, normalizeEmotionEffectSize } from '../workbench/tools/emotion-effect.mjs';
import { normalizeFigureThemes } from '../workbench/tools/theme-palette.mjs';
import {PREVIEW_SIZES,previewSize} from './manual-preview.ts';
import {wardrobeConfig} from '../workbench/pack/backends/wardrobe.js';
import { FigureVoice, type VoiceConfig } from './voice.ts';
import { DesktopSelection, FIGURE_ID, type DesktopBodyLookup } from './desktop-body.ts';
import { CORE_HOME, CORE_FILE, CORE_URLS, CORE_VERSION, LICENSE_FILES } from './core.ts';
import { cubismRuntimeState, ensureCubismRuntime, restoreCubismFramework } from './cubism-runtime.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const WORKBENCH_DIR = join(PACKAGE_DIR, 'workbench');
const RUNTIME_DIR = join(WORKBENCH_DIR, 'pack');
const VERSION = JSON.parse(await readFile(join(PACKAGE_DIR, 'package.json'), 'utf8')).version as string;
// Bump only when the notice changes, independently of the package version.
const NOTICE_REVISION = 1;

export interface Live2dSection extends VoiceConfig, PerformanceConfig {
  enabled: boolean;
  desktopFigure?: string;
  desktopFigureCursor?: number;
  modelDir?: string;
  figuresDir?: string;
  workDir?: string;
  /** 安装完就删掉那份打包产物。 */
  autoDelete?: boolean;
  /** 打包时拍封面（默认开）。 */
  cover?: boolean;
  /** 贴图最长边：2048 / 1024 / 512 / 4096，original = 原精度不缩放。 */
  texture?: string;
  quality?: string;
  previewSize?: string;
  emotionEffect?: string;
  emotionEffects?: string;
  emotionEffectSize?: string;
  themePalettes?: string;
  clean?: boolean;
  adaptationMode?: string;
  assistMotions?: boolean;
  assistGear?: string;
  assistDepth?: string;
  assistAuto?: boolean;
  assistConfirmFallback?: boolean;
  modelRoots?: string;
}

const includedEffects = (config: Live2dSection) => normalizeEmotionEffects(config.emotionEffects || config.emotionEffect);

type Phase = 'idle' | 'loading' | 'done' | 'error';
type ManualSaveStage = 'check' | 'pack' | 'images' | 'commit';
type PendingImages = ({ kind: 'manual'; token: string; stage: ManualSaveStage } | { kind: 'import'; token: string; dir: string })
  & { controller: AbortController };

interface StepState {
  phase: Phase;
  hint: string;
  at?: number;
}

interface BuildState {
  packDir: string;
  imported?: boolean;
  bytes: number;
  words: number;
  cover: boolean;
  fit: boolean;
  at: number;
}

/** 一份打包产物（列表里的卡片）。 */
interface BuildRecord extends BuildState {
  id: string;
  manualAvailable?: boolean;
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
  /** 用户同意 Live2D Core / SDK 许可的时间。 */
  coreConsentAt?: number;
  distributionNotice?: { revision: number; at: number };
}

const IDLE: StepState = { phase: 'idle', hint: '未执行' };

async function captureOptionalImages(
  run: (signal?: AbortSignal) => Promise<CoverResult>,
  signal?: AbortSignal,
  skipSignal?: AbortSignal,
): Promise<CoverResult> {
  signal?.throwIfAborted();
  const captureSignal = signal && skipSignal ? AbortSignal.any([signal, skipSignal]) : signal ?? skipSignal;
  try {
    captureSignal?.throwIfAborted();
    return await run(captureSignal);
  } catch (error) {
    signal?.throwIfAborted();
    if (!skipSignal?.aborted) throw error;
    return { ok: false, error: '已选择跳过图片' };
  }
}

async function workbenchCover(dir: string, declared: unknown): Promise<string | null> {
  return (declared === 'thumb/opt-model.png' ? null : await thumbOf(dir, declared))
    ?? await thumbOf(dir, 'thumb/cover.png')
    ?? await thumbOf(dir, 'thumb/opt-model.png');
}

export class Live2dWorld implements World {
  readonly id = 'figure';
  private desktopBody?: DesktopBodyLookup;
  private readonly selection: DesktopSelection;
  private readonly opts: {
    getConfig: () => Live2dSection;
    persist: (patch: Record<string, unknown>) => void;
    dataDir: string;
    secret?: (name: string) => string;
    storeSecret?: (name: string, value: string) => void;
  };
  private state: Persisted = { modelDir: '' };
  private steps = { scan: { ...IDLE }, build: { ...IDLE }, install: { ...IDLE } };
  private log: string[] = [];
  private busy = false;
  private activeAction: Promise<unknown> | null = null;
  private stopping = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private streams = new Set<WorldStreamSocket>();
  /** Live2D 运行组件是否就绪。 */
  private coreReady = false;
  private readonly cubismPreparation = new Map<string, ReturnType<typeof ensureCubismRuntime>>();
  /** 导入待装清单（zip / 文件夹）。 */
  private importer = new PackImporter();
  private desktopImport?: StageResult & { submission?: unknown };
  private host: WorldHost | null = null;
  private automation: FigureAutomation;
  private manual: ManualSessions;
  private browserEditors = new Map<string, BrowserEditor & { title: string; buildId?: string }>();
  private browserDrafts = new Map<string, { fingerprint: string; draft: BrowserDraft }>();
  private voice: FigureVoice;
  private performance: FigurePerformance;
  private playbackFigures: string;
  private pendingImages?: PendingImages;
  private cropCapture?: { id: string; controller: AbortController; task: Promise<{image:string|null}> };

  constructor(opts: Live2dWorld['opts']) {
    this.opts = opts;
    this.playbackFigures = join(opts.dataDir, 'figures');
    this.selection = new DesktopSelection(() => this.host?.store, opts.getConfig);
    const desktopBody = (id?: Parameters<DesktopBodyLookup>[0]) => {
      if (this.desktopBody) return this.desktopBody(id);
      const body = this.selection.body(id);
      if (body.id !== 'desktop-pet' || !body.figure || body.figure === 'coo' || body.figure === 'whale') return body;
      return { ...body, dir: join(this.playbackFigures, packId(body.figure)) };
    };
    this.voice = new FigureVoice({
      config: opts.getConfig, persist: opts.persist,
      secret: opts.secret, storeSecret: opts.storeSecret,
      figures: join(opts.dataDir, 'figures'),
      desktopBody,
      coordinatePerformance: (text, script, body) => this.performance.voiceCoordinator(text, script, body),
    });
    this.performance = new FigurePerformance({ config: opts.getConfig, persist: opts.persist, desktopBody,
      secret: opts.secret, storeSecret: opts.storeSecret, figures: join(opts.dataDir, 'figures') });
    this.manual = new ManualSessions(this.workRoot(),WORKBENCH_DIR);
    this.automation = new FigureAutomation({
      getConfig: () => this.opts.getConfig(), getHost: () => this.host, dataDir: opts.dataDir,
      recentRoots: () => { const dir = this.state.modelDir || this.opts.getConfig().modelDir; return dir ? [dir] : []; },
      warn: (message: string) => this.say(message),
      execute: (model: AutomationModel, native: NativeConfig, signal?: AbortSignal, fingerprint?: string, beforeSwap?: (replacesOtherPack:boolean) => void, sourceFingerprint?: string) => this.executeAutomation(model, native, signal, fingerprint, beforeSwap, sourceFingerprint),
      evidence: (catalog: {model: AutomationModel}, native: unknown, samples: Array<{id:string;time:number}>, signal?: AbortSignal) => this.actionEvidence(catalog.model, native, samples, signal),
    });
  }

  envPromptVars(): Record<string, string> | null {
    return { performance: this.performance.instructions() };
  }

  tools(): ToolDef[] {
    const tools = [...this.automation.tools() as ToolDef[], ...this.performance.tools()];
    const speak = this.voice.syncTool();
    return speak ? [...tools, speak] : tools;
  }

  outputTap() {
    const voice = this.voice.outputTap();
    const performance = this.performance.outputTap();
    if (!voice || !performance) return voice ?? performance;
    return {
      externalizes: (event: Parameters<typeof voice.onEvent>[0]) => voice.externalizes?.(event) ?? false,
      onEvent: (event: Parameters<typeof voice.onEvent>[0]) => { voice.onEvent(event); performance.onEvent(event); },
      onRoundEnd: voice.onRoundEnd,
      onAbort: (reason: string) => { voice.onAbort?.(reason); performance.onAbort?.(reason); },
    };
  }

  onRunPhase(phase: RunPhase) {
    this.voice.onRunPhase(phase);
  }

  attachDesktopBody(lookup: DesktopBodyLookup): void {
    this.desktopBody = lookup;
  }

  /** Prepares only the renderer and adaptation data. Cubism assets are read from their original folder. */
  async prepareDesktopModel(file: string, destination: string, signal: AbortSignal): Promise<string> {
    if (this.stopping || !this.host) throw Error('请先启用 Coo Figure');
    this.requireNotice();
    const modelFile = await realpath(file);
    if (!/\.model3\.json$/i.test(modelFile)) throw Error('请选择 Live2D 的 .model3.json 文件');
    signal.throwIfAborted();
    const found = await findModels(modelFile, { signal });
    const model = found.models.find((entry: {kind: string}) => entry.kind === 'live2d');
    if (!model) throw Error('没有找到可读取的 Live2D 模型');
    const core = await this.prepareCubismRuntime();
    const catalog = await inspectNative(model, { signal });
    const id = 'live2d-' + createHash('sha256').update(modelFile).digest('hex').slice(0, 18);
    const scratch = await mkdtemp(join(this.workRoot(), 'desktop-model-'));
    try {
      const config = this.opts.getConfig();
      const adapter = await buildPack(WORKBENCH_DIR, dirname(modelFile), scratch, {
        desktopSourceId: id, modelFile: basename(modelFile), corePath: core.file, maxTexture: 0,
        render: qualityPolicy(config), native: nativeConfig(catalog, [], { includeAll: true }),
        emotionEffects: includedEffects(config), emotionEffectSize: config.emotionEffectSize, themePalettes: normalizeFigureThemes(config.themePalettes),
        signal,
      });
      await writeFile(join(adapter, LIBRARY), JSON.stringify({ version: 1, catalog, bindings: [] }));
      await enablePackPerformance(adapter, this.performance.mode() === 'direct');
      await installPack(adapter, destination, { signal });
      return id;
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  async start(_host: WorldHost): Promise<void> {
    this.host = _host;
    this.stopping = false;
    this.selection.reset();
    this.playbackFigures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
    const saved = await this.readState();
    if (saved) {
      this.state = saved;
      // 旧版本只有单份 build，先补成列表，卡片才不会空
      if (this.state.build && !(this.state.builds?.length)) {
        const b = this.state.build;
        this.state.builds = [{
          ...b,
          id: `${basename(b.packDir) || 'pack'}-${b.at}`,
        }];
      }
      this.hydrate();
    } else {
      const dir = (this.opts.getConfig().modelDir ?? '').trim();
      if (dir) this.state.modelDir = dir;
    }
    const sdk = this.coreDir();
    if (this.state.coreConsentAt && !(await cubismRuntimeState(sdk)).ok) {
      try { await restoreCubismFramework(sdk, await this.previousFrameworkDirs()); }
      catch (error) { this.say(`! 暂未恢复 Live2D 缓存：${errText(error)}`); }
    }
    this.coreReady = (await cubismRuntimeState(sdk)).ok;
    await this.automation.start();
    await this.importer.pruneAutomationInputs(join(this.workRoot(),'automation-inputs'),this.retainedImportPaths());
    await this.voice.start(_host);
    await this.performance.start(_host);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const cropCapture = this.cropCapture;
    cropCapture?.controller.abort();
    await cropCapture?.task.catch(() => {});
    await Promise.all([this.voice.stop(), this.performance.stop()]);
    this.pendingImages?.controller.abort();
    await this.activeAction?.catch(() => {});
    await this.automation.stop();
    await Promise.allSettled([...this.browserEditors.values()].map(editor => editor.stop()));
    await this.manual.stop();
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
          const m = parseFigureJson(await readFile(join(dir, e.name, 'figure.json'), 'utf8'));
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
          : [{ label: zh ? '运行组件' : 'Runtime', value: zh ? '待获取' : 'missing', tone: 'off' as const }]),
      ],
      lamps: [
        { label: zh ? '扫描' : 'Scan', state: lamp(this.steps.scan), hint: this.steps.scan.hint },
        { label: zh ? '打包' : 'Pack', state: lamp(this.steps.build), hint: this.steps.build.hint },
        { label: zh ? '安装' : 'Install', state: lamp(this.steps.install), hint: this.steps.install.hint },
      ],
      panels: [{
        id: 'workbench',
        title: zh ? '工作台' : 'Workbench',
        description: zh ? '拖入、粘贴或选择文件夹 / ZIP，一键打包' : 'Drop, paste or choose a folder / ZIP, then pack',
      }, {id:'workshop',title:zh?'素材工坊':'Workshop',description:zh?'浏览、下载或投稿原始模型素材':'Browse, download or submit source models'},
       {id:'settings',title:zh?'模型设置':'Model settings',description:zh?'画质、适配与安装':'Quality, adaptation and installation'},
       {id:'effects',title:zh?'个性化':'Personalization',description:zh?'选择随形象包安装的主题配色与特效':'Choose theme colours and effects to include in figure packs'},
      {id:'voice',title:zh?'文字转语音':'Text to speech',description:zh?'配置语音提供商、模型和音色':'Configure speech providers, models and voices'}],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      stream: (panel, socket) => {
        if (panel !== 'workbench') return;
        this.streams.add(socket);
        socket.onClose?.(() => this.streams.delete(socket));
        for (const line of this.log.slice(-50)) socket.send?.(line);
      },
      config: [CONFIG_GROUP(zh)],
      promptDocs: [{ key: 'worlds.figure.envPrompt', title: zh ? '提示词模板' : 'Prompt template', description: zh ? '模型识别、动作分析、确认安装与换装的工具流程' : 'Model discovery, action analysis, approved installation and wardrobe workflow', path: join(PACKAGE_DIR, 'src', 'ENV_PROMPT.md'), role: 'envPrompt', vars:[{name:'performance',description:'Direct performance instructions',multiline:true}] }],
    };
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    const readOnly = ['state', 'list', 'license', 'core', 'detail', 'coverPreview', 'cropPreview', 'settings', 'assistState', 'manualPreview', 'manualClose', 'manualKeepAlive', 'manualSkipImages', 'manualSaveProgress', 'manualBrowserStatus', 'skipImportCover'].includes(method);
    if (this.stopping) throw new Error('扩展正在停止');
    if (panel === 'settings' || panel === 'workbench') {
      if (method === 'performanceSync') {
        await this.performance.syncMode();
        return { mode: this.performance.mode() };
      }
      if (method === 'performanceReadiness') return this.performance.readiness();
      if (method === 'desktopTargets') return this.desktopTargets();
      if (method === 'selectDesktopFigure') {
        if (this.busy) throw Error('请等当前安装或打包完成后再切换形象');
        return this.exclusive(async () => {
          const figure = typeof args[0] === 'string' ? args[0] : '';
          if (figure && (!FIGURE_ID.test(figure) || !(await this.desktopTargets()).some(item => item.id === figure))) {
            throw Error('请选择已安装的 Figure 形象');
          }
          this.playbackFigures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
          const resume = await this.voice.suspend();
          try {
            await this.opts.persist({desktopFigure: figure, desktopFigureCursor: this.host?.store.latestCursor() ?? 0});
            await this.performance.refreshSelection();
          } finally { resume(); }
          return this.performance.readiness();
        });
      }
      if (method === 'plannerState') return this.performance.planners.state();
      if (method === 'plannerSave') return this.performance.planners.save(args[0]);
      if (method === 'plannerSelect') return this.performance.planners.select(args[0]);
      if (method === 'plannerRemove') return this.performance.planners.remove(args[0]);
      if (method === 'plannerModels') return this.performance.planners.models(args[0]);
      if (method === 'plannerTest') return this.performance.planners.test(args[0]);
    }
    if (panel === 'voice' || panel === 'settings') {
      if (method === 'voiceState') return this.voice.state();
      if (panel === 'voice' && method === 'voiceSave') return this.voice.save(args);
      if (panel === 'voice' && method === 'voiceTest') return this.voice.test(args);
      if (panel === 'voice' && method === 'voiceRemove') return this.voice.remove(args[0]);
      if (method === 'voiceControls') return this.voice.controls(args[0]);
      if (method === 'voiceAudition') return this.voice.audition();
      if (method === 'voiceStop') return this.voice.stopAudition();
      if (method === 'voiceHush') return this.voice.stopNarration();
    }
    if (readOnly) return this.dispatch(panel, method, args);
    if (panel === 'workbench' && method === 'assistApprove') {
      await this.automation.approve(String(args[0] || ''));
      const result = await this.automation.install(String(args[0] || ''));
      try { await this.host?.pushEvent?.({type:'figure.installed',source:this.id,origin:'external',ts:new Date().toISOString(),text:'A figure was installed after the person approved the panel proposal. '+JSON.stringify(result)},{trigger:'debounce'}); }
      catch (error) { this.say(`! 安装已完成，Coo 通知未送达：${errText(error)}`); }
      return result;
    }
    // The panel can unmount while its upload or build still needs the staged files.
    if (panel === 'workbench' && method === 'importCancel' && typeof args[0] === 'string' && args[0]) {
      while (this.activeAction) await this.activeAction.catch(() => {});
      if (this.stopping) return { ok: true };
    }
    if (this.busy) throw new Error('上一个动作还没结束');
    this.busy = true;
    const action = this.dispatch(panel, method, args);
    this.activeAction = action;
    try { return await action; }
    finally { this.busy = false; this.activeAction = null; }
  }

  private async dispatch(panel: string, method: string, args: unknown[]): Promise<unknown> {
    const sharedRead = (panel === 'workshop' && method === 'core')
      || (['settings', 'effects', 'voice'].includes(panel) && ['settings', 'state', 'core'].includes(method));
    const desktopImport = panel === 'settings' && method === 'importDesktopSource';
    if (panel !== 'workbench' && !sharedRead && !desktopImport) throw new Error(`未知面板：${panel}`);
    const dir = String(args[0] ?? this.state.modelDir ?? '').trim();

    if (method === 'state') {
      return { ...this.snapshot(), log: this.log.slice(-20) };
    }
    if (method === 'settings') {
      const cfg = this.opts.getConfig();
      return { cover: cfg.cover !== false, texture: cfg.texture || 'original', quality: qualityPolicy(cfg).mode, previewSize:String(previewSize(cfg.previewSize)),
        emotionEffects: includedEffects(cfg), emotionEffectSize: normalizeEmotionEffectSize(cfg.emotionEffectSize),
        themePalettes: normalizeFigureThemes(cfg.themePalettes),
        clean: Boolean(cfg.clean),
        autoDelete: Boolean(cfg.autoDelete), figuresDir: cfg.figuresDir || '',
        adaptationMode: adaptationMode(cfg), assistMotions: aiEnabled(cfg), assistGear: automationMode(cfg).gear, assistDepth: automationMode(cfg).configuredDepth, assistAuto: automationMode(cfg).automatic, assistConfirmFallback: cfg.assistConfirmFallback === true, modelRoots: cfg.modelRoots || '',
        performanceMode: this.performance.mode(), desktopFigure: cfg.desktopFigure || '' };
    }
    if (method === 'manualPreview') return this.manual.preview(String(args[0]),args[1]);
    if (method === 'manualClose') { await this.manual.close(String(args[0])); return {ok:true}; }
    if (method === 'manualKeepAlive') { this.manual.get(String(args[0])); return {ok:true}; }
    if (method === 'manualSaveProgress') return this.manualSaveProgress(String(args[0]));
    if (method === 'manualSkipImages') {
      const capture = this.pendingImages;
      if (capture?.kind !== 'manual' || capture.token !== args[0]) throw Error('这次保存已结束');
      capture.controller.abort();
      return { skipped: true };
    }
    if (method === 'skipImportCover') {
      const capture = this.pendingImages;
      if (capture?.kind !== 'import' || capture.token !== args[0] || capture.dir !== args[1]) throw Error('这次封面处理已结束');
      capture.controller.abort();
      return { skipped: true };
    }
    if (method === 'manualOpen' || method === 'manualOpenBuild') return this.openManual(method,args);
    if (method === 'manualBrowserOpen') return this.openBrowserManual(args);
    if (method === 'manualBrowserStatus') {
      if (!args.length) {
        for (const [token, editor] of this.browserEditors) {
          return { status: 'open', token, title: editor.title, buildId: editor.buildId, saving: editor.isSaving() };
        }
        return { status: 'closed' };
      }
      const token = String(args[0]);
      const saved = this.manual.saved(token);
      if (saved) return { status: 'saved', buildId: saved.buildId, warn: saved.warn };
      return { status: this.browserEditors.has(token) ? 'open' : 'closed' };
    }
    if (method === 'manualBrowserEnd') {
      const editor = this.browserEditors.get(String(args[0]));
      if (!editor) return { status: 'closed' };
      if (editor.isSaving()) throw Error('正在保存，请稍候。');
      await editor.stop();
      return { status: 'closed' };
    }
    if (method === 'manualSave') {
      const [token, bindings, wardrobe] = args;
      if (typeof token !== 'string' || !token || !Array.isArray(bindings)
          || wardrobe != null && !Array.isArray(wardrobe)) throw Error('绑定保存参数无效');
      if (this.browserEditors.has(token)) throw Error('请在当前浏览器编辑页保存。');
      return this.saveManual(token, bindings, wardrobe ?? undefined);
    }
    if (method === 'assistState') return { ...automationMode(this.opts.getConfig()), plans: this.automation.pending(), submissions: this.automation.submissions() };
    if (method === 'importDesktopSource') return this.importDesktopSource(packId(args[0]));
    if (method === 'takeDesktopImport') {
      const staged = this.desktopImport;
      this.desktopImport = undefined;
      return staged && this.importer.modelFile(staged.token, staged.models[0].dir) ? staged : null;
    }
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
    if (method === 'install') {
      const id = args[1];
      if (id != null && typeof id !== 'string') throw Error('打包记录无效');
      return this.installWithConfirmation(dir, id || undefined, args[2] === true);
    }
    if (method === 'list') {
      return {
        ...this.snapshot(),
        browserBuildId: this.browserEditors.values().next().value?.buildId,
        builds: await this.listBuilds(),
        installed: this.state.install && existsSync(this.state.install.target) ? this.state.install : null,
        autoDelete: Boolean(this.opts.getConfig().autoDelete),
        figuresDir: await resolveFigures(this.opts.getConfig(), this.opts.dataDir),
      };
    }
    if (method === 'clearAll') {
      await this.listBuilds();
      const list = this.state.builds ?? [];
      const drop = list.slice(1);
      for (const b of drop) await this.assertRemovableBuild(b.packDir);
      const failures: string[] = [];
      let removed = 0;
      for (const build of drop) {
        try {
          await this.removeBuild(build.id);
          removed++;
        } catch (error) {
          failures.push(`${build.id} · ${errText(error)}`);
        }
      }
      const warn = removed ? await this.saveOutcome('打包目录已删除，但删除记录保存失败') : undefined;
      this.say(`清空旧打包 · 删除 ${removed} 份`);
      return { removed, failures, warn, state: this.snapshot(), builds: await this.listBuilds() };
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
      return this.withImportSubmission(result);
    }
    if (method === 'importKeep') {
      this.requireNotice();
      const source = this.importer.resolvePack(String(args[0] ?? ''), String(args[1] ?? ''));
      if (!source) throw new Error('这次导入已经过期，重新选一次');
      const parent = join(this.workRoot(), 'builds', `import-${randomUUID()}`);
      let committed = false;
      try {
        const packDir = await installPack(source, parent);
        const manifest = parseFigureJson(await readFile(join(packDir, 'figure.json'), 'utf8'));
        const at = Date.now();
        const record = {
          id: `${manifest.id}-${at}-${randomUUID().slice(0, 8)}`,
          packDir, imported: true, at, bytes: await dirSize(packDir),
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
    if (method === 'coreAccept' || method === 'coreRestore') {
      if (method === 'coreAccept') {
        if (args[0] !== true) throw new Error('需要先同意 Live2D 许可');
        if (!this.state.coreConsentAt) {
          this.state.coreConsentAt = Date.now();
          try { await this.save(); }
          catch (error) { delete this.state.coreConsentAt; throw error; }
        }
      }
      await this.prepareCubismRuntime();
      return this.corePayload();
    }
    if (method === 'importStage') {
      const b64 = args[0];
      const kind = args[1] ?? 'zip';
      if (typeof b64 !== 'string' || !b64) throw new Error('没有收到文件');
      if (kind !== 'zip' && kind !== 'folder') throw new Error('导入文件类型无效');
      if (kind === 'zip') importPayloadSize(b64, FIGURE_IMPORT.zip, 'ZIP 超过 32 MB，请选择解压后的文件夹');
      else importPayloadSize(b64, FIGURE_IMPORT.bundle, '文件夹数据过大，请重新选择文件夹分批导入');
      const bytes = Buffer.from(b64, 'base64');
      const files = kind === 'folder' ? filesFromBundle(bytes) : filesFromZip(bytes);
      if (typeof files === 'string') throw new Error(files);
      const installed = await this.installedVersions();
      const r = await this.importer.stage(files, kind === 'folder', installed);
      if ('error' in r) throw new Error(r.error);
      this.say(`读到 ${r.packs.length} 个模型包`);
      return this.withImportSubmission(r);
    }
    if (method === 'importInstall') {
      this.requireNotice();
      const token = String(args[0] ?? '');
      const dirs = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
      const replace = Array.isArray(args[2]) ? (args[2] as unknown[]).map(String) : [];
      const figures = await this.installDirectory();
      this.steps.install = { phase: 'loading', hint: '导入安装中…' };
      try {
        const r = await this.importer.install(token, dirs, replace, {
          figuresDir: figures,
          install: (source, beforeSwap) => this.installPrepared(source, figures, { beforeSwap, keepPackThemes: true }),
        });
        if ('error' in r) throw new Error(r.error);
        if ('conflicts' in r) { this.steps.install = { ...IDLE, hint: '同名形象需要确认替换' }; return { conflicts: r.conflicts }; }
        const last = r.installed[r.installed.length - 1];
        this.state.install = { target: last.target, at: Date.now() };
        this.steps.install = { phase: 'done', hint: last.target, at: Date.now() };
        const warn = await this.saveOutcome('形象已安装，但安装记录保存失败');
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
      const controller = new AbortController();
      this.pendingImages = { kind: 'import', token, dir, controller };
      let built;
      try {
        built = await this.doBuild(full, { remember: false, modelFile: this.importer.modelFile(token, dir), skipImages: controller.signal });
      } finally {
        this.pendingImages = undefined;
      }
      const buildId = built.buildId;
      let installed: unknown = null;
      if (wantInstall && buildId) installed = await this.installWithConfirmation(full, buildId, false);
      return { ...built, buildId, installed, state: this.snapshot() };
    }
    if (method === 'importBegin') {
      const token = await this.importer.beginUpload();
      return { token };
    }
    if (method === 'importAppend') {
      const [token, list] = args;
      if (typeof token !== 'string' || !token) throw new Error('这次上传已经过期，重新选一次');
      if (!Array.isArray(list) || list.length > FIGURE_IMPORT.files) throw new Error('上传批次无效或文件过多');
      let batchSize = 0;
      const entries = list.map(entry => {
        const file = readImportFile(entry);
        batchSize += importPayloadSize(file.b64, FIGURE_IMPORT.file, '单个文件过大，请重新选择文件夹分块导入');
        if (batchSize > FIGURE_IMPORT.batch) throw new Error('上传批次过大，请重新选择文件夹');
        return file;
      });
      const files = entries.map(({path, b64}) => ({path, bytes: Buffer.from(b64, 'base64')}));
      const r = await this.importer.appendUpload(token, files);
      if ('error' in r) throw new Error(r.error);
      return r;
    }
    if (method === 'importAppendChunk') {
      const [token, payload] = args;
      if (typeof token !== 'string' || !token) throw new Error('这次上传已经过期，重新选一次');
      const file = readImportFile(payload);
      const size = importPayloadSize(file.b64, FIGURE_IMPORT.chunk, '文件分块过大，请重新选择文件夹');
      const {offset, total} = payload as Record<string, unknown>;
      if (typeof offset !== 'number' || typeof total !== 'number' || !Number.isSafeInteger(offset) || !Number.isSafeInteger(total)
          || offset < 0 || total > FIGURE_IMPORT.folder || offset + size > total) throw new Error('文件分块无效');
      const result = await this.importer.appendChunk(token, {path:file.path,bytes:Buffer.from(file.b64,'base64')}, offset, total);
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
      return this.withImportSubmission(r);
    }
    if (method === 'detail' || method === 'coverPreview' || method === 'cropPreview') {
      const id = String(args[0] ?? '');
      const rec = (this.state.builds ?? []).find((b) => b.id === id);
      if (!rec || !existsSync(rec.packDir)) throw new Error('没有这份打包产物');
      if (method === 'coverPreview') {
        const manifest = parseFigureJson(await readFile(join(rec.packDir, 'figure.json'), 'utf8'));
        return {image: await workbenchCover(rec.packDir, manifest.thumb)};
      }
      if (method === 'cropPreview') return this.previewCrop(rec);
      return packDetail(rec.packDir);
    }
    if (method === 'edit') {
      const id = args[0], patch = args[1] ?? {};
      if (typeof id !== 'string' || !id || typeof patch !== 'object' || Array.isArray(patch)) throw Error('打包编辑参数无效');
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
      const id = args[0];
      if (typeof id !== 'string' || !id) throw Error('打包记录无效');
      await this.removeBuild(id);
      this.say(`删除打包产物 · ${id}`);
      const warn = await this.saveOutcome('打包目录已删除，但删除记录保存失败');
      return { warn, state: this.snapshot(), builds: await this.listBuilds() };
    }
    throw new Error(`未知方法：${panel}.${method}`);
  }

  private async previewCrop(record: BuildRecord) {
    const detail = await packDetail(record.packDir);
    if (!detail.crop) return {image:null};
    const cover = await thumbOf(record.packDir, 'thumb/cover.png');
    if (cover) return {image:cover};
    if (!record.manualAvailable || this.stopping) return {image:null};
    if (this.cropCapture) return this.cropCapture.id === record.id ? this.cropCapture.task : {image:null};
    const controller = new AbortController();
    const task = (async () => {
      await assertRegularTree(record.packDir);
      const entry = await readFile(join(record.packDir, 'figure.js'));
      if (!entry.equals(await readFile(join(RUNTIME_DIR, 'figure.js')))) return {image:null};
      const result = await captureCover(record.packDir, WORKBENCH_DIR, 14000, [], controller.signal, {imageOnly:true});
      return {image:result.image ?? null};
    })();
    this.cropCapture = {id:record.id, controller, task};
    try { return await task; }
    finally { if (this.cropCapture?.task === task) this.cropCapture = undefined; }
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

  private async doBuild(dir: string, opts: { remember?: boolean; native?: unknown; wardrobe?:any[]; modelFile?: string; fingerprint?: string; sourceFingerprint?: string; signal?: AbortSignal; skipImages?: AbortSignal; onSaveStage?: (stage: ManualSaveStage) => void } = {}) {
    opts.signal?.throwIfAborted();
    this.guard(dir);
    this.requireNotice();
    const core = await this.prepareCubismRuntime();
    opts.signal?.throwIfAborted();
    const logs: string[] = [];
    const push = (line: string) => { logs.push(line); this.say(line); };
    const temporary = new Set<string>();
    let scratch: string | undefined;
    let committed = false;
    try {
      this.steps.build = { phase: 'loading', hint: '打包中…' };
      this.steps.install = { ...IDLE, hint: '打包后需要安装' };
      push(`打包 ${dir}`);

      let source = dir;
      let snapshotCatalog;
      if (opts.fingerprint) {
        const root = await canonicalPath(this.workRoot());
        if (containsPath(await canonicalPath(dir), root)) throw Error('模型目录不能包含扩展的工作目录');
        await mkdir(root, {recursive:true});
        scratch = await mkdtemp(join(root, 'model-input-'));
        source = join(scratch, basename(dir));
        await cp(dir, source, {recursive:true, dereference:false});
        await assertRegularTree(source);
        if (opts.sourceFingerprint && await packFingerprint(source, opts.signal) !== opts.sourceFingerprint) {
          throw Error('模型素材已变化，请重新分析确认');
        }
        const found = await findModels(opts.modelFile ? join(source, opts.modelFile) : source, {signal:opts.signal});
        const model = found.models.find((entry:any) => entry.kind === 'live2d');
        if (!model) throw Error('模型入口已变化，请重新分析确认');
        snapshotCatalog = await inspectNative(model, {signal:opts.signal});
        if (snapshotCatalog.fingerprint !== opts.fingerprint) throw Error('模型素材已变化，请重新分析确认');
      }
      let t0 = Date.now();
      const render = qualityPolicy(this.opts.getConfig());
      const maxTexture = render.textureLimit;
      const clean = this.opts.getConfig().clean === true;
      const emotionEffects = includedEffects(this.opts.getConfig());
      const emotionEffectSize = normalizeEmotionEffectSize(this.opts.getConfig().emotionEffectSize);
      const themePalettes = normalizeFigureThemes(this.opts.getConfig().themePalettes);
      opts.onSaveStage?.('pack');
      let packDir = await buildPack(WORKBENCH_DIR, source, this.workRoot(), { render, maxTexture, clean, emotionEffects, emotionEffectSize, themePalettes, corePath: core.file, native: opts.native, modelFile: opts.modelFile, signal: opts.signal });
      temporary.add(packDir);
      push(`初版包就绪 · ${Date.now() - t0} ms`);

      this.steps.build = { phase: 'loading', hint: '量尺寸 / 拍封面…' };
      t0 = Date.now();
      const coverEnabled = this.opts.getConfig().cover !== false;
      if (coverEnabled && !opts.skipImages?.aborted) opts.onSaveStage?.('images');
      const shot = coverEnabled
        ? await captureOptionalImages(signal => captureCover(packDir, WORKBENCH_DIR, 60000, [], signal), opts.signal, opts.skipImages)
        : { ok: false, error: '设置里关闭了封面', fit: null };
      opts.signal?.throwIfAborted();
      const coverWarning = coverEnabled && !shot.ok ? `封面未生成：${shot.error || '未知原因'}` : undefined;
      if (shot.ok) push(`封面 + 尺寸 · ${Date.now() - t0} ms`);
      else push(`! ${coverWarning ?? shot.error}`);

      // 量出了 fit 就带着它重建一次，把取景写进 profile
      let finalDir = packDir;
      if (shot.fit) {
        t0 = Date.now();
        const rebuilt = await buildPack(WORKBENCH_DIR, source, this.workRoot(), { render, fit: shot.fit, maxTexture, clean, emotionEffects, emotionEffectSize, themePalettes, corePath: core.file, native: opts.native, modelFile: opts.modelFile, signal: opts.signal });
        temporary.add(rebuilt);
        // 封面跟着走
        const thumb = join(packDir, 'thumb');
        if (existsSync(thumb)) {
          await cp(thumb, join(rebuilt, 'thumb'), { recursive: true });
          const file = join(rebuilt, 'figure.json');
          const manifest = parseFigureJson(await readFile(file, 'utf8'));
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
      const found = await findModels(opts.modelFile ? join(dir,opts.modelFile) : dir);
      const model = found.models.find((m:any)=>m.kind==='live2d');
      const catalog=snapshotCatalog ?? (model ? await inspectNative(model, {signal:opts.signal}) : null);
      if(catalog){
        if(model) catalog.model=model;
        const bindings=(opts.native as any)?.bindings||[];
        await writeFile(join(finalDir,LIBRARY),JSON.stringify({version:1,catalog,bindings}));
        if(opts.wardrobe)await writeNativePack(finalDir,catalog,bindings,false,opts.wardrobe);
        await enablePackPerformance(finalDir);
      }
      if (!opts.skipImages?.aborted && opts.wardrobe?.some(group => group.options.length)) opts.onSaveStage?.('images');
      const wardrobeWarning = opts.wardrobe ? await this.captureWardrobe(finalDir, opts.signal, opts.skipImages) : undefined;
      if (wardrobeWarning) push(`! ${wardrobeWarning}`);
      const bytes = await dirSize(finalDir);
      const manifest = await readPackManifest(finalDir);
      const words = Array.isArray(manifest.vocab) ? manifest.vocab.length : 0;
      const hint = `${(bytes / 1048576).toFixed(1)} MB · ${words} 词`
        + (shot.ok ? ' · 封面 ✓' : '')
        + (shot.fit ? ' · 已贴合' : '');
      this.steps.build = { phase: 'done', hint, at: Date.now() };
      let report;
      try { report = JSON.parse(await readFile(join(finalDir, 'build.json'), 'utf8')); } catch { /* Optional for older converters. */ }
      opts.onSaveStage?.('commit');
      const previous = {modelDir:this.state.modelDir,builds:this.state.builds,build:this.state.build,scan:this.state.scan,scanStep:this.steps.scan};
      if (report?.model) {
        this.state.scan = {...report.model,unmapped:report.unmapped??[],adaptation:adaptationSummary(report),at:Date.now()};
        this.steps.scan = {phase:'done',hint:`${report.model.title} · ${report.model.params} 参数 / ${report.model.roles} role`,at:Date.now()};
      } else { delete this.state.scan; this.steps.scan = {...IDLE}; }
      if (opts.remember !== false) this.state.modelDir = dir;
      const rec: BuildRecord = {
        id: `${manifest.id || 'pack'}-${Date.now()}`,
        manualAvailable: Boolean(catalog),
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
      const warn = [coverWarning, wardrobeWarning].filter(Boolean).join('。') || undefined;
      return { state: this.snapshot(), buildId: rec.id, log: logs, adaptation, warn };
    } catch (e) {
      this.steps.build = { phase: 'error', hint: errText(e) };
      push(`打包失败 · ${errText(e)}`);
      throw e;
    } finally {
      if (scratch) await rm(scratch, {recursive:true,force:true}).catch(()=>{});
      if (!committed) for (const target of temporary) {
        if (isInsideRoot(join(this.workRoot(), 'builds'), target)) {
          await this.assertRemovableBuild(target).then(() => rm(target, {recursive:true,force:true})).catch(cleanupError => {
            this.say(`未能移除未完成的打包副本 · ${errText(cleanupError)}`);
          });
        }
      }
    }
  }

  private async installWithConfirmation(dir: string, buildId: string | undefined, confirmed: boolean): Promise<unknown> {
    const needsConfirmation = new Error('同 ID 形象需要确认替换');
    try {
      return await this.doInstall(dir, buildId, undefined, replacesOtherPack => {
        if (replacesOtherPack && !confirmed) throw needsConfirmation;
      });
    } catch (error) {
      if (error !== needsConfirmation) throw error;
      this.steps.install = { ...IDLE, hint: needsConfirmation.message };
      return { replacementRequired: true };
    }
  }

  private async doInstall(dir: string, buildId?: string, signal?: AbortSignal, beforeSwap?: (replacesOtherPack:boolean) => void) {
    signal?.throwIfAborted();
    this.requireNotice();
    const chosen = buildId
      ? (this.state.builds ?? []).find((b) => b.id === buildId)
      : this.state.build;
    if (!chosen || !existsSync(chosen.packDir)) throw new Error('先打包，再安装');
    this.steps.install = { phase: 'loading', hint: '安装中…' };
    let resumeVoice: (() => void) | undefined;
    try {
      const warnings: string[] = [];
      const figures = await this.installDirectory();
      resumeVoice = await this.voice.suspend();
      const target = await this.installPrepared(chosen.packDir, figures, {
        signal, beforeSwap, keepPackThemes: chosen.imported, onWarning: message => warnings.push(message),
      });
      const figureId = basename(target);
      this.steps.install = { phase: 'done', hint: target, at: Date.now() };
      this.state.install = { target, at: Date.now(), buildId };
      // 装完就删掉这份打包产物（开关打开时）
      if (this.opts.getConfig().autoDelete) {
        const rec = (this.state.builds ?? []).find((b) => b.packDir === chosen.packDir);
        if (rec) {
          try { await this.removeBuild(rec.id); this.say('已按开关删除打包产物'); }
          catch (e) { warnings.push(`安装已完成，清理打包产物失败：${errText(e)}`); }
        }
      }
      for (const warning of warnings) this.say(`! ${warning}`);
      const saveWarning = await this.saveOutcome('形象已安装，但安装记录保存失败');
      const warn = [...warnings, saveWarning].filter(Boolean).join('。') || undefined;
      this.say(`安装完成 · ${target}`);
      return { figureId, state: this.snapshot(), log: [`安装到 ${target}`], warn };
    } catch (e) {
      this.steps.install = { phase: 'error', hint: errText(e) };
      this.say(`安装失败 · ${errText(e)}`);
      throw e;
    } finally {
      resumeVoice?.();
    }
  }

  private async openManual(method:string,args:unknown[]) {
    this.requireNotice();
    const requestedToken=String(args[method==='manualOpenBuild'?1:2]||'')||undefined;
    if(method==='manualOpenBuild'){
      const rec=this.state.builds?.find(b=>b.id===String(args[0]));
      if(!rec?.manualAvailable)throw Error('请重新导入模型以编辑原生动作');
      const library=JSON.parse(await readFile(join(rec.packDir,LIBRARY),'utf8'));
      return this.manual.open(rec.packDir,library.catalog,library.bindings||[],undefined,rec.id,requestedToken,library.wardrobe||[],this.opts.getConfig().previewSize);
    }
    const token=String(args[0]),dir=String(args[1]);
    const paths=await this.importer.preserveForAutomation(token,join(this.workRoot(),'automation-inputs'),this.retainedImportPaths());
    const source=paths.get(dir),file=this.importer.modelFile(token,dir);
    if(!source||!file)throw Error('这次导入已过期，请重新选择模型');
    const found=await findModels(join(source,file)),model=found.models.find((m:any)=>m.kind==='live2d');
    if(!model)throw Error('没有找到 Live2D 模型');
    const catalog=await inspectNative(model),core=await this.prepareCubismRuntime();
    const scratch=join(this.workRoot(),'manual-input-'+randomUUID());
    try{
      const render={mode:'economy',textureLimit:1024,canvasLimit:1024,strict:false};
      const pack=await buildPack(WORKBENCH_DIR,source,scratch,{corePath:core.file,modelFile:file,render,maxTexture:render.textureLimit,native:nativeConfig(catalog,[],{includeAll:true})});
      const result=await this.manual.open(pack,catalog,[],model,undefined,requestedToken,[],this.opts.getConfig().previewSize);
      this.manual.get(result.token).ownedRoot=scratch;return result;
    }catch(e){await rm(scratch,{recursive:true,force:true});throw e;}
  }

  private async openBrowserManual([method, args, language, theme]: unknown[]) {
    if ((method !== 'manualOpen' && method !== 'manualOpenBuild') || !Array.isArray(args)) throw Error('编辑入口无效');
    if (this.browserEditors.size) throw Error('已有浏览器编辑页，请先保存或关闭当前编辑。');
    const data = await this.openManual(method, args);
    const { token } = data;
    let editor: BrowserEditor | undefined;
    try {
      const session = this.manual.get(token);
      const draftKey = data.buildId ? `build:${data.buildId}` : `source:${data.fingerprint}`;
      const fingerprint = data.buildId ? session.hash : data.fingerprint;
      const previousDraft = this.browserDrafts.get(draftKey);
      editor = await serveBrowserEditor({
        data,
        language: language === 'en' ? 'en' : 'zh',
        theme,
        pack: session.copy,
        workbench: WORKBENCH_DIR,
        draft: previousDraft && previousDraft.fingerprint === fingerprint ? previousDraft.draft : undefined,
        setDraft: draft => {
          this.browserDrafts.delete(draftKey);
          if (draft) this.browserDrafts.set(draftKey, { fingerprint, draft });
          while (this.browserDrafts.size > 16) this.browserDrafts.delete(this.browserDrafts.keys().next().value!);
        },
        keepAlive: () => { this.manual.get(token); },
        save: async (bindings, wardrobe) => {
          const result = await this.exclusive(() => this.saveManual(token, bindings, wardrobe)) as {buildId?: string; warn?: string};
          return { buildId: result.buildId, warn: result.warn };
        },
        skipImages: () => this.invoke('workbench', 'manualSkipImages', [token]),
        progress: () => this.manualSaveProgress(token),
        close: async () => {
          this.browserEditors.delete(token);
          await this.manual.close(token);
        },
      });
      this.browserEditors.set(token, { ...editor, title: data.title, buildId: data.buildId });
      await openEditorInBrowser(editor.url);
      return { token, buildId: data.buildId };
    } catch (error) {
      await (editor?.stop() ?? this.manual.close(token)).catch(() => {});
      this.say(`! 浏览器编辑器打开失败：${errText(error)}`);
      return { fallback: true };
    }
  }

  private async captureWardrobe(pack: string, signal?: AbortSignal, skipImages?: AbortSignal) {
    const shot = await captureOptionalImages(active => captureWardrobeThumbnails(pack, WORKBENCH_DIR, active), signal, skipImages);
    signal?.throwIfAborted();
    return shot.ok ? undefined : `装扮缩略图未生成：${shot.error || '未知原因'}`;
  }

  private manualSaveProgress(token: string) {
    const pending = this.pendingImages;
    return { stage: pending?.kind === 'manual' && pending.token === token ? pending.stage : null };
  }

  private async saveManual(token:string,values:any[],groups?:any[]) {
    const receipt=this.manual.saved(token);if(receipt)return receipt;
    this.requireNotice();
    const session = this.manual.get(token);
    const controller = new AbortController();
    const pending: PendingImages = { kind: 'manual', token, controller, stage: 'check' };
    this.pendingImages = pending;
    session.saving = true;
    try{
    const {bindings}=await this.manual.validate(token,values);
    const previous=await readFile(join(session.pack,LIBRARY),'utf8').then(s=>JSON.parse(s).wardrobe||[]).catch(()=>[]);
    const wardrobe=wardrobeConfig(session.catalog,groups??previous,bindings).groups;
    session.generation++;
    session.renderAbort?.abort();
    await session.renderTask?.catch(()=>{});
    await session.renderer?.close().catch((error: unknown) => this.say(`预览资源释放未完成 · ${errText(error)}`));
    if(session.source){
      const current=await inspectNative(session.source);
      if(current.fingerprint!==session.catalog.fingerprint)throw Error('模型素材已变化，请重新打开编辑');
      const result=await this.doBuild(session.source.dir,{
        remember:false,modelFile:session.source.file,native:nativeConfig(current,bindings),wardrobe,
        fingerprint:current.fingerprint,skipImages:controller.signal,onSaveStage:stage=>{pending.stage=stage;},
      });
      this.manual.complete(token,result);return result;
    }
    const parent=join(this.workRoot(),'builds','manual-'+randomUUID()),target=join(parent,'pack');
    let committed=false;
    try{
      pending.stage='pack';
      await mkdir(parent,{recursive:true});await cp(session.pack,target,{recursive:true});
      await refreshPackRuntime(RUNTIME_DIR, target);
      await setPackAppearance(target);
      await writeNativePack(target,session.catalog,bindings,false,wardrobe);
      await enablePackPerformance(target);
      if (!controller.signal.aborted && wardrobe.some(group=>group.options.length)) pending.stage='images';
      const warn = await this.captureWardrobe(target, undefined, controller.signal);
      await readPackManifest(target);
      if(await packFingerprint(session.pack)!==session.hash)throw Error('形象包已变化，请重新打开编辑');
      const old=this.state.builds?.find(b=>b.id===session.buildId);if(!old)throw Error('原打包产物已移除');
      if (old.packDir !== session.pack) throw Error('形象包已变化，请重新打开编辑');
      const rec={...old,packDir:target,bytes:await dirSize(target),words:parseFigureJson(await readFile(join(target,'figure.json'),'utf8')).vocab.length,at:Date.now()};
      const previous={build:this.state.build,builds:this.state.builds};
      pending.stage='commit';
      this.state.builds=(this.state.builds||[]).map(b=>b.id===old.id?rec:b);this.state.build=rec;
      try{await this.save();}catch(e){Object.assign(this.state,previous);throw e;}
      committed=true;
      const result={state:this.snapshot(),buildId:rec.id,warn};this.manual.complete(token,result);
      if (isInsideRoot(join(this.workRoot(), 'builds'), old.packDir) && !this.state.builds.some(b => b.packDir === old.packDir)) {
        try { await this.assertRemovableBuild(old.packDir); await rm(old.packDir,{recursive:true,force:true}); }
        catch(e) { this.say(`旧打包副本未能移除 · ${errText(e)}`); }
      }
      return result;
    }catch(e){if(!committed)await rm(parent,{recursive:true,force:true}).catch(()=>{});throw e;}
    }finally{
      this.pendingImages = undefined;
      session.saving=false;
      if(this.manual.saved(token)||session.closeRequested)await this.manual.close(token).catch(e=>this.say(`预览资源释放未完成 · ${errText(e)}`));
    }
  }

  private async withImportSubmission(result: StageResult) {
    try {
      const notified = await this.queueAnalysis(result);
      if (notified?.queued && 'count' in notified) this.say(`已交给 Coo 分析 · ${notified.count} 个模型`);
    } catch (error) {
      this.say(`! 导入成功，AI 分析通知未送达：${errText(error)}`);
      return { ...result, submission: { token: result.token, error: errText(error), canRetry: true } };
    }
    return { ...result, submission: this.automation.submissions().find(request => request.token === result.token) };
  }

  private retainedImportPaths(): string[] {
    return [...this.automation.activeSources(), ...this.manual.activeSources()];
  }

  private async queueAnalysis(result: {token:string;models?:Array<{dir:string}>;packs?:Array<{dir:string}>},repeat=false) {
    if(!aiEnabled(this.opts.getConfig())||!result.token)return {queued:false};
    if(!repeat && !result.models?.length)return {queued:false};
    if (!result.models?.length && !result.packs?.length) return { queued: false };
    const paths=await this.importer.preserveForAutomation(result.token,join(this.workRoot(),'automation-inputs'),this.retainedImportPaths());
    return this.automation.imported(result,(_token:string,dir:string)=>{
      const source=paths.get(dir),file=this.importer.modelFile(result.token,dir);
      return source && file ? join(source,file) : source;
    },repeat);
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.stopping || this.busy) throw new Error('上一个动作还没结束，请稍后重试');
    this.busy = true;
    const pending = action(); this.activeAction = pending;
    try { return await pending; }
    finally { this.busy = false; this.activeAction = null; }
  }

  private actionEvidence(model: AutomationModel, native: unknown, samples: Array<{id:string;time:number;word?:string;generic?:boolean}>, signal?: AbortSignal) {
    return this.exclusive(async () => {
      signal?.throwIfAborted();
      const core = await this.prepareCubismRuntime();
      signal?.throwIfAborted();
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

  private executeAutomation(model: AutomationModel, native: NativeConfig, signal?: AbortSignal, fingerprint?: string, beforeSwap?: (replacesOtherPack:boolean) => void, sourceFingerprint?: string) {
    return this.exclusive(async () => {
      this.requireNotice(); signal?.throwIfAborted();
      if (!aiEnabled(this.opts.getConfig())) throw new Error('AI 自动适配已关闭');
      if (model.kind === 'pack') {
        const figures=await this.installDirectory();
        const target = await this.installPrepared(model.dir, figures, { signal, expectedFingerprint: fingerprint, beforeSwap, keepPackThemes: true });
        this.state.install = {target,at:Date.now()};
        const warning = await this.saveOutcome('形象已安装，但安装记录保存失败');
        return {figureId:basename(target),target,installed:true,mappings:[],warning};
      }
      const built = await this.doBuild(model.dir, {native,modelFile:model.file,remember:false,signal,fingerprint,sourceFingerprint});
      signal?.throwIfAborted();
      if (!aiEnabled(this.opts.getConfig())) throw new Error('AI 自动适配已关闭，打包产物保留，尚未安装');
      const record = this.state.builds?.find(item => item.id === built.buildId);
      if (!record) throw new Error('打包未产出可安装模型');
      const manifest = parseFigureJson(await readFile(join(record.packDir,'figure.json'),'utf8'));
      signal?.throwIfAborted();
      const installed = await this.doInstall(model.dir,record.id,signal,beforeSwap);
      const warning = [built.warn, installed.warn].filter(Boolean).join('。');
      return {figureId:manifest.id,target:this.state.install?.target,installed:true,mappings:native.bindings,...(warning ? { warning } : {})};
    });
  }

  /** 打包历史，最新在前。卡片优先显示模型包的封面。 */
  private async listBuilds(): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let dropped = false;
    for (const b of this.state.builds ?? []) {
      if (!existsSync(b.packDir)) { dropped = true; continue; }
      let declaredThumb: unknown;
      let packId = '';
      let nameZh = '';
      let nameEn = '';
      let adaptation;
      let kind: 'live2d' | 'bongocat' | undefined;
      try {
        const report = parseFigureJson(await readFile(join(b.packDir, 'build.json'), 'utf8'));
        kind = report.sourceFormat === 'bongocat' ? 'bongocat'
          : report.tool === 'cortico-live2d-pack' ? 'live2d' : undefined;
        adaptation = adaptationSummary(report);
      }
      catch { /* older or imported packs may not include a build report */ }
      try {
        const m = parseFigureJson(await readFile(join(b.packDir, 'figure.json'), 'utf8'));
        declaredThumb = m.thumb;
        packId = typeof m.id === 'string' ? m.id : '';
        nameZh = typeof m.name?.zh === 'string' ? m.name.zh : '';
        nameEn = typeof m.name?.en === 'string' ? m.name.en : '';
        if (!kind && (m.sourceFormat === 'live2d' || m.sourceFormat === 'bongocat')) kind = m.sourceFormat;
        if (!kind && existsSync(join(b.packDir, 'sdk', CORE_FILE))) kind = 'live2d';
      } catch { /* 读不到就用 id */ }
      out.push({
        id: b.id, packId, nameZh, nameEn, bytes: b.bytes, words: b.words, cover: b.cover, fit: b.fit, at: b.at,
        exists: true, thumb: await workbenchCover(b.packDir, declaredThumb) ?? '', kind,
        adaptation, manualAvailable: b.manualAvailable === true && existsSync(join(b.packDir,LIBRARY)),
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

  private async installDirectory(): Promise<string> {
    const figures = await canonicalPath(await resolveFigures(this.opts.getConfig(), this.opts.dataDir));
    const backups = await canonicalPath(join(dirname(figures), 'figure-backups'));
    for (const path of [join(this.workRoot(), 'builds'), ...(this.state.builds ?? []).map(build => build.packDir)]) {
      const build = await canonicalPath(path);
      if ([figures, backups].some(target => containsPath(build, target) || containsPath(target, build))) {
        throw Error('安装或备份目录不能与打包目录重叠');
      }
    }
    return figures;
  }

  private async installPrepared(source: string, figures: string, opts: Pick<NonNullable<Parameters<typeof installPack>[2]>, 'signal' | 'beforeSwap' | 'expectedFingerprint' | 'onWarning'> & { keepPackThemes?: boolean }) {
    const cfg = this.opts.getConfig();
    const { keepPackThemes, ...installOptions } = opts;
    const themePalettes = keepPackThemes ? undefined : normalizeFigureThemes(cfg.themePalettes);
    let installed = () => {};
    const target = await installPack(source, figures, {
      ...installOptions, backupRoot: join(dirname(figures), 'figure-backups'), keep: 2,
      prepare: async pending => {
        await prepareFigureRuntime(pending, cfg, this.performance.mode() === 'direct', themePalettes);
        const manifest = await readPackManifest(pending);
        const previous = join(figures, manifest.id);
        if (await lstat(previous).then(info => info.isDirectory() && !info.isSymbolicLink()).catch(() => false)) {
          await preserveSavedActions(pending, previous);
        }
        installed = await this.performance.beforeInstall(manifest.id);
      },
    });
    installed();
    return target;
  }

  private async desktopTargets() {
    const dir = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
    const entries = await readdir(dir, {withFileTypes:true}).catch((error:NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const models = await Promise.all(entries.filter(e => e.isDirectory() && FIGURE_ID.test(e.name)).map(async e => {
      const root = join(dir, e.name);
      const build = await readFile(join(root, 'build.json'), 'utf8').then(parseFigureJson).catch(() => null);
      const manifest = await readPackManifest(root).catch(() => null);
      if (build?.tool !== 'cortico-live2d-pack' || manifest?.id !== e.name) return;
      const names = manifest.name as Record<string, string>;
      return { id: e.name, name: names.zh || names.en || Object.values(names)[0] || e.name };
    }));
    return models.flatMap(model => model ? [model] : []).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  private async importDesktopSource(id: string) {
    const status = await this.performance.readiness();
    if (status.state !== 'native-model' || status.figure !== id) throw Error('当前对话桌宠的模型已经切换');
    const file = this.desktopBody?.('desktop-live2d-pet')?.modelFile;
    if (typeof file !== 'string' || !isAbsolute(file)
        || !/\.model3\.json$/i.test(file) || !existsSync(file)) {
      throw Error('原始模型已移动或不可访问，请在工作台重新选择模型文件夹');
    }
    const result = await this.importer.stageLocal([file], await this.installedVersions());
    if ('error' in result) throw Error(result.error);
    if (!result.models.length) throw Error('没有读到原始 Live2D 模型，请在工作台重新选择模型文件夹');
    this.desktopImport = await this.withImportSubmission(result);
    return { token: result.token };
  }

  private async assertRemovableBuild(path: string): Promise<void> {
    const build = await canonicalPath(path);
    const figures = await canonicalPath(await resolveFigures(this.opts.getConfig(), this.opts.dataDir));
    const installed = this.state.install?.target;
    const builds = await canonicalPath(join(this.workRoot(), 'builds'));
    const installedPath = installed && await canonicalPath(installed);
    if (!isInsideRoot(builds, build) || containsPath(build, figures) || containsPath(figures, build)
        || installedPath && (containsPath(build, installedPath) || containsPath(installedPath, build))) {
      throw Error('打包目录与已安装形象重叠，或已不在当前工作目录内');
    }
  }

  private async removeBuild(id: string): Promise<void> {
    const list = this.state.builds ?? [];
    const idx = list.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('没有这份打包产物');
    const rec = list[idx];
    await this.assertRemovableBuild(rec.packDir);
    await rm(rec.packDir, { recursive: true, force: true });
    list.splice(idx, 1);
    this.state.builds = list;
    if (this.state.build?.packDir === rec.packDir) delete this.state.build;
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

  /** 运行组件的缓存目录；清旧打包只删 builds/。 */
  private coreDir(): string {
    return join(this.workRoot(), 'sdk');
  }

  private async previousFrameworkDirs(): Promise<string[]> {
    const known = [...(this.state.builds ?? []).map(record => record.packDir)];
    if (this.state.install?.target) known.unshift(this.state.install.target);
    const figures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir).catch(() => null);
    if (figures) {
      const installed = await readdir(figures, { withFileTypes: true }).catch(() => []);
      for (const entry of installed) if (entry.isDirectory()) known.push(join(figures, entry.name));
    }
    return known.map(pack => join(pack, 'sdk'));
  }

  private async prepareCubismRuntime() {
    const dir = this.coreDir();
    const state = await cubismRuntimeState(dir);
    this.coreReady = state.ok;
    if (state.ok) return state;
    if (!this.state.coreConsentAt) throw new Error('请先在「须知」中同意 Live2D Core / SDK 许可并获取运行组件');
    let pending = this.cubismPreparation.get(dir);
    if (!pending) {
      pending = this.previousFrameworkDirs()
        .then(previous => ensureCubismRuntime(dir, previous, line => this.say(line)))
        .finally(() => this.cubismPreparation.delete(dir));
      this.cubismPreparation.set(dir, pending);
    }
    const prepared = await pending;
    if (dir === this.coreDir()) this.coreReady = true;
    return prepared;
  }

  private noticePayload(): { revision: number; acknowledged: boolean } {
    return { revision: NOTICE_REVISION, acknowledged: this.state.distributionNotice?.revision === NOTICE_REVISION };
  }

  private requireNotice(): void {
    if (!this.noticePayload().acknowledged) throw new Error('请先阅读并确认面板右上角的形象包分发须知');
  }

  /** 面板显示运行组件是否就绪，并复用之前的许可确认。 */
  private async corePayload(): Promise<Record<string, unknown>> {
    const state = await cubismRuntimeState(this.coreDir());
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

  private async saveOutcome(failure: string): Promise<string | undefined> {
    try { await this.save(); }
    catch (error) {
      const warning = `${failure}：${errText(error)}`;
      this.say(`! ${warning}`);
      return warning;
    }
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

function importPayloadSize(encoded: string, limit: number, error: string): number {
  if (encoded.length > 4 * Math.ceil(limit / 3)) throw new Error(error);
  const bytes = Buffer.byteLength(encoded, 'base64');
  if (bytes > limit) throw new Error(error);
  return bytes;
}

function readImportFile(payload: unknown): { path: string; b64: string } {
  const file = payload as Record<string, unknown> | undefined;
  if (!file || typeof file.path !== 'string' || typeof file.b64 !== 'string') throw new Error('上传文件数据无效');
  return {path:file.path, b64:file.b64};
}

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

async function enablePackPerformance(dir: string, immediate = false) {
  if (!existsSync(join(dir, LIBRARY))) return;
  await writePerformanceMove(dir, immediate);
  await writeFile(join(dir, PERFORMANCE_ASSET), '{"version":1,"orders":[]}\n');
}

async function prepareFigureRuntime(dir: string, cfg: Live2dSection, immediate: boolean, themePalettes?: string[]) {
  // Match the current entry and the original Figure entry shipped before 1.4.5.
  const owned = await readFile(join(dir, 'build.json'), 'utf8').then(parseFigureJson).catch(() => null);
  if (owned?.tool !== 'cortico-live2d-pack' || !existsSync(join(dir, 'backends', 'live2d.js'))) return;
  const entry = await readFile(join(dir, 'figure.js')).catch(() => null);
  if (!entry) return;
  const currentEntry = entry.equals(await readFile(join(RUNTIME_DIR, 'figure.js')));
  const legacyEntry = createHash('sha256').update(entry.toString('utf8').replace(/\r\n/g, '\n')).digest('hex')
    === 'db770ce7eedadb0fbdb7044169cdd3c4c84505d2183ddfaddbe4cab73461b109';
  if (!currentEntry && !legacyEntry) return;
  const voice = await readFile(join(dir, 'figure-voice.json'), 'utf8').then(parseFigureJson).catch(() => null);
  const cropConfig = join('backends', 'crop-config.js');
  const installedCrop = await readFile(join(dir, cropConfig)).catch(() => null);
  const voiceBackend = join('backends', 'voice-playback.js');
  const installedVoice = await readFile(join(dir, voiceBackend)).catch(() => null);
  const bodyBackend = join('backends', 'live2d.js');
  const installedBody = await readFile(join(dir, bodyBackend)).catch(() => null);
  const wardrobeBackend = join('backends', 'wardrobe.js');
  const installedWardrobe = await readFile(join(dir, wardrobeBackend)).catch(() => null);
  const formatBackend = join('backends', owned.sourceFormat === 'bongocat' ? 'bongo.js' : 'performance-playback.js');
  const installedFormatBackend = await readFile(join(dir, formatBackend)).catch(() => null);
  if (voice?.version !== 3 || !installedFormatBackend?.equals(await readFile(join(RUNTIME_DIR, formatBackend)))
      || !existsSync(join(dir, 'vendor', 'soullink', 'chunk-OPVA6SRP.js'))
      || !existsSync(join(dir, 'backends', 'body-crop.js'))
      || !existsSync(join(dir, 'backends', 'gaze-config.js'))
      || !installedVoice?.equals(await readFile(join(RUNTIME_DIR, voiceBackend)))
      || !installedCrop?.equals(await readFile(join(RUNTIME_DIR, cropConfig)))
      || !installedBody?.equals(await readFile(join(RUNTIME_DIR, bodyBackend)))
      || !installedWardrobe?.equals(await readFile(join(RUNTIME_DIR, wardrobeBackend)))) {
    await refreshPackRuntime(RUNTIME_DIR, dir);
  }
  await setPackAppearance(dir, includedEffects(cfg), cfg.emotionEffectSize, themePalettes);
  if (owned.sourceFormat === 'bongocat') return;
  if (existsSync(join(dir, LIBRARY))) {
    await enablePackPerformance(dir, immediate);
    return;
  }

  const models = await readdir(join(dir, 'models'), { withFileTypes: true }).catch(() => []);
  const candidates = models.filter(entry => entry.isDirectory() && /^[a-z0-9][a-z0-9-]{0,31}$/.test(entry.name)
    && existsSync(join(dir, 'models', entry.name, 'cdi3.js')));
  if (candidates.length !== 1) return;
  const id = candidates[0].name;
  const profile = await readFile(join(dir, 'models', id, 'profile.js'), 'utf8').catch(() => '');
  if (!profile || /^  bongo:/m.test(profile)) return;
  await writeFile(join(dir, 'build.json'), JSON.stringify({ ...owned, legacyPerformanceModel: id }, null, 2) + '\n');
  await writePerformanceMove(dir, immediate);
  await writeFile(join(dir, PERFORMANCE_ASSET), '{"version":1,"orders":[]}\n');
}

function CONFIG_GROUP(zh: boolean): ConfigGroup {
  return {
    id: 'figure',
    owner: 'world:figure',
    schema: {
      type: 'object',
      title: zh ? '通用配置' : 'General configuration',
      description: zh
        ? '面板里选目录、打包、安装；这里只放高级项。'
        : 'Use the panel for folder, pack and install; this tab keeps advanced options.',
      properties: {
        'worlds.figure.performanceMode': {type:'string',enum:['vocab','direct','dual'],title:zh?'运行时表演':'Runtime performance','x-hot':true},
        'worlds.figure.cover': {
          type: 'boolean',
          title: zh ? '打包时拍封面' : 'Capture a cover when packing',
          description: zh ? '关掉就不启动无头浏览器，也不量尺寸' : 'Off: skip headless render',
          'x-hot': true,
        },
        'worlds.figure.quality': {type:'string',enum:['economy','balanced','high','original'],title:zh?'画质':'Quality',description:zh?'流畅／标准／高清／原图；原图不设软件精度上限，仅受设备能力限制':'Smooth / Standard / HD / Original; Original has no software resolution cap, subject to device limits','x-hot':true},
        'worlds.figure.previewSize': {type:'string',enum:PREVIEW_SIZES.map(String),title:zh?'预览精度':'Preview resolution',description:zh?'动作与装扮预览默认 1024；无上限时按设备能力渲染':'Action and wardrobe previews default to 1024. Unlimited uses device limits.','x-hot':true},
        'worlds.figure.emotionEffects': {type:'string',title:zh?'随包特效':'Included effects',description:zh?'在个性化页勾选随包包含的 Figure 特效。':'Choose the Figure effects to include on the Personalization page.','x-hot':true},
        'worlds.figure.emotionEffectSize': {type:'string',enum:[...EMOTION_EFFECT_SIZES],title:zh?'特效大小':'Effect size',description:zh?'仅用于 Figure 自带的特效。':'Applies to Figure’s own effects.','x-hot':true},
        'worlds.figure.themePalettes': {type:'string',title:zh?'随包主题配色':'Included themes',description:zh?'在个性化页多选。安装后在 Coo 装扮中切换。':'Select in Personalization. Switch in Coo Dress up after installation.','x-hot':true},
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
        'worlds.figure.adaptationMode': {type:'string',enum:['','none','manual','ai'],title:zh?'适配方式':'Adaptation mode',description:zh?'通用配方、人工绑定或 AI 分析':'Generic recipes, manual bindings or AI analysis','x-hot':true},
        'worlds.figure.assistMotions': {type:'boolean',title:zh?'AI 自动适配':'AI action mapping',description:zh?'让 Coo 分析原生动作、生成方案并协助安装':'Let Coo inspect native actions, prepare a proposal and install it','x-hot':true},
        'worlds.figure.assistGear': {type:'string',enum:['auto','text','image'],title:zh?'分析方式':'Analysis mode','x-hot':true},
        'worlds.figure.assistDepth': {type:'string',enum:['quick','standard','deep'],title:zh?'适配深度':'Adaptation depth',description:zh?'仅文本＋图片时生效：基础取样、针对性补查或映射对照复核':'Only active with text + images: basic sampling, targeted inspection or mapping comparison','x-hot':true},
        'worlds.figure.assistAuto': {type:'boolean',title:zh?'自动安装':'Automatic installation',description:zh?'满足安装条件后自动执行；需要确认时暂停':'Install when requirements are met; pause for confirmation when needed','x-hot':true},
        'worlds.figure.assistConfirmFallback': {type:'boolean',title:zh?'降级前确认':'Confirm fallback',description:zh?'需要沿用通用表现时先确认，默认直接继续':'Ask before keeping generic behavior. Off by default.','x-hot':true},
        'worlds.figure.modelRoots': {type:'string',title:zh?'模型搜索目录':'Model search folders',description:zh?'每行一个目录，仅在这些目录和最近使用的模型目录内按名字查找':'One folder per line; name searches stay within these and recent model folders','x-hot':true},
      },
    },
  };
}
