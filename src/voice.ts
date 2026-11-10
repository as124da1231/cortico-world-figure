import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { OutputTap, RunPhase, ToolCallContext, ToolDef, WorldHost } from 'cortico/core/types.ts';
import { parseFigureJson } from './pack-manifest.ts';
import { VOICE_PROVIDERS } from './voice-catalog.mjs';
import { audioMime, needsVoiceKey, normalizeVoiceProfile, providerSpec, synthesizeVoice, voiceMissingFields } from './voice-providers.mjs';
import { normalizeVoiceControls, VOICE_CONTROLS } from './voice-settings.mjs';
import { createVoiceStream, speechSentences } from './voice-stream.ts';
import { createSystemVoicePlayer, type SystemVoicePlayer } from './voice-system-player.ts';

type Profile = Record<string, string | number>;
type Controls = typeof VOICE_CONTROLS;
type VoiceService = { id: string; provider: string; name: string; profile: Profile };
export type VoiceConfig = Partial<Controls> & {
  voiceService?: string;
  voiceServices?: VoiceService[];
  /** Existing installations store one profile and key slot per provider. */
  voiceProvider?: string;
  voiceProfiles?: Record<string, Profile>;
};

const DEMO = '你好，我是你的桌宠。今天也一起加油吧。';
const ASSET = 'figure-voice.json';
const BACKEND = 'voice-playback.js';
const CLIP_AGE = 75_000;
const STREAM_AGE = 120_000;
const MAX_STREAM_CLIPS = 24;
const MAX_STREAM_BYTES = 24 * 1048576;
const FIRST_SOUND_MS = 3000;
const PREFETCH_MS = 20_000;
const PAIR_WAIT_MS = 15_000;
const PET_SOURCE = 'desktop-pet';
const clipName = (id: string) => `figure-voice-${id}.audio`;
const isVoiceFile = /^figure-voice-[0-9a-f-]{36}\.(audio|tmp)$/;
const known = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(VOICE_PROVIDERS, id);
type VoiceProtocol = 1 | 2 | 3;
const supportsQueue = (protocol?: VoiceProtocol) => protocol === 2 || protocol === 3;

export const FIGURE_SPEAK: Omit<ToolDef, 'handler'> = {
  name: 'figure_speak',
  description: 'Speak the plain text of a desktop-pet reply. In the same assistant response emit figure_speak first and pet_say immediately after it with the same spoken text, without waiting for a tool receipt or starting another response. If voice is unavailable, the following pet_say still displays the text. Use only once for a reply.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'The same spoken text as the following pet_say, without action marks.' } }, required: ['text'], additionalProperties: false },
  tags: ['speak'],
  interruptible: true,
};
const isRegular = async (path: string, max: number) => {
  const info = await lstat(path).catch(() => null);
  return Boolean(info?.isFile() && !info.isSymbolicLink() && info.size <= max);
};

async function compatiblePack(dir: string, id: string) {
  const root = await lstat(dir).catch(() => null);
  if (!root?.isDirectory() || root.isSymbolicLink()) return false;
  const backends = await lstat(join(dir, 'backends')).catch(() => null);
  if (!backends?.isDirectory() || backends.isSymbolicLink()) return false;
  if (!await isRegular(join(dir, 'backends', BACKEND), 100_000)) return false;
  const files = ['build.json', 'figure.json', ASSET];
  if (!(await Promise.all(files.map(name => isRegular(join(dir, name), 4 * 1048576)))).every(Boolean)) return false;
  try {
    const [build, figure, state] = await Promise.all(files.map(name =>
      readFile(join(dir, name), 'utf8').then(parseFigureJson)));
    if (build.tool === 'cortico-live2d-pack' && figure.id === id && figure.entry === 'figure.js'
        && (state.version === 1 || supportsQueue(state.version))) return state.version as VoiceProtocol;
    return false;
  } catch {
    return false;
  }
}

type VoiceClip = { id: string; playBy: number; expiresAt: number; audition: boolean; sampleOnly?: true; startedAt?: number };
type Active = { dir: string; protocol: VoiceProtocol; clips: VoiceClip[]; signature?: string };
type Job = { controller: AbortController; task: Promise<void>; audition: boolean; syncTarget?: Availability };
type SelectedVoice = { id: string; profile: Profile; key: string };
type Availability = { dir?: string; protocol?: VoiceProtocol; figure?: string; system: boolean; issue: string; reader: string };
type PreparedSpeech = {
  text: string;
  voice: SelectedVoice;
  controller: AbortController;
  audio: Promise<Buffer | undefined>;
};
type SpeechPair = { ready: Promise<boolean>; at: number };
type SayReceipt = { until: number; hasOutput: Promise<boolean> };
type StreamJob = {
  controller: AbortController;
  voice: SelectedVoice;
  target: Promise<Availability | undefined>;
  synth: Promise<void>;
  play: Promise<void>;
  calls: Map<string, { hasOutput: boolean }>;
  count: number;
  bytes: number;
};

