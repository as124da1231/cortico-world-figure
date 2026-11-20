import { randomInt, randomUUID } from 'node:crypto';
import { lstat, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { OutputTap, ToolDef, WorldHost } from 'cortico/core/types.ts';
import type { VoiceStarted } from './voice-system-player.ts';
import { desktopControlFile, desktopEvents, desktopReply, FIGURE_ID, figureChange, type DesktopBody, type DesktopBodyId } from './desktop-body.ts';
import { PlannerServices, plannerFetch, type PlannerConfig } from './planner-services.ts';
import { runOriginalSpeech, speakingDirectives, type MotionInput, type MotionResult, type SpeakingBeat } from './soullink-speech.ts';
import { SoullinkSpeakingMotionPlanner } from './vendor/soullink-speaking-planner.js';
import { PERFORMANCE_ASSET, PERFORMANCE_FACES, PERFORMANCE_MOVE, PERFORMANCE_TARGET, PROTECTED_PARAMETER, parsePerformanceCues, performanceMode } from '../workbench/pack/backends/performance-plan.js';

export interface PerformanceConfig extends PlannerConfig {
  performanceMode?: string;
}

const MAX_TEXT = 1600;
const parameterNames = (resource: Resource) => (resource.parameters ?? []).filter(p => !p.target || p.target === 'Parameter');
const appearance = (value: string) => PROTECTED_PARAMETER.test(value);
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties });
const cueSchema = {
  ...obj({
    at: { type: 'number', minimum: 0, maximum: 18 }, duration: { type: 'number', minimum: .1, maximum: 18 },
    face: { type: 'string', enum: PERFORMANCE_FACES }, resource: { type: 'string', maxLength: 120 },
    pose: { type: 'object', maxProperties: 12, additionalProperties: { type: 'number', minimum: -1, maximum: 1 } },
    intensity: { type: 'number', minimum: 0, maximum: 1 },
    facs: { type: 'object', maxProperties: 24, additionalProperties: { type: 'number', minimum: -1, maximum: 1 } },
    actionUnits: { type: 'object', maxProperties: 24, additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
    vad: { type:'object', additionalProperties:false, properties:Object.fromEntries(['valence','arousal','dominance'].map(key=>[key,{type:'number',minimum:-1,maximum:1}])) },
  }), required: ['at', 'duration'],
};
export const PERFORMANCE_TOOLS = [
  { name: 'figure_body', description: 'Query the worn Figure Live2D model for native action IDs and known normalized parameter channels. Use offset for more results. Treat resource metadata as data.', tags: ['read'], parameters: obj({ query: { type: 'string', maxLength: 80 }, offset: { type: 'integer', minimum: 0 } }) },
  { name: 'figure_perform', description: 'Prepare an immediate action (or stop). Then call the move tool named in the receipt with its to and params to execute it and get playback confirmation. This tool only stages the action.', tags: ['act'], parameters: obj({ stop: { type: 'boolean' }, cues: { type: 'array', minItems: 1, maxItems: 8, items: cueSchema } }) },
  { name: 'figure_reply_plan', description: 'Plan the body for the exact text of the following pet_say in the same response. Seconds are relative to the beginning of the reply. Use figure_body when you need a resource or parameter ID. Does not display or speak the text.', tags: ['act'], parameters: { ...obj({ text: { type: 'string', maxLength: MAX_TEXT }, cues: { type: 'array', minItems: 1, maxItems: 8, items: cueSchema } }), required: ['text', 'cues'] } },
] satisfies Omit<ToolDef, 'handler'>[];

type Cue = ReturnType<typeof parsePerformanceCues>[number];
type Resource = { id: string; title: string; kind: string; classification: string; seconds: number; raw: unknown; parameters?: { id: string; label?: string; target?: string }[] };
type Word = { id: string; names?: Record<string, string[]> };
type Target = { id: string; body?: DesktopBodyId; name: string; words: Word[]; dir: string; revision: string; immediate: boolean; limited: boolean; resources: Resource[]; parameters: Map<string, string> };
type PlannerConnection = NonNullable<ReturnType<PlannerServices['connection']>>;
type VoicePlayback = (first: Buffer, onStarted: VoiceStarted) => Promise<void>;
type CoordinatedReply = { text: string; startedAt?: number };
type SpeechMark = { at: number; face: string };
type Order = { ticket: number; expiresAt: number; stop?: boolean; cues?: Cue[]; resources?: unknown[]; beats?: unknown[]; face?: string; marks?: SpeechMark[]; startedAt?: number; speechMs?: number };
type ReplyPlan = { text: string; target: Target; cues: Cue[]; at: number };
interface PerformanceOptions {
  config(): PerformanceConfig;
  persist?(patch: PlannerConfig): void;
  figures: string;
  desktopBody?(id?: DesktopBodyId): DesktopBody | null | undefined;
  secret?(name: string): string | undefined;
  storeSecret?(name: string, value: string): void;
}
const normalizeText = (text: string) => text.normalize('NFC').replace(/\s+/gu, '');
const speechToolBodies = {pet_say: 'desktop-pet', live2d_pet_say: 'desktop-live2d-pet'} as const;

/** Match Coo's marker boundaries and compare the result to its archived plain text. */
function replyScript(script: string) {
  const tags = /【([^】]*)】|<([^>\n]{0,32})>|＜([^＞\n]{0,32})＞/gu;
  let text = '', end = 0;
  const marks: { index: number; words: string[] }[] = [];
  for (const mark of script.matchAll(tags)) {
    text += script.slice(end, mark.index);
    marks.push({index: normalizeText(text).length, words: (mark[1] ?? mark[2] ?? mark[3]).split(/[,，、\s]+/u).filter(Boolean)});
    end = mark.index + mark[0].length;
  }
  return { text: normalizeText(text + script.slice(end)), marks };
}
const speechDuration = (text: string) => Math.min(16, Math.max(2.4, 1.6 + Array.from(text).length * .14));
const readJson = async (file: string, limit = 12 * 1024 * 1024) => {
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > limit) throw Error('形象数据无效');
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
};