export class FigureVoice {
  private readonly options: {
    config: () => VoiceConfig;
    persist: (patch: VoiceConfig) => void;
    figures: string;
    botDir?: string;
    secret?: (name: string) => string;
    storeSecret?: (name: string, value: string) => void;
    systemPlayer?: SystemVoicePlayer | null;
  };
  private host: WorldHost | null = null;
  private cursor = 0;
  private enabled = false;
  private timer?: ReturnType<typeof setTimeout>;
  private tick?: Promise<void>;
  private job?: Job;
  private stream?: StreamJob;
  private coveredSays: SayReceipt[] = [];
  private speechEpoch = 0;
  private readonly systemPlayer: SystemVoicePlayer | null;
  private preparedSpeech = new Map<string, PreparedSpeech>();
  private speechPairs = new Map<string, SpeechPair>();
  private acceptedSpeech = new Set<string>();
  private speechRound?: number;
  private testing?: { controller: AbortController; task: Promise<unknown> };
  private active?: Active;
  private paused = false;
  private pendingWrite: Promise<void> = Promise.resolve();
  private message = '';

  constructor(options: FigureVoice['options']) {
    this.options = options;
    this.systemPlayer = options.systemPlayer === undefined ? createSystemVoicePlayer() : options.systemPlayer;
  }

  private services(cfg = this.options.config()): VoiceService[] {
    if (Array.isArray(cfg.voiceServices)) return cfg.voiceServices;
    const profiles = cfg.voiceProfiles ?? {};
    return Object.keys(VOICE_PROVIDERS)
      .filter(provider => Object.hasOwn(profiles, provider) || cfg.voiceProvider === provider)
      .map(provider => ({ id: provider, provider, name: '', profile: profiles[provider] ?? {} }));
  }

  private selected(cfg: VoiceConfig, services: VoiceService[]) {
    return services.find(service => service.id === (cfg.voiceService ?? cfg.voiceProvider));
  }

  private secretName(service: VoiceService) {
    const { id, provider, profile } = service;
    const origin = provider === 'azure'
      ? `https://${profile.region}.tts.speech.microsoft.com`
      : typeof profile.endpoint === 'string' ? new URL(profile.endpoint).origin : provider;
    // Keep existing credential slots. New services on the same origin can use separate accounts.
    const scope = id === provider ? origin : id + '\0' + origin;
    const suffix = createHash('sha256').update(scope).digest('hex').slice(0, 20).toUpperCase();
    return `FIGURE_TTS_${provider.toUpperCase()}_${suffix}`;
  }

  private key(service: VoiceService) {
    return this.options.secret?.(this.secretName(service)) ?? '';
  }

  private validate(id: string, profile: Profile, key: string) {
    const missing = voiceMissingFields(id, profile);
    if (missing.length) throw new Error('请填写' + missing.join('、'));
    if (needsVoiceKey(id, profile) && !key) throw new Error('请填写 ' + providerSpec(id).name + ' 的 API 密钥');
  }

  private draft(services: VoiceService[], id: unknown, provider: unknown, input: unknown, token: unknown) {
    if (!known(provider)) throw new Error('请选择语音提供商');
    const existing = id === null ? undefined : services.find(service => service.id === id);
    if (id !== null && existing?.provider !== provider) throw new Error('语音服务已变化，请重新打开');
    const profile: Profile = normalizeVoiceProfile(provider, input);
    if (token !== undefined && (typeof token !== 'string' || token.length > 4096 || /\s/.test(token.trim()))) {
      throw new Error('API 密钥格式无效');
    }
    const fresh = typeof token === 'string' ? token.trim() : '';
    if (fresh && !providerSpec(provider).auth) throw new Error('该语音服务无需 API 密钥');
    return { provider, existing, profile, fresh, key: fresh || (existing ? this.key({ ...existing, profile }) : '') };
  }

  private current(): SelectedVoice {
    const cfg = this.options.config();
    const service = this.selected(cfg, this.services(cfg));
    if (!service) throw new Error('请先在「文字转语音」选用一个语音服务');
    const id = service.provider;
    const profile: Profile = normalizeVoiceProfile(id, service.profile);
    const key = this.key({ ...service, profile });
    this.validate(id, profile, key);
    return { id, profile, key };
  }