async function replacePerformanceFile(dir: string, name: string, data: string, signal?: AbortSignal) {
  const tmp = join(dir, '.figure-performance-' + randomUUID() + '.tmp');
  try {
    await writeFile(tmp, data, { flag: 'wx' });
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        await rename(tmp, join(dir, name));
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes(code)) throw error;
        await delay(25 * (attempt + 1), undefined, { signal });
      }
    }
  } finally { await rm(tmp, { force: true }).catch(() => {}); }
}

export async function writePerformanceMove(dir: string, immediate: boolean) {
  const manifest = await readJson(join(dir, 'figure.json'));
  const moves: Array<{ id?: string } | null> = Array.isArray(manifest.moves) ? manifest.moves : [];
  const present = moves.some(move => move?.id === PERFORMANCE_MOVE);
  if (present === immediate) return;
  manifest.moves = immediate ? [...moves, PERFORMANCE_TARGET] : moves.filter(move => move?.id !== PERFORMANCE_MOVE);
  await replacePerformanceFile(dir, 'figure.json', JSON.stringify(manifest, null, 2) + '\n');
}

async function displayParameters(dir: string, id: unknown): Promise<{ id: string; label: string }[]> {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) return [];
  try {
    const file = join(dir, 'models', id, 'cdi3.js');
    const info = await lstat(file);
    if (!info.isFile() || info.size > 1024 * 1024) return [];
    const module = (await readFile(file, 'utf8')).match(/^export default (.*);\s*$/u);
    if (!module) return [];
    const parameters: unknown = JSON.parse(module[1]).Parameters;
    return Array.isArray(parameters) ? parameters.slice(0, 2048).flatMap(item =>
      typeof item?.Id === 'string' && /^[\w.-]{1,100}$/u.test(item.Id) && typeof item.Name === 'string'
        ? [{ id: item.Id, label: item.Name.slice(0, 100) }] : []) : [];
  } catch { return []; }
}

export class FigurePerformance {
  private readonly opts: PerformanceOptions;
  readonly planners: PlannerServices;
  private host?: WorldHost;
  private timer?: ReturnType<typeof setTimeout>;
  private cursor = 0;
  private pending: ReplyPlan[] = [];
  private coordinated?: CoordinatedReply;
  private current?: AbortController;
  private currentCursor = 0;
  private writes = Promise.resolve();
  private issued = new Map<string, { target: Target; orders: Order[] }>();
  private lastMode = 'vocab';
  private modeSync = Promise.resolve();
  private readonly replaced = new Map<string, number>();
  private readonly observedFigures = new Map<string, { cursor: number; failed: boolean }>();
  private figureCursor = 0;
  private scripts: { body: DesktopBodyId; script: ReturnType<typeof replyScript>; cursor: number; at: number }[] = [];
  private speechUntil = 0;

  constructor(opts: PerformanceOptions) {
    this.opts = opts;
    this.planners = new PlannerServices(opts);
  }

  mode() { return performanceMode(this.opts.config().performanceMode); }