  private synthesize(voice: SelectedVoice, text: string, signal: AbortSignal) {
    const managed = join(dirname(this.options.figures), 'figure', 'edge-python',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
    const python = voice.id === 'edge' && !process.env.FIGURE_TTS_PYTHON && existsSync(managed) ? managed : undefined;
    return synthesizeVoice(voice.id, voice.profile, voice.key, text, { signal, python });
  }

  async state() {
    const cfg = this.options.config();
    const services = this.services(cfg);
    const selectedId = this.selected(cfg, services)?.id ?? '';
    const cards = services.map(service => {
      const { id, provider, name } = service;
      try {
        const profile: Profile = normalizeVoiceProfile(provider, service.profile);
        const hasKey = Boolean(this.key({ ...service, profile }));
        const ready = voiceMissingFields(provider, profile).length === 0 && (!needsVoiceKey(provider, profile) || hasKey);
        return { id, provider, name, profile, hasKey, ready };
      } catch {
        return { id, provider, name, profile: normalizeVoiceProfile(provider), hasKey: false, ready: false };
      }
    });
    const { dir, protocol, system, issue, reader } = await this.availability();
    return {
      selectedId, services: cards, controls: normalizeVoiceControls(cfg),
      bodyReady: this.syncTiming() ? protocol === 3 : supportsQueue(protocol), playbackReady: Boolean(dir || system), issue, reader,
      timingReady: this.systemPlayer?.canReportStart === true,
      syncToolReady: Boolean(this.syncTool()),
      message: this.message, speaking: Boolean(this.job),
    };
  }

  async save(args: unknown[]) {
    const cfg = this.options.config();
    const services = this.services(cfg);
    const [id, providerId, name, input, token, use, nonce] = args;
    const creationId = id === null && typeof nonce === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(nonce) ? nonce : undefined;
    const targetId = creationId && services.some(service => service.id === creationId) ? creationId : id;
    const { provider, existing, profile, fresh, key } = this.draft(services, targetId, providerId, input, token);
    if (typeof name !== 'string' || name.trim().length > 80 || /[\u0000-\u001f]/.test(name.trim())) throw new Error('语音服务名称无效');
    if (!existing && services.length >= 64) throw new Error('语音服务已达到 64 项');
    const selected = this.selected(cfg, services);
    const select = use === true;
    if (select || existing && selected?.id === existing.id) this.validate(provider, profile, key);
    const service = { id: existing?.id ?? creationId ?? randomUUID(), provider, name: name.trim(), profile };
    if (fresh) {
      if (!this.options.storeSecret) throw new Error('当前宿主未提供密钥存储');
      this.options.storeSecret(this.secretName(service), fresh);
    }
    const updated = existing ? services.map(item => item.id === existing.id ? service : item) : [...services, service];
    this.options.persist({ voiceServices: updated, voiceService: select ? service.id : selected?.id ?? '' });
    if (select || (existing && existing.id === selected?.id)) await this.hush();
    this.message = '';
    return this.state();
  }

  async remove(id: unknown) {
    const cfg = this.options.config();
    const services = this.services(cfg);
    const remaining = services.filter(service => service.id !== id);
    if (remaining.length === services.length) return this.state();
    const selected = this.selected(cfg, services);
    const active = selected?.id === id;
    this.options.persist({ voiceServices: remaining, voiceService: active ? '' : selected?.id ?? '',
      ...(active ? { voiceEnabled: false } : {}) });
    if (active) {
      this.enabled = false;
      await this.hush();
    }
    this.message = '';
    return this.state();
  }

  async controls(patch: unknown) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('语音控制参数无效');
    const items = patch as Partial<Controls>;
    for (const [key, value] of Object.entries(items)) {
      if (!Object.hasOwn(VOICE_CONTROLS, key) || typeof value !== typeof VOICE_CONTROLS[key as keyof Controls]
          || typeof value === 'number' && !Number.isFinite(value)) throw new Error('语音控制参数无效');
    }
    if (items.voiceTiming !== undefined && items.voiceTiming !== 'fast' && items.voiceTiming !== 'sync') {
      throw new Error('语音时序选项无效');
    }
    const timingChanged = items.voiceTiming !== undefined
      && items.voiceTiming !== normalizeVoiceControls(this.options.config()).voiceTiming;
    if (items.voiceEnabled === true) {
      const { reader } = await this.availability();
      if (reader) throw new Error(`请先关闭 ${reader} 的桌宠回复朗读`);
      this.current();
      if (!this.enabled) this.cursor = this.host?.store.latestCursor() ?? 0;
      this.enabled = true;
    }
    this.options.persist(normalizeVoiceControls({ ...this.options.config(), ...items }));
    if (items.voiceEnabled === false || timingChanged || (items.voiceVolume === 0 && this.syncTiming())) {
      if (items.voiceEnabled === false) this.enabled = false;
      await this.hush();
    } else {
      await this.publish(this.active);
    }
    return this.state();
  }

  async test(args: unknown[]) {
    if (this.testing) throw new Error('语音试听正在合成');
    const { provider, profile, key } = this.draft(this.services(), args[0], args[1], args[2], args[3]);
    const controller = new AbortController();
    const task = this.synthesize({ id: provider, profile, key }, DEMO, controller.signal).then(audio => ({
      $binary: { mime: audioMime(audio), base64: audio.toString('base64') },
    }));
    this.testing = { controller, task };
    try { return await task; }
    finally { this.testing = undefined; }
  }

  async audition() {
    const voice = this.current();
    const target = await this.availability();
    if ((!target.dir && !target.system) || this.paused) throw new Error(target.issue || '形象正在安装，请稍后再试');
    await this.hush();
    await this.play(target, DEMO, voice, true);
    return { ok: true };
  }

  async stopAudition() {
    if (this.job?.audition) {
      this.job.controller.abort();
      this.systemPlayer?.interrupt();
    }
    await this.publish(this.active, clips => clips.filter(clip => !clip.audition));
    return { ok: true };
  }

  private async availability(): Promise<Availability> {
    if (!this.options.botDir) return { system: false, issue: '当前宿主无法连接桌宠', reader: '' };
    const empty = { system: false, issue: '请切换到已安装且支持口型的 Figure 形象', reader: '' };
    try {
      const config = parseFigureJson(await readFile(join(this.options.botDir, 'config.json'), 'utf8'));
      const pet = config.worlds?.[PET_SOURCE];
      const stream = config.worlds?.streamvoice;
      const reader = pet?.speech?.enabled === true ? 'Coo'
        : stream?.enabled === true && (stream.readSay !== false || stream.readAsk === true) ? '流式语音播报' : '';
      const system = Boolean(this.systemPlayer && pet?.enabled !== false);
      const id = pet?.skin?.figure;
      if (pet?.enabled === false || typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
        return { ...empty, system, reader };
      }
      const dir = join(this.options.figures, id);
      const protocol = await compatiblePack(dir, id);
      return protocol ? { dir, protocol, figure: id, system, issue: '', reader } : { ...empty, figure: id, system, reader };
    } catch {
      return { ...empty, issue: '暂时无法读取当前桌宠形象' };
    }
  }