  async beforeInstall(id: string) {
    const host = this.host;
    if (!host) return () => {};
    const selection = await this.selection('desktop-pet').catch(() => undefined);
    const cursor = host.store.latestCursor();
    return () => { if (selection?.id === id) this.replaced.set(id, cursor); };
  }

  private bodyProblem(selection: Awaited<ReturnType<FigurePerformance['selection']>>) {
    const source = selection.body?.id ?? 'desktop-pet';
    const { id } = selection;
    const cursor = id ? this.replaced.get(id) : undefined;
    const store = this.host?.store;
    const latest = store?.latestCursor() ?? 0;
    if (store && latest > this.figureCursor) {
      for (const event of desktopEvents(store, { fromCursor: this.figureCursor + 1, toCursor: latest }, true)) {
        const change = figureChange(event);
        if (change) this.observedFigures.set(change.body + ':' + change.figure, change);
      }
      this.figureCursor = latest;
    }
    const changed = this.observedFigures.get(source + ':' + id);
    if ((selection.body?.failed && cursor === undefined) || (changed?.failed && changed.cursor > (cursor ?? 0))) return 'render-failed';
    if (id && cursor !== undefined && changed && changed.cursor > cursor) this.replaced.delete(id);
    if (cursor !== undefined && (!changed || changed.cursor <= cursor)) return 'reload';
  }

  async readiness() {
    try {
      const selection = await this.selection();
      if (selection.native) return { state: 'native-model', body: selection.body?.id, figure: selection.id };
      if (!selection.id || selection.id === 'coo' || selection.id === 'whale') {
        return { state: 'choose-figure', body: selection.body?.id, figure: selection.id };
      }
      try {
        const target = await this.target(undefined, selection);
        const problem = this.bodyProblem(selection);
        if (problem) return { state: problem, body: target.body, figure: target.name, figureId: target.id };
        return { state: 'ready', body: target.body, figure: target.name, ...(target.limited ? { limited: true } : {}) };
      } catch {
        return { state: 'check-pack', body: selection.body?.id, figure: selection.id };
      }
    } catch {
      return { state: 'unavailable' };
    }
  }

  instructions() {
    if (this.mode() !== 'direct') return '';
    return [
      'Main model planning (主模型编排) can compose new live action sequences from timed expressions, native clips, and normalized poses on the worn Figure rig.',
      'An older pack may report limited:true. Its generic faces and available rig parameters still work. If asked for a missing native clip, explain that the original model needs to be imported.',
      'When asked to do a supported built-in action such as wink or nod, use the active desktop pet’s built-in action tool directly. For a custom sequence or a question about what this figure can do, call figure_body to check the available controls before answering. Use returned resource and parameter IDs. Creating new rig channels or saving a permanent Live2D motion asset is separate from live performance.',
      'For an action without speech, stage cues with figure_perform, then call the move tool named in its receipt with the returned target and parameters. Complete both calls yourself. Report playback only after the move receipt. If the current body is unsupported, state which figure the user needs to wear or use a suitable built-in action.',
      'For a spoken performance, submit figure_reply_plan and then the current desktop pet speech tool in the same response. Match the plain spoken text exactly and keep the normal Coo emotion tags. If figure_speak is available, call it immediately before the speech tool.',
    ].join(' ');
  }

  tools(): ToolDef[] {
    return this.mode() !== 'direct' ? [] : PERFORMANCE_TOOLS.map(decl => ({
      ...decl, interruptible: true,
      handler: async (args, ctx) => {
        try {
          ctx.signal?.throwIfAborted();
          if (this.mode() !== 'direct') throw Error('当前表演模式未开放直控工具');
          const selection = await this.selection();
          const target = await this.target(undefined, selection);
          const problem = this.bodyProblem(selection);
          if (problem === 'reload') throw Error('当前形象已重装，请在 Coo 装扮里切到另一只，再切回此形象。');
          if (problem === 'render-failed') throw Error('Coo 加载当前形象失败，请在装扮里重新选择或重新安装。');
          if (problem === 'disconnected') throw Error('当前桌宠窗口未连接，请先打开桌宠。');
          if (decl.name === 'figure_body') return JSON.stringify(this.describeTarget(target, args));
          if (decl.name === 'figure_reply_plan') {
            const text = typeof args.text === 'string' ? normalizeText(args.text) : '';
            if (!text || text.length > MAX_TEXT) throw Error('需要一段与 pet_say 对应的台词');
            const cues = this.check(target, args.cues);
            ctx.signal?.throwIfAborted();
            this.pending = [...this.pending.filter(item => Date.now() - item.at < 15000).slice(-7),
              { text, target, cues, at: Date.now() }];
            return '已登记表演计划，等 Coo 交付相同台词。';
          }
          if (!target.immediate) await writePerformanceMove(target.dir, true);
          const stop = args.stop === true;
          if (stop && args.cues !== undefined) throw Error('停止指令不能同时安排动作');
          const cues = stop ? undefined : this.check(target, args.cues);
          const ticket = randomInt(1, 2147483647);
          await this.publish(target, { ticket, expiresAt: Date.now() + 20000, stop, cues, resources: this.clips(target, cues) }, 'direct', ctx.signal);
          return JSON.stringify({ status: 'staged', tool: target.body === 'desktop-live2d-pet' ? 'live2d_pet_move_to' : 'pet_move_to', to: PERFORMANCE_MOVE, params: [ticket] });
        } catch (error) { return { text: error instanceof Error ? error.message : '表演不可用', failed: true }; }
      },
    }));
  }

  outputTap(): OutputTap | undefined {
    if (this.mode() === 'vocab') return undefined;
    return { externalizes: () => false, onEvent: event => {
      if (event.type !== 'response.output_item.done' || event.item?.type !== 'function_call'
          || event.item.status !== 'completed' || !Object.hasOwn(speechToolBodies, event.item.name)
          || event.item.arguments.length > 64 * 1024) return;
      try {
        const value = JSON.parse(event.item.arguments).script;
        if (typeof value !== 'string') return;
        const at = Date.now();
        this.scripts = this.scripts.filter(item => at - item.at < 15000).slice(-31);
        this.scripts.push({body: speechToolBodies[event.item.name as keyof typeof speechToolBodies],
          script: replyScript(value), cursor: this.host?.store.latestCursor() ?? 0, at});
      } catch { /* Invalid tool arguments never supply an animation. */ }
    }, onAbort: () => { this.scripts = []; this.speechUntil = 0; this.cancel(); this.retire(); } };
  }

  async start(host: WorldHost) {
    if (!host.store) return;
    this.host = host;
    this.cursor = host.store.latestCursor();
    this.figureCursor = -1;
    this.observedFigures.clear();
    this.replaced.clear();
    this.lastMode = this.mode();
    this.modeSync = this.syncMoveTargets(this.lastMode);
    await this.modeSync;
    this.schedule();
  }

  syncMode() {
    const mode = this.mode();
    if (this.lastMode !== mode) {
      this.lastMode = mode;
      this.cancel();
      this.retire(true);
      this.modeSync = this.modeSync.then(() => this.syncMoveTargets(mode));
    }
    return this.modeSync;
  }

  async refreshSelection() {
    this.cancel();
    this.retire(true);
    await this.writes.catch(() => {});
  }

  async stop() {
    this.host = undefined;
    clearTimeout(this.timer);
    this.cancel();
    this.retire(true);
    await this.writes.catch(() => {});
  }

  private cancel() {
    this.pending = [];
    this.speechUntil = 0;
    this.scripts = [];
    this.coordinated = undefined;
    this.current?.abort();
    this.current = undefined;
  }

  private retire(all = false) {
    this.writes = this.writes.catch(() => {}).then(async () => {
      for (const [key, { target, orders }] of this.issued) {
        const next = all ? [] : orders.filter(order => !order.startedAt && order.expiresAt > Date.now());
        if (next.length === orders.length) continue;
        await this.writeOrders(target, next).catch(() => {});
        if (next.length) this.issued.set(key, { target, orders: next });
        else this.issued.delete(key);
      }
    });
  }

  private schedule() {
    if (!this.host) return;
    this.timer = setTimeout(() => { void this.tick().catch(() => {}).finally(() => this.schedule()); }, 140);
    this.timer.unref();
  }