  async start(host: WorldHost) {
    if (!this.options.botDir || !host.store) return;
    this.host = host;
    this.cursor = host.store.latestCursor();
    this.enabled = this.options.config().voiceEnabled === true;
    const root = this.options.figures;
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(entry.name)) continue;
      const dir = join(root, entry.name);
      const protocol = await compatiblePack(dir, entry.name);
      if (!protocol) continue;
      const files = await readdir(dir).catch(() => []);
      await Promise.all(files.filter(name => isVoiceFile.test(name)).map(name => rm(join(dir, name), { force: true }).catch(() => {})));
      // A previous process may have exited during playback or gain adjustment.
      await this.clear({ dir, protocol, clips: [] }, true).catch(() => {});
    }
    this.schedule();
  }

  async stop() {
    this.host = null;
    this.speechPairs.clear();
    clearTimeout(this.timer);
    this.testing?.controller.abort();
    const hush = this.hush(true).catch(() => {});
    await this.tick;
    await hush;
    await this.testing?.task.catch(() => {});
    await this.systemPlayer?.stop();
    this.active = undefined;
    this.enabled = false;
  }

  /** Clear the transient audio before the installer can back up an existing pack. */
  async suspend() {
    this.paused = true;
    try { await this.hush(true); }
    catch (error) { this.paused = false; throw error; }
    return () => { this.paused = false; };
  }

  private syncTiming() {
    return this.systemPlayer?.canReportStart === true
      && normalizeVoiceControls(this.options.config()).voiceTiming === 'sync';
  }

  syncTool(): ToolDef | undefined {
    const cfg = normalizeVoiceControls(this.options.config());
    if (!this.host || !this.syncTiming() || !cfg.voiceEnabled || cfg.voiceVolume <= 0) return undefined;
    try { this.current(); } catch { return undefined; }
    return { ...FIGURE_SPEAK, handler: (args, context) => this.speakSynchronized(args.text, context) };
  }

  private prepareSpeech(id: string, text: string) {
    if (this.paused || !this.syncTool() || this.preparedSpeech.has(id)) return;
    for (const [key, entry] of this.preparedSpeech) if (entry.controller.signal.aborted) this.preparedSpeech.delete(key);
    if (this.preparedSpeech.size >= 2) return;
    let voice;
    try { voice = this.current(); } catch { return; }
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PREFETCH_MS)]);
    const audio = this.availability().then(target => {
      if (signal.aborted || target.reader || !target.system || this.paused || !this.syncTiming()) return undefined;
      return this.synthesize(voice, text, signal);
    }).catch(() => undefined);
    this.preparedSpeech.set(id, { text, voice, controller, audio });
    signal.addEventListener('abort', () => {
      if (this.preparedSpeech.get(id)?.controller === controller) this.preparedSpeech.delete(id);
    }, { once: true });
  }

  private async speakSynchronized(text: unknown, context: ToolCallContext): Promise<string> {
    const fallback = '语音未开始，继续用同次回复里的 pet_say 显示文字。';
    if (this.paused || !this.syncTool() || context.signal?.aborted || this.job?.audition || typeof text !== 'string') return fallback;
    const sentences = speechSentences(text).slice(0, MAX_STREAM_CLIPS);
    if (!sentences.length) return fallback;
    const pair = context.callId ? this.speechPairs.get(context.callId) : undefined;
    if (context.callId) this.speechPairs.delete(context.callId);
    if (!pair || Date.now() - pair.at > PREFETCH_MS) return fallback;
    const voice = this.current();
    if (context.round !== undefined && context.round !== this.speechRound) {
      this.speechRound = context.round;
      this.acceptedSpeech.clear();
    }
    const key = context.round === undefined ? context.callId : sentences.join('\n');
    if (key && this.acceptedSpeech.has(key)) return '这段已提交，继续显示气泡。';
    if (key) {
      if (this.acceptedSpeech.size >= MAX_STREAM_CLIPS) this.acceptedSpeech.clear();
      this.acceptedSpeech.add(key);
    }
    const prepared = context.callId ? this.preparedSpeech.get(context.callId) : undefined;
    if (context.callId) this.preparedSpeech.delete(context.callId);
    const usePrepared = prepared?.text === sentences[0] && prepared.voice.id === voice.id
      && prepared.voice.key === voice.key && JSON.stringify(prepared.voice.profile) === JSON.stringify(voice.profile);
    if (!usePrepared) prepared?.controller.abort();
    const stopPrevious = this.hush();
    this.message = '';
    const controller = new AbortController();
    const signal = context.signal ? AbortSignal.any([controller.signal, context.signal]) : controller.signal;
    let resolveStarted!: (value: boolean) => void;
    const started = new Promise<boolean>(resolve => { resolveStarted = resolve; });
    const cancel = () => {
      prepared?.controller.abort();
      resolveStarted(false);
    };
    let timer = setTimeout(() => controller.abort(), PAIR_WAIT_MS);
    signal.addEventListener('abort', cancel, { once: true });
    const job: Job = { controller, task: Promise.resolve(), audition: false };
    job.task = (async () => {
      await stopPrevious;
      signal.throwIfAborted();
      if (!await Promise.race([pair.ready, started])) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (signal.aborted) return;
        this.message = '首声等待超时，已继续显示文字';
        controller.abort();
      }, FIRST_SOUND_MS);
      const target = await this.availability();
      if (!target.system || target.reader || this.paused || !this.syncTiming()) return;
      job.syncTarget = target;
      const active = await this.setTarget(target.dir, target.protocol);
      let next = this.prepareSegment(sentences[0], voice, signal, usePrepared ? prepared?.audio : undefined);
      let bytes = 0;
      for (let index = 0; index < sentences.length; index++) {
        const audio = await next;
        if (!audio) throw Error('语音合成失败，已保留文字');
        signal.throwIfAborted();
        bytes += audio.length;
        if (bytes > MAX_STREAM_BYTES) throw Error('本轮语音已达到大小限制');
        const current = await this.availability();
        if (!this.host || this.paused || current.reader || !current.system || !this.syncTiming()
          || this.options.config().voiceEnabled !== true || current.figure !== target.figure
          || current.protocol !== target.protocol || this.active !== active) return;
        signal.throwIfAborted();
        if (index + 1 < sentences.length) next = this.prepareSegment(sentences[index + 1], voice, signal);
        await this.playSynchronizedAudio(active, audio, signal, () => {
          if (!signal.aborted) { clearTimeout(timer); resolveStarted(true); }
        });
      }
    })().catch(error => {
      if (!signal.aborted) this.message = error instanceof Error ? error.message : '同步语音失败，已保留文字';
    }).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      controller.abort();
      cancel();
      if (this.job === job) this.job = undefined;
    });
    this.job = job;
    return await started ? '语音已开始，继续显示同次回复里的 pet_say。' : fallback;
  }

  private async prepareSegment(text: string, voice: SelectedVoice, signal: AbortSignal, prefetched?: PreparedSpeech['audio']) {
    try {
      const audio = await prefetched;
      signal.throwIfAborted();
      return audio ?? await this.synthesize(voice, text, signal);
    } catch {
      return undefined;
    }
  }

  private async playSynchronizedAudio(active: Active | undefined, audio: Buffer, signal: AbortSignal, onStarted: () => void) {
    const player = this.systemPlayer;
    if (!player?.canReportStart) throw Error('当前设备无法确认语音起点');
    const controls = normalizeVoiceControls(this.options.config());
    let clip: VoiceClip | undefined;
    let receipt: Promise<void> | undefined;
    if (active?.protocol === 3 && controls.voiceLipSync) {
      const now = Date.now();
      const sample: VoiceClip = { id: randomUUID(), playBy: now + FIRST_SOUND_MS, expiresAt: now + CLIP_AGE,
        audition: false, sampleOnly: true };
      try {
        await this.stageClip(active, sample, audio, signal, false);
        clip = sample;
      } catch {
        // The system player still supplies voice if the current pack cannot receive lip samples.
      }
    }
    try {
      await player.play(audio, controls.voiceVolume, signal, startedAt => {
        if (signal.aborted) return;
        if (clip) {
          const id = clip.id;
          receipt = this.publish(active, clips => clips.map(item => item.id === id ? { ...item, startedAt } : item), signal)
            .catch(() => {});
        }
        onStarted();
      });
    } finally {
      await receipt;
      if (clip) {
        const id = clip.id;
        await this.publish(active, clips => clips.filter(item => item.id !== id)).catch(() => {});
      }
    }
  }

  outputTap(): OutputTap | undefined {
    if (!this.host || this.paused || this.options.config().voiceEnabled !== true) return undefined;
    if (this.syncTiming()) {
      if (!this.syncTool()) return undefined;
      return this.synchronizedTap();
    }
    return createVoiceStream({
      chunk: (text, kind, callId) => this.enqueue(text, kind === 'say' ? callId : undefined),
      finish: (kind, callId) => {
        const stream = this.stream;
        const call = kind === 'say' && stream?.calls.get(callId);
        if (!stream || !call) return;
        stream.calls.delete(callId);
        this.coveredSays.push({ until: Date.now() + 20000, hasOutput: stream.play.then(() => call.hasOutput) });
      },
      interrupt: () => { void this.hush().catch(() => {}); },
    });
  }

  private synchronizedTap(): OutputTap {
    const normalized = (raw: string, field: string) => {
      if (raw.length > 64 * 1024) return '';
      try {
        const value: unknown = JSON.parse(raw)?.[field];
        return typeof value === 'string' ? speechSentences(value).join('').replace(/\s+/gu, '') : '';
      } catch { return ''; }
    };
    let pending: { id: string; text: string; settle: (matched: boolean) => void } | undefined;
    const closePair = (match = '') => {
      if (!pending) return;
      const matched = Boolean(match) && match === pending.text;
      pending.settle(matched);
      if (!matched) {
        this.preparedSpeech.get(pending.id)?.controller.abort();
        this.preparedSpeech.delete(pending.id);
      }
      pending = undefined;
    };
    const tap = createVoiceStream({
      synchronized: true,
      chunk: (text, _kind, callId) => this.prepareSpeech(callId, text),
      finish: () => {},
      interrupt: () => { closePair(); void this.hush().catch(() => {}); },
    });
    return {
      ...tap,
      onEvent: event => {
        if (event.type === 'response.created') closePair();
        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
          const item = event.item;
          closePair(item.name === 'pet_say' ? normalized(item.arguments, 'script') : '');
          if (item.name === 'figure_speak' && item.call_id) {
            const at = Date.now();
            for (const [id, pair] of this.speechPairs) if (at - pair.at > PREFETCH_MS) this.speechPairs.delete(id);
            if (this.speechPairs.size >= MAX_STREAM_CLIPS) this.speechPairs.delete(this.speechPairs.keys().next().value!);
            let settle!: (matched: boolean) => void;
            const ready = new Promise<boolean>(resolve => { settle = resolve; });
            this.speechPairs.set(item.call_id, { ready, at });
            pending = { id: item.call_id, text: normalized(item.arguments, 'text'), settle };
          }
        }
        tap.onEvent(event);
      },
      onRoundEnd: () => { closePair(); tap.onRoundEnd?.(); },
    };
  }

  onRunPhase(phase: RunPhase) {
    if (this.options.config().voiceEnabled !== true) return;
    if (phase.state === 'delivering' && phase.round === undefined && !this.job?.audition) {
      void this.hush().catch(() => {});
    }
    if (phase.state === 'model' && !this.paused && (this.syncTiming() || !supportsQueue(this.active?.protocol))) this.systemPlayer?.warm();
  }

  private async hush(reset = false) {
    const stream = this.stream;
    const job = this.job;
    this.speechEpoch++;
    this.stream = undefined;
    this.coveredSays = [];
    for (const speech of this.preparedSpeech.values()) speech.controller.abort();
    this.preparedSpeech.clear();
    if (this.host) this.cursor = this.host.store.latestCursor();
    stream?.controller.abort();
    job?.controller.abort();
    this.systemPlayer?.interrupt();
    try { await this.clear(this.active, reset); }
    finally { await Promise.allSettled([stream?.play, stream?.synth, job?.task]); }
  }

  private enqueue(text: string, callId?: string, receipt?: SayReceipt) {
    if (!this.host || this.paused || this.job?.audition || this.syncTiming() || this.options.config().voiceEnabled !== true) return;
    let stream = this.stream;
    if (!stream) {
      let voice;
      try { voice = this.current(); }
      catch (error) {
        this.message = error instanceof Error ? error.message : '语音配置无效';
        return;
      }
      const controller = new AbortController();
      const previous = this.job;
      previous?.controller.abort();
      if (previous) this.systemPlayer?.interrupt();
      const target = (async () => {
        await previous?.task.catch(() => {});
        controller.signal.throwIfAborted();
        const destination = await this.availability();
        controller.signal.throwIfAborted();
        if (destination.reader || !(supportsQueue(destination.protocol) || destination.system)) return undefined;
        const active = await this.setTarget(destination.dir, destination.protocol);
        controller.signal.throwIfAborted();
        await this.clear(active);
        return destination;
      })().catch(() => undefined);
      stream = this.stream = { controller, voice, target, synth: Promise.resolve(), play: Promise.resolve(), calls: new Map(), count: 0, bytes: 0 };
      this.message = '';
    }
    if (stream.count >= MAX_STREAM_CLIPS) return;
    let call = callId ? stream.calls.get(callId) : undefined;
    if (callId && !call) stream.calls.set(callId, call = { hasOutput: false });
    if (!receipt) stream.count++;
    const batch = stream;
    const signal = batch.controller.signal;
    const synthesis = batch.synth.then(async () => {
      signal.throwIfAborted();
      if (receipt) {
        // The receipt only waits on playback queued before this fallback. Keep
        // that wait off the poll loop, especially for the system audio player.
        if (await receipt.hasOutput || batch.count >= MAX_STREAM_CLIPS) return;
        signal.throwIfAborted();
        batch.count++;
      }
      const target = await batch.target;
      if (!target) return;
      const audio = await this.synthesize(batch.voice, text, signal);
      if (batch.bytes + audio.length > MAX_STREAM_BYTES) throw Error('本轮语音已达到大小限制');
      batch.bytes += audio.length;
      return { target, audio };
    }).catch(error => {
      if (!signal.aborted) this.message = error instanceof Error ? error.message : '语音合成失败';
    });
    batch.synth = synthesis.then(() => {});
    batch.play = batch.play.then(async () => {
      const result = await synthesis;
      if (!result) return;
      signal.throwIfAborted();
      const current = await this.availability();
      signal.throwIfAborted();
      if (this.stream !== batch || !this.host || this.paused || current.reader || this.options.config().voiceEnabled !== true) return;
      if (supportsQueue(result.target.protocol) && (current.dir !== result.target.dir || current.protocol !== result.target.protocol)) return;
      await this.output(result.target, result.audio, false, signal, true);
      if (call) call.hasOutput = true;
    }).catch(error => {
      if (!signal.aborted) this.message = error instanceof Error ? error.message : '语音播放失败';
    });
  }

  private schedule() {
    if (!this.host) return;
    this.timer = setTimeout(() => {
      this.tick = this.poll().catch(() => {}).finally(() => this.schedule());
    }, 650);
    this.timer.unref?.();
  }

  private async poll() {
    const host = this.host;
    if (!host) return;
    const epoch = this.speechEpoch;
    const on = this.options.config().voiceEnabled === true;
    const latest = host.store.latestCursor();
    const previous = this.cursor;
    this.cursor = latest;
    const fresh = this.enabled && on && !this.paused && latest > previous;
    this.enabled = on;
    const needsGain = normalizeVoiceControls(this.options.config()).voiceMouthGain !== 1;
    if (!fresh && !needsGain && !this.active && !this.job && !this.stream) return;
    const target = await this.availability();
    const { dir, protocol, reader, system } = target;
    if (!this.host || this.paused) return;
    if ((!on || reader) && this.stream) await this.hush();
    const syncTarget = this.job?.syncTarget;
    if (syncTarget && (target.figure !== syncTarget.figure || protocol !== syncTarget.protocol || !system)) this.job?.controller.abort();
    if (this.active?.dir !== dir || this.active?.protocol !== protocol) {
      if (this.active || !this.syncTiming() || this.job?.audition) this.job?.controller.abort();
      await this.setTarget(dir, protocol);
    }
    if (reader && !this.job?.audition) this.job?.controller.abort();
    if (!on && !this.job?.audition) this.job?.controller.abort();
    // An audition may play while automatic narration is disabled.
    const active = this.active;
    await this.publish(active, clips =>
      clips.filter(clip => clip.expiresAt > Date.now() && (clip.audition || on && !reader)));
    if (!needsGain && !this.job && !this.stream && !active?.clips.length && this.active === active) this.active = undefined;
    if (this.syncTiming() || !fresh || !(dir || system) || reader || this.job?.audition || epoch !== this.speechEpoch) return;
    const events = host.store.range({ fromCursor: previous + 1, toCursor: latest, source: PET_SOURCE, limit: 32 });
    this.coveredSays = this.coveredSays.filter(covered => covered.until > Date.now());
    const replies: { text: string; receipt?: SayReceipt }[] = [];
    let latestUnstreamed = -1;
    for (const event of events) {
      if (event.type !== 'desktop-pet.self' || event.meta?.kind !== 'say') continue;
      const receipt = this.coveredSays.shift();
      const text = typeof event.text === 'string' ? event.text.trim().slice(0, 800) : '';
      if (!text) continue;
      if (!receipt) latestUnstreamed = replies.length;
      replies.push({ text, receipt });
    }
    if (!replies.length) return;
    const batch = this.stream;
    const streamTarget = await batch?.target;
    if (epoch !== this.speechEpoch) return;
    if (streamTarget && batch === this.stream) {
      for (const [index, { text, receipt }] of replies.entries()) {
        if (receipt || index === latestUnstreamed) this.enqueue(text, undefined, receipt);
      }
      return;
    }
    try { void this.play(target, replies.at(-1)!.text, this.current(), false).catch(() => {}); }
    catch (error) { this.message = error instanceof Error ? error.message : '语音配置无效'; }
  }

  private async play(target: Availability, text: string, voice: SelectedVoice, audition: boolean) {
    const previous = this.job;
    previous?.controller.abort();
    if (previous) this.systemPlayer?.interrupt();
    const controller = new AbortController();
    this.message = '';
    const task = (async () => {
      const signal = controller.signal;
      await previous?.task.catch(() => {});
      signal.throwIfAborted();
      const active = await this.setTarget(target.dir, target.protocol);
      await this.clear(active);
      const audio = await this.synthesize(voice, text, signal);
      signal.throwIfAborted();
      const current = await this.availability();
      if (!this.host || this.paused || this.active !== active || current.dir !== target.dir
          || !audition && (current.reader || this.options.config().voiceEnabled !== true)) {
        throw new Error('桌宠或朗读设置已变化');
      }
      await this.output(target, audio, audition, signal);
    })();
    const job = { controller, task, audition };
    this.job = job;
    try { await task; }
    catch (error) {
      if (!controller.signal.aborted) this.message = error instanceof Error ? error.message : '语音合成失败';
      throw new Error(this.message || '语音已停止');
    } finally { if (this.job === job) this.job = undefined; }
  }

  private async output(target: Availability, audio: Buffer, audition: boolean, signal: AbortSignal, streaming = false) {
    if (!target.dir || streaming && !supportsQueue(target.protocol)) {
      if (!target.system || !this.systemPlayer) throw Error('当前桌宠无法播放这段语音');
      const volume = normalizeVoiceControls(this.options.config()).voiceVolume;
      await this.systemPlayer.play(audio, volume, signal);
      return;
    }
    const active = this.active;
    if (!active || active.dir !== target.dir || active.protocol !== target.protocol) throw Error('当前形象已变化');
    const now = Date.now(), expiresAt = now + (streaming ? STREAM_AGE : CLIP_AGE);
    const clip = { id: randomUUID(), playBy: streaming ? expiresAt : now + 8000, expiresAt, audition };
    await this.stageClip(active, clip, audio, signal, streaming);
  }

  private async stageClip(active: Active, clip: VoiceClip, audio: Buffer, signal: AbortSignal, append: boolean) {
    const file = join(active.dir, clipName(clip.id));
    try {
      await writeFile(file, audio, { flag: 'wx' });
      signal.throwIfAborted();
      if (this.active !== active) throw Error('当前形象已变化');
      await this.publish(active, clips => append ? [...clips, clip] : [clip], signal);
    } catch (error) {
      await rm(file, { force: true }).catch(() => {});
      throw error;
    }
  }

  private async setTarget(dir?: string, protocol?: VoiceProtocol) {
    if (this.active?.dir === dir && this.active?.protocol === protocol) return this.active;
    const previous = this.active;
    const next: Active | undefined = dir && protocol ? { dir, protocol, clips: [] } : undefined;
    this.active = next;
    await this.clear(previous, true);
    return next;
  }

  private clear(active?: Active, reset = false) {
    return this.publish(active, () => [], undefined, reset);
  }

  private publish(active: Active | undefined, update = (clips: VoiceClip[]) => clips, signal?: AbortSignal, reset = false) {
    if (!active) return Promise.resolve();
    const write = this.pendingWrite.then(async () => {
      signal?.throwIfAborted();
      const previous = active.clips;
      const clips = update(previous);
      const cfg = reset ? VOICE_CONTROLS : normalizeVoiceControls(this.options.config());
      const queue = active.protocol === 1 ? { clip: clips[0] } : clips.length ? { clips } : {};
      const body = JSON.stringify({ version: active.protocol, gain: cfg.voiceMouthGain,
        volume: clips.length ? cfg.voiceVolume : 1, sync: clips.length ? cfg.voiceLipSync : true, ...queue }) + '\n';
      if (active.signature === body) return;
      const root = await lstat(active.dir).catch(() => null);
      if (!root?.isDirectory() || root.isSymbolicLink()
          || !await isRegular(join(active.dir, ASSET), 4096)) {
        active.clips = [];
        if (clips.length) throw new Error('桌宠语音资源已变化');
        return;
      }
      if (!active.signature && await readFile(join(active.dir, ASSET), 'utf8').catch(() => '') === body) {
        active.signature = body;
        return;
      }
      const temporary = join(active.dir, `figure-voice-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, body, { flag: 'wx' });
        for (let attempt = 0; ; attempt++) {
          signal?.throwIfAborted();
          try {
            await rename(temporary, join(active.dir, ASSET));
            break;
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (process.platform !== 'win32' || !['EPERM','EACCES','EBUSY'].includes(code ?? '') || attempt === 3) throw error;
            // A renderer can briefly hold the state file open on Windows.
            await delay(20 * 2 ** attempt, undefined, {signal});
          }
        }
        active.signature = body;
        active.clips = clips;
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
      const retained = new Set(clips.map(clip => clip.id));
      await Promise.all(previous.filter(clip => !retained.has(clip.id)).map(clip =>
        rm(join(active.dir, clipName(clip.id)), { force: true }).catch(() => {})));
    });
    this.pendingWrite = write.catch(() => {});
    return write;
  }
}