  private async syncMoveTargets(mode: string) {
    const entries = await readdir(this.opts.figures, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (mode !== this.mode() || !this.host) return;
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(entry.name)) continue;
      const dir = join(this.opts.figures, entry.name);
      try {
        const marker = await lstat(join(dir, PERFORMANCE_ASSET));
        if (!marker.isFile() || marker.isSymbolicLink()) continue;
        const build = await readJson(join(dir, 'build.json'));
        if (build.tool === 'cortico-live2d-pack') await writePerformanceMove(dir, mode === 'direct');
      } catch { /* A pack may be removed or replaced while scanning installed figures. */ }
    }
  }

  private async selection(requested?: DesktopBodyId) {
    const body = this.opts.desktopBody?.(requested);
    if (!body) throw Error('请在 Figure 模型设置中选择桌宠形象');
    const id = typeof body.figure === 'string' && FIGURE_ID.test(body.figure) ? body.figure : undefined;
    return { body, native: Boolean(body.native), id };
  }

  private async target(requested?: DesktopBodyId, selected?: Awaited<ReturnType<FigurePerformance['selection']>>): Promise<Target> {
    const {body, id, native} = selected ?? await this.selection(requested);
    if (native) throw Error('当前模型由 Live2D 桌宠直接加载。请用 Figure 导入原始素材，再在 Coo 桌宠上穿戴生成的形象。');
    if (!id || id === 'coo' || id === 'whale') throw Error('请在当前接收对话的桌宠上穿戴已安装的 Figure Live2D 形象。内置形象可继续使用 Coo 自带动作。');
    const dir = body?.dir ?? join(this.opts.figures, id);
    const st = await lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error('当前形象目录不受支持');
    const [manifest, build, library, marker] = await Promise.all([
      readJson(join(dir, 'figure.json')), readJson(join(dir, 'build.json')),
      readJson(join(dir, 'native-library.json')).catch(() => null),
      readJson(join(dir, PERFORMANCE_ASSET), 1024 * 1024),
    ]).catch(() => { throw Error('请从 Figure 的模型卡重新安装当前形象以启用编排'); });
    if (manifest.id !== id || build.tool !== 'cortico-live2d-pack' || marker.version !== 1
      || build.sourceFormat === 'bongocat' || (!Array.isArray(library?.catalog?.resources) && !build.legacyPerformanceModel)) throw Error('当前形象未接入 Figure 表演');
    const all: Resource[] = library?.catalog?.resources ?? [];
    const wardrobeIds = new Set((library?.wardrobe ?? []).flatMap((group: {options?: {resource: string}[]}) => (group.options ?? []).map(option => option.resource)));
    const protectedIds = new Set(all.filter(r => r.classification === 'appearance' || wardrobeIds.has(r.id)).flatMap(r => parameterNames(r).map(p => p.id)));
    const parameters = new Map<string, string>();
    const limited = !Array.isArray(library?.catalog?.resources);
    const display = await displayParameters(dir, build.model?.id ?? build.legacyPerformanceModel);
    for (const parameter of display) {
      if (appearance(parameter.id + ' ' + parameter.label)) protectedIds.add(parameter.id);
    }
    const available = [...all.flatMap(parameterNames), ...display];
    const primary = /^Param(?:Angle[XYZ]|BodyAngle[XYZ]|Eye[LR](?:Open|Smile)|EyeBall[XY]|Brow[LR][XY]|Breath|MouthForm)$/;
    for (const parameter of [...available.filter(p => primary.test(p.id)), ...available]) {
      if ((!limited || primary.test(parameter.id)) && !protectedIds.has(parameter.id) && !appearance(parameter.id + ' ' + (parameter.label ?? ''))) {
        parameters.set(parameter.id, parameter.label || parameter.id);
      }
    }
    const resources = all.filter(r => r.raw && ['motion', 'expression'].includes(r.kind) && !['appearance','idle'].includes(r.classification)
      && Number.isFinite(r.seconds) && r.seconds <= 18 && !wardrobeIds.has(r.id)
      && parameterNames(r).some(parameter => parameters.has(parameter.id)));
    const name = manifest.name?.zh || manifest.name?.en || id;
    return { id, body: body?.id, name: typeof name === 'string' ? name.slice(0, 80) : id,
      words: Array.isArray(manifest.vocab) ? manifest.vocab : [], dir, revision: String(library?.catalog?.fingerprint ?? build.sourceHash),
      limited,
      immediate: !!manifest.moves?.some((move: {id: string}) => move.id === PERFORMANCE_MOVE), resources, parameters };
  }

  private describeTarget(target: Target, args: Record<string, unknown>) {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const offset = Number.isSafeInteger(args.offset) && Number(args.offset) >= 0 ? Number(args.offset) : 0;
    const matches = (id: string, title: string) => `${id} ${title}`.toLowerCase().includes(query);
    const resources = target.resources.filter(r => matches(r.id, r.title));
    const parameters = [...target.parameters].filter(([id, title]) => matches(id, title));
    return { figure: target.id, immediate: target.immediate, ...(target.limited ? { limited: true } : {}), next: offset + 24 < Math.max(resources.length, parameters.length) ? offset + 24 : null,
      resources: resources.slice(offset, offset + 24).map(({id,title,kind,seconds}) => ({id,title,kind,seconds})),
      parameters: parameters.slice(offset, offset + 24).map(([id, name]) => ({id,name,min:-1,default:0,max:1})) };
  }

  private check(target: Target, input: unknown) {
    const cues = parsePerformanceCues(input);
    for (const cue of cues) {
      if (cue.resource && !target.resources.some(r => r.id === cue.resource)) throw Error('当前形象没有这项可用原生资源');
      if (cue.pose && Object.keys(cue.pose).some(id => !target.parameters.has(id))) throw Error('姿态引用了当前形象不支持的参数');
    }
    return cues;
  }

  private clips(target: Target, cues?: Cue[]) {
    const used = new Set(cues?.map(cue => cue.resource));
    return target.resources.filter(r => used.has(r.id)).map(({id,kind,seconds,classification,raw}) => ({id,kind,seconds,classification,data:raw}));
  }

  private async publish(target: Target, order: Order, mode: string, signal?: AbortSignal) {
    const write = this.writes.catch(() => {}).then(async () => {
      signal?.throwIfAborted();
      if (this.mode() !== mode) throw Error('表演模式已切换');
      const actual = await this.target(target.body);
      if (actual.id !== target.id || actual.dir !== target.dir || actual.revision !== target.revision) throw Error('穿戴形象已变化');
      const key = (target.body ?? 'desktop-pet') + ':' + target.dir;
      const next = [...(this.issued.get(key)?.orders ?? []).filter(item => item.expiresAt > Date.now()
        && !(item.startedAt && item.startedAt === order.startedAt)), order].slice(-12);
      await this.writeOrders(target, next, signal);
      this.issued.set(key, { target, orders: next });
    });
    this.writes = write;
    return write;
  }

  private async writeOrders({ dir, body }: Target, orders: Order[], signal?: AbortSignal) {
    const marker = await lstat(join(dir, PERFORMANCE_ASSET));
    const directory = await lstat(dir);
    if (!marker.isFile() || marker.isSymbolicLink() || !directory.isDirectory() || directory.isSymbolicLink()) throw Error('当前形象目录已变化');
    const data = JSON.stringify({version:1, orders});
    if (Buffer.byteLength(data) > 1024 * 1024) throw Error('动作数据超出本地传输上限');
    await replacePerformanceFile(dir, desktopControlFile(PERFORMANCE_ASSET, body), data, signal);
  }

  private async tick() {
    const host = this.host;
    if (!host) return;
    const latest = host.store.latestCursor();
    const previous = this.cursor;
    this.cursor = latest;
    await this.syncMode();
    const mode = this.mode();
    if (mode === 'vocab') return;
    if (latest === previous) return;
    const events = desktopEvents(host.store, { fromCursor: previous + 1, toCursor: latest });
    for (const event of events) {
      if (event.cursor > this.currentCursor && (event.type === event.source + '.message' || event.type === event.source + '.speech')) {
        const scripts = this.scripts.filter(item => item.cursor >= event.cursor);
        const at = Date.parse(event.ts);
        const pending = this.pending.filter(item => item.at >= at);
        this.cancel();
        this.scripts = scripts;
        this.pending = pending;
        this.retire();
      }
      if (desktopReply(event)) await this.planReply(event, mode, host).catch(() => {});
    }
  }

  private async planReply(event: Parameters<typeof desktopReply>[0] & {source: DesktopBodyId; text: string}, mode: string, host: WorldHost) {
    const receivedAt = Date.parse(event.ts);
    if (!Number.isFinite(receivedAt) || Date.now() - receivedAt > 2500) return;
    const plain = normalizeText(event.text);
    const coordinated = this.coordinated;
    if (mode === 'dual' && coordinated?.startedAt !== undefined && receivedAt >= coordinated.startedAt - 150
        && receivedAt <= coordinated.startedAt + 2500 && plain === coordinated.text) {
      this.coordinated = undefined;
      return;
    }
    this.pending = this.pending.filter(item => Date.now() - item.at <= 15000);
    const pending = [...this.pending].reverse().find(item => item.target.body === event.source
      && item.at <= receivedAt + 150 && item.text === plain);
    if (pending) this.pending = this.pending.filter(item => item !== pending && !(item.target.body === event.source
      && item.text === plain && item.at <= receivedAt));
    const candidate = this.scripts.findIndex(item => item.body === event.source && item.script.text === plain
      && item.cursor < event.cursor && Math.abs(item.at - receivedAt) <= 15000);
    const script = candidate < 0 ? undefined : this.scripts.splice(candidate, 1)[0]?.script;
    const controller = this.current ??= new AbortController();
    this.currentCursor = event.cursor;
    const target = await this.target(event.source);
    if (this.bodyProblem({body: {id: event.source, figure:target.id}, id:target.id, native:false})) return;
    const speechMs = speechDuration(event.text) * 1000;
    const marks = this.speechMarks(target, script, event.meta?.beats, speechMs);
    const mood = marks[0]?.face;
    const cues = mode === 'direct' && pending?.target.id === target.id && pending.target.revision === target.revision
      ? pending.cues : undefined;
    const startedAt = Math.max(receivedAt, this.speechUntil);
    if (startedAt > Date.now() + 20000) return;
    const duration = Math.max(speechMs, ...(cues ?? []).map(cue => (cue.at + cue.duration) * 1000));
    this.speechUntil = startedAt + duration;
    await this.publish(target, { ticket: randomInt(1, 2147483647), startedAt, expiresAt: startedAt + duration + 300,
      speechMs, marks, cues, resources: this.clips(target, cues) }, mode, controller.signal);
    if (mode !== 'dual' || event.text.length > MAX_TEXT || !target.parameters.size) return;
    const service = this.planners.connection();
    if (!service) return;
    const directives = this.actionContext(host, event.cursor - 1, receivedAt, target.body);
    void runOriginalSpeech({
      ...this.speechOptions(target, event.text, mood, directives, controller.signal, host, service),
      play: async beats => {
        if (!beats.length) return {};
        const now = Date.now();
        if (now >= startedAt + speechMs) return {};
        await this.publishSpeech(target, beats, marks, startedAt, speechMs, controller.signal);
        return { finished: delay(Math.max(0, startedAt + speechMs - now), undefined, {signal:controller.signal}).catch(() => {}) };
      },
    }).catch(() => {});
  }

  // The voice tool calls this only after it verified a paired pet_say. The
  // original session owns the order of TTS preparation, planning and playback.
  voiceCoordinator(text: string, script: string, body?: DesktopBodyId) {
    if (this.mode() !== 'dual' || text.length > MAX_TEXT) return undefined;
    const service = this.planners.connection();
    if (!service) return undefined;
    return (prepared: Promise<Buffer | undefined>, signal: AbortSignal, play: VoicePlayback) =>
      this.coordinateVoice(service, text, script, prepared, signal, play, body);
  }

  private async coordinateVoice(service: PlannerConnection, text: string, script: string, prepared: Promise<Buffer | undefined>, signal: AbortSignal, play: VoicePlayback, body?: DesktopBodyId) {
    const host = this.host;
    const target = await this.target(body).catch(() => undefined);
    if (!host || !target?.parameters.size || signal.aborted || this.mode() !== 'dual') return false;
    this.cancel();
    this.retire();
    const controller = this.current = new AbortController();
    this.currentCursor = host.store.latestCursor();
    const combined = AbortSignal.any([signal, controller.signal]);
    const reply: CoordinatedReply = this.coordinated = { text: normalizeText(text) };
    const parsed = replyScript(script);
    const mood = this.speechMarks(target, parsed, null, 1000)[0]?.face;
    const directives = this.actionContext(host, this.currentCursor, Date.now(), target.body);
    let audio: Buffer | undefined;
    let finished: Promise<void> | undefined;
    try {
      await runOriginalSpeech({
        ...this.speechOptions(target, text, mood, directives, combined, host, service),
        prepare: async () => { audio = await prepared; if (!audio) throw Error('语音合成失败，已保留文字'); },
        play: async beats => {
          if (!audio) throw Error('语音合成失败，已保留文字');
          type Start = { at: number; durationMs?: number };
          let settle!: (start?: Start) => void;
          const started = new Promise<Start | undefined>(resolve => { settle = resolve; });
          finished = play(audio, (at, durationMs) => { reply.startedAt = at; settle({at, durationMs}); }).finally(() => settle());
          const actual = await started;
          if (actual && !combined.aborted) {
            const expectedMs = speechDuration(text) * 1000;
            const speechMs = actual.durationMs && actual.durationMs > 0 ? Math.min(16000, actual.durationMs) : expectedMs;
            const last = beats.at(-1);
            const scale = last && actual.durationMs ? speechMs / 1000 / (last.time + last.duration) : 1;
            const timed = scale === 1 ? beats : beats.map(beat => ({...beat,time:beat.time * scale,duration:beat.duration * scale}));
            const marks = this.speechMarks(target, parsed, null, speechMs);
            this.speechUntil = actual.at + speechMs;
            await this.publishSpeech(target, timed, marks, actual.at, speechMs, combined).catch(() => {});
          }
          return { finished: finished.catch(() => {}) };
        },
      });
      await finished;
      return Boolean(finished);
    } catch {
      if (!finished) return false;
      // Playback owns its lifetime once started, even if the motion engine fails.
      await finished;
      return true;
    } finally {
      if (this.current === controller && reply.startedAt !== undefined) this.retire();
      if (this.coordinated === reply && reply.startedAt === undefined) this.coordinated = undefined;
    }
  }

  private speechMarks(target: Target, script: ReturnType<typeof replyScript> | undefined, beats: unknown, durationMs: number): SpeechMark[] {
    if (script) {
      return script.marks.slice(0, 24).flatMap(mark => {
        const tokens = mark.words.map(word => word.toLowerCase());
        const match = target.words.find(word => PERFORMANCE_FACES.includes(word.id)
          && [word.id, ...Object.values(word.names ?? {}).flat()].some(name => typeof name === 'string' && tokens.includes(name.toLowerCase())));
        return match ? [{ at: Math.min(.98, mark.index / Math.max(1, script.text.length)) * durationMs / 1000, face: match.id }] : [];
      });
    }
    if (!Array.isArray(beats)) return [];
    const length = beats.reduce((sum, beat) => sum + (typeof beat?.text === 'string' ? normalizeText(beat.text).length : 0), 0);
    let offset = 0;
    return beats.slice(0, 24).flatMap(beat => {
      const at = Math.min(.98, offset / Math.max(1, length)) * durationMs / 1000;
      if (typeof beat?.text === 'string') offset += normalizeText(beat.text).length;
      return PERFORMANCE_FACES.includes(beat?.mood?.id) ? [{ at, face: beat.mood.id }] : [];
    });
  }

  private actionContext(host: WorldHost, before: number, at: number, source: DesktopBodyId = 'desktop-pet') {
    if (before <= 0) return undefined;
    const events = host.store.range({fromCursor: Math.max(1, before - 95), toCursor: before, source, limit:96});
    for (const event of [...events].reverse()) {
      if (Number.isFinite(event.cursor) && event.cursor > before) continue;
      if (event.type === source + '.self' && event.meta?.kind === 'say') return undefined;
      if (event.type !== source + '.message' && event.type !== source + '.speech') continue;
      const age = at - Date.parse(event.ts);
      if (age >= 0 && age < 90000) return speakingDirectives(event.meta?.text);
      return undefined;
    }
    return undefined;
  }

  private speechOptions(target: Target, text: string, mood: string | undefined, directives: string | undefined, signal: AbortSignal, host: WorldHost, service: PlannerConnection) {
    return {
      text, emotion: mood, directives, signal, name: target.name, durationSec: speechDuration(text),
      parameters: Object.fromEntries([...target.parameters].filter(([id]) => !['__proto__','constructor','prototype'].includes(id)).map(([id,name]) => [id, { name, min:-1, max:1, default:0 }])),
      plan: (input: MotionInput) => this.requestMotion(input, mood, signal, host, service),
    };
  }

  private async publishSpeech(target: Target, beats: SpeakingBeat[], marks: SpeechMark[], startedAt: number, speechMs: number, signal: AbortSignal) {
    await this.publish(target, { ticket: randomInt(1, 2147483647), expiresAt: startedAt + speechMs + 400,
      startedAt, speechMs, ...(beats.length ? { beats } : {}), marks }, 'dual', signal);
  }

  private async requestMotion(input: MotionInput, mood: string | undefined, cancelled: AbortSignal, host: WorldHost, service: PlannerConnection): Promise<MotionResult> {
    const { model, endpoint, apiKey } = service;
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(5500)]);
    signal.throwIfAborted();
    const planner = SoullinkSpeakingMotionPlanner.create({
      openAI: { apiKey: apiKey || 'local', baseURL: endpoint, model, timeoutMs: 5000,
        fetch: async (url: string, init: RequestInit) => {
          const response = await plannerFetch(service, url, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
          const usage = await response.clone().json().then(result => result.usage, () => undefined);
          if (usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
            const cached = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
            host.reportUsage({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
              cacheHitTokens: cached, cacheMissTokens: Math.max(0, usage.prompt_tokens - cached) }, { model, label: 'Figure 表演编排' });
          }
          return response;
        },
      }, generation: { mode: 'fixed', maxFrameCount: 16, maxPromptParameters: 96, twoStage: true },
    });
    const result = await planner.plan({ ...input, expression: mood ? {...input.expression, emotion:mood} : input.expression ?? null });
    signal.throwIfAborted();
    return result;
  }
}
