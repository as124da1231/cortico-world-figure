/**
 * Coo 魔术人偶工坊 World。
 *
 * 交互全在面板里（dist/webui.js，手写 ESM，不打 bundle）：
 *   选择目录 → 扫描 → 打包 → 安装
 * 每一步单独触发，结果写回面板的日志与状态灯；重启 Coo 不重跑。
 *
 * 打包做两遍：先出默认取景的包，再去无头 Chrome 里量尺寸 + 拍封面，
 * 带着量出来的 fit 重建一次，最后把封面拷回去。
 */
import { existsSync } from 'node:fs';
import {
  cp, mkdir, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  World, WorldHost, WorldWebUiDecl, ToolDef, WorldStreamSocket,
} from 'cortico/core/types.ts';
import type { ConfigGroup } from 'cortico/core/config-schema.ts';
import { buildPack, dirSize, editPack, installPack, scanModel, type ScanSummary } from './pipeline.ts';
import { PackImporter, filesFromBundle, filesFromZip } from './import.ts';
import { captureCover } from './cover.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const WORKBENCH_DIR = join(PACKAGE_DIR, 'workbench');

export interface Live2dSection {
  enabled: boolean;
  modelDir?: string;
  figuresDir?: string;
  workDir?: string;
  /** 安装完就删掉那份打包产物。 */
  autoDelete?: boolean;
  /** 打包时拍封面（默认开）。 */
  cover?: boolean;
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

interface Persisted {
  modelDir: string;
  scan?: ScanSummary & { at: number };
  build?: BuildState;
  /** 历史打包，最新在前，最多 20 份。 */
  builds?: BuildRecord[];
  install?: { target: string; at: number };
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
  private streams = new Set<WorldStreamSocket>();
  /** 导入待装清单（zip / 文件夹）。 */
  private importer = new PackImporter();

  constructor(opts: Live2dWorld['opts']) {
    this.opts = opts;
  }

  envPromptVars(): Record<string, string> | null {
    return null;
  }

  tools(): ToolDef[] {
    return [];
  }

  async start(_host: WorldHost): Promise<void> {
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
  }

  async stop(): Promise<void> {
    this.streams.clear();
    await this.importer.cancel();
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
      label: zh ? 'Coo 魔术人偶工坊' : 'Coo Marionette Atelier',
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
      ],
      lamps: [
        { label: zh ? '扫描' : 'Scan', state: lamp(this.steps.scan), hint: this.steps.scan.hint },
        { label: zh ? '打包' : 'Pack', state: lamp(this.steps.build), hint: this.steps.build.hint },
        { label: zh ? '安装' : 'Install', state: lamp(this.steps.install), hint: this.steps.install.hint },
      ],
      panels: [{
        id: 'workbench',
        title: zh ? 'Coo 魔术人偶工坊' : 'Coo Marionette Atelier',
        description: zh ? '选目录、扫描、打包、安装' : 'Pick, scan, build, install',
      }],
      invoke: (panel, method, args) => this.invoke(panel, method, args),
      stream: (panel, socket) => {
        if (panel !== 'workbench') return;
        this.streams.add(socket);
        socket.onClose?.(() => this.streams.delete(socket));
        for (const line of this.log.slice(-50)) socket.send?.(line);
      },
      config: [CONFIG_GROUP(zh)],
    };
  }

  private async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== 'workbench') throw new Error(`未知面板：${panel}`);
    const dir = String(args[0] ?? this.state.modelDir ?? '').trim();

    if (method === 'state') {
      return { ...this.snapshot(), log: this.log.slice(-20) };
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
      const list = this.state.builds ?? [];
      const keep = list.slice(0, 1);
      const drop = list.slice(1);
      for (const b of drop) await rm(b.packDir, { recursive: true, force: true }).catch(() => {});
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
      const file = which === 'sdk' ? 'LICENSE-live2d-components.txt' : 'LICENSE-live2d-core.txt';
      let text = '';
      try { text = await readFile(join(WORKBENCH_DIR, 'pack', 'sdk', file), 'utf8'); } catch { /* ignore */ }
      return { file, text };
    }
    if (method === 'importStage') {
      if (this.busy) throw new Error('上一个动作还没结束');
      const b64 = String(args[0] ?? '');
      const kind = String(args[1] ?? 'zip') === 'folder' ? 'folder' : 'zip';
      if (!b64) throw new Error('没有收到文件');
      const bytes = Buffer.from(b64, 'base64');
      const files = kind === 'folder' ? filesFromBundle(bytes) : filesFromZip(bytes);
      if (typeof files === 'string') throw new Error(files);
      this.busy = true;
      try {
        const installed = await this.installedVersions();
        const r = await this.importer.stage(files, kind === 'folder', installed);
        if ('error' in r) throw new Error(r.error);
        this.say(`读到 ${r.packs.length} 个模型包`);
        return r;
      } finally {
        this.busy = false;
      }
    }
    if (method === 'importInstall') {
      if (this.busy) throw new Error('上一个动作还没结束');
      const token = String(args[0] ?? '');
      const dirs = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
      const replace = Array.isArray(args[2]) ? (args[2] as unknown[]).map(String) : [];
      const figures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
      this.busy = true;
      this.steps.install = { phase: 'loading', hint: '导入安装中…' };
      try {
        const r = await this.importer.install(token, dirs, replace, {
          figuresDir: figures,
          backupRoot: join(dirname(figures), 'figure-backups'),
          keep: 2,
        });
        if ('error' in r) throw new Error(r.error);
        if ('conflicts' in r) return { conflicts: r.conflicts };
        const last = r.installed[r.installed.length - 1];
        this.state.install = { target: last.target, at: Date.now() };
        this.steps.install = { phase: 'done', hint: last.target, at: Date.now() };
        await this.save();
        this.say(`导入完成 · ${r.installed.map((x) => x.id).join('、')}`);
        return { installed: r.installed.map((x) => x.id), state: this.snapshot() };
      } catch (e) {
        this.steps.install = { phase: 'error', hint: errText(e) };
        this.say(`导入失败 · ${errText(e)}`);
        throw e;
      } finally {
        this.busy = false;
      }
    }
    if (method === 'importCancel') {
      await this.importer.cancel();
      return { ok: true };
    }
    if (method === 'importBuild') {
      if (this.busy) throw new Error('上一个动作还没结束');
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
      if (this.busy) throw new Error('上一个动作还没结束');
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
    if (method === 'importFinish') {
      if (this.busy) throw new Error('上一个动作还没结束');
      const token = String(args[0] ?? '');
      const fromFolders = Boolean(args[1]);
      this.busy = true;
      try {
        const installed = await this.installedVersions();
        const r = await this.importer.finishUpload(token, fromFolders, installed);
        if ('error' in r) throw new Error(r.error);
        this.say(`读到 ${r.models.length + r.packs.length} 个模型 / 模型包`);
        return r;
      } finally {
        this.busy = false;
      }
    }
    if (method === 'detail') {
      const id = String(args[0] ?? '');
      const rec = (this.state.builds ?? []).find((b) => b.id === id) ?? this.state.build;
      if (!rec || !existsSync(rec.packDir)) throw new Error('没有这份打包产物');
      const m = JSON.parse(await readFile(join(rec.packDir, 'figure.json'), 'utf8'));
      let bodyGain = 1.8;
      let style = 'natural';
      try {
        const models = join(rec.packDir, 'models');
        for (const d of await readdir(models)) {
          const prof = join(models, d, 'profile.js');
          if (!existsSync(prof)) continue;
          const s = await readFile(prof, 'utf8');
          const g = /"bodyGain":\s*([-\d.]+)/.exec(s);
          const st = /"style":\s*"([^"]+)"/.exec(s);
          if (g) bodyGain = Number(g[1]);
          if (st) style = st[1];
          break;
        }
      } catch { /* 没 profile 就用默认 */ }
      return {
        nameZh: m.name?.zh ?? '', nameEn: m.name?.en ?? '',
        aboutZh: m.about?.zh ?? '', aboutEn: m.about?.en ?? '',
        bodyGain, style,
      };
    }
    if (method === 'edit') {      const id = String(args[0] ?? '');
      const patch = (args[1] ?? {}) as Record<string, unknown>;
      const rec = (this.state.builds ?? []).find((b) => b.id === id) ?? this.state.build;
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
    if (method === 'detail') return this.buildDetail(String(args[0] ?? ''));
    if (method === 'edit') return this.editBuild(String(args[0] ?? ''), (args[1] ?? {}) as Record<string, unknown>);
    throw new Error(`未知方法：${panel}.${method}`);
  }

  private async doScan(dir: string): Promise<unknown> {
    this.guard(dir);
    this.busy = true;
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
    } finally {
      this.busy = false;
    }
  }

  private async doBuild(dir: string, opts: { remember?: boolean } = {}): Promise<unknown> {
    this.guard(dir);
    if (this.busy) throw new Error('上一个动作还没结束');
    this.busy = true;
    const logs: string[] = [];
    const push = (line: string) => { logs.push(line); this.say(line); };
    try {
      this.steps.build = { phase: 'loading', hint: '打包中…' };
      this.steps.install = { ...IDLE, hint: '打包后需要安装' };
      push(`打包 ${dir}`);

      let t0 = Date.now();
      let packDir = await buildPack(WORKBENCH_DIR, dir, this.workRoot());
      push(`初版包就绪 · ${Date.now() - t0} ms`);

      this.steps.build = { phase: 'loading', hint: '量尺寸 / 拍封面…' };
      t0 = Date.now();
      const shot = this.opts.getConfig().cover === false
        ? { ok: false, error: '设置里关闭了封面', fit: null as unknown }
        : await captureCover(packDir, WORKBENCH_DIR);
      if (shot.ok) push(`封面 + 尺寸 · ${Date.now() - t0} ms`);
      else push(`! 封面跳过：${shot.error ?? '未知原因'}`);

      // 量出了 fit 就带着它重建一次，把取景写进 profile
      let finalDir = packDir;
      if (shot.fit) {
        t0 = Date.now();
        const rebuilt = await buildPack(WORKBENCH_DIR, dir, this.workRoot(), { fit: shot.fit });
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

      const bytes = await dirSize(finalDir);
      const manifest = JSON.parse(await readFile(join(finalDir, 'figure.json'), 'utf8'));
      const words = Array.isArray(manifest.vocab) ? manifest.vocab.length : 0;
      const hint = `${(bytes / 1048576).toFixed(1)} MB · ${words} 词`
        + (shot.ok ? ' · 封面 ✓' : '')
        + (shot.fit ? ' · 已贴合' : '');
      this.steps.build = { phase: 'done', hint, at: Date.now() };
      if (opts.remember !== false) this.state.modelDir = dir;
      const rec: BuildRecord = {
        id: `${manifest.id || 'pack'}-${Date.now()}`,
        packDir: finalDir, bytes, words,
        cover: shot.ok, fit: Boolean(shot.fit), at: Date.now(),
      };
      this.state.builds = [rec, ...(this.state.builds ?? [])].slice(0, 20);
      this.state.build = {
        packDir: finalDir, bytes, words, cover: shot.ok, fit: Boolean(shot.fit), at: Date.now(),
      };
      await this.save();
      push(`打包完成 · ${hint}`);
      return { state: this.snapshot(), log: logs, warn: shot.ok ? undefined : `封面跳过：${shot.error ?? ''}` };
    } catch (e) {
      this.steps.build = { phase: 'error', hint: errText(e) };
      push(`打包失败 · ${errText(e)}`);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  private async doInstall(dir: string, buildId?: string): Promise<unknown> {
    this.guard(dir);
    if (this.busy) throw new Error('上一个动作还没结束');
    const chosen = buildId
      ? (this.state.builds ?? []).find((b) => b.id === buildId)
      : this.state.build;
    if (!chosen || !existsSync(chosen.packDir)) throw new Error('先打包，再安装');
    this.busy = true;
    this.steps.install = { phase: 'loading', hint: '安装中…' };
    try {
      const figures = await resolveFigures(this.opts.getConfig(), this.opts.dataDir);
      const target = await installPack(chosen.packDir, figures, {
        backupRoot: join(dirname(figures), 'figure-backups'),
        keep: 2,
      });
      this.steps.install = { phase: 'done', hint: target, at: Date.now() };
      this.state.install = { target, at: Date.now() };
      // 装完就删掉这份打包产物（开关打开时）
      if (this.opts.getConfig().autoDelete) {
        const rec = (this.state.builds ?? []).find((b) => b.packDir === chosen.packDir);
        if (rec) await this.removeBuild(rec.id, { quiet: true });
        this.say('已按开关删除打包产物');
      }
      await this.save();
      this.say(`安装完成 · ${target}`);
      return { state: this.snapshot(), log: [`安装到 ${target}`] };
    } catch (e) {
      this.steps.install = { phase: 'error', hint: errText(e) };
      this.say(`安装失败 · ${errText(e)}`);
      throw e;
    } finally {
      this.busy = false;
    }
  }

  /** 打包历史，最新在前。卡片封面用 128 小图，转 data URL 给面板。 */
  private async listBuilds(): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    const alive: BuildRecord[] = [];
    let dropped = false;
    for (const b of this.state.builds ?? []) {
      if (!existsSync(b.packDir)) { dropped = true; continue; }
      alive.push(b);
      let thumb = '';
      try {
        const png = await readFile(join(b.packDir, 'thumb', 'opt-model.png'));
        thumb = 'data:image/png;base64,' + png.toString('base64');
      } catch { /* 没封面就不给图 */ }
      let nameZh = '';
      let nameEn = '';
      try {
        const m = JSON.parse(await readFile(join(b.packDir, 'figure.json'), 'utf8'));
        nameZh = typeof m.name?.zh === 'string' ? m.name.zh : '';
        nameEn = typeof m.name?.en === 'string' ? m.name.en : '';
      } catch { /* 读不到就用 id */ }
      out.push({
        id: b.id, nameZh, nameEn, bytes: b.bytes, words: b.words, cover: b.cover, fit: b.fit, at: b.at,
        exists: true, thumb,
      });
    }
    if (dropped) {
      this.state.builds = alive;
      if (this.state.build && !alive.some((b) => b.packDir === this.state.build!.packDir)) {
        delete this.state.build;
      }
      await this.save().catch(() => {});
    }
    return out;
  }

  private async removeBuild(id: string, opts: { quiet?: boolean } = {}): Promise<void> {
    const list = this.state.builds ?? [];
    const idx = list.findIndex((b) => b.id === id);
    if (idx < 0) throw new Error('没有这份打包产物');
    const [rec] = list.splice(idx, 1);
    this.state.builds = list;
    if (this.state.build?.packDir === rec.packDir) delete this.state.build;
    await rm(rec.packDir, { recursive: true, force: true }).catch(() => {});
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
      } : null,
      build: s.build ? {
        bytes: s.build.bytes, words: s.build.words, cover: s.build.cover, fit: s.build.fit,
      } : null,
      install: s.install ? { target: s.install.target } : null,
      builds: (s.builds ?? []).map((b) => ({ id: b.id, bytes: b.bytes, at: b.at })),
      autoDelete: Boolean(this.opts.getConfig().autoDelete),
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

  private stateFile(): string {
    return join(this.opts.dataDir, 'figure', 'state.json');
  }

  private async readState(): Promise<Persisted | null> {
    try {
      return JSON.parse(await readFile(this.stateFile(), 'utf8')) as Persisted;
    } catch {
      return null;
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.stateFile()), { recursive: true }).catch(() => {});
    await writeFile(this.stateFile(), JSON.stringify(this.state, null, 2), 'utf8').catch(() => {});
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
      title: zh ? 'Coo 魔术人偶工坊' : 'Coo Marionette Atelier',
      description: zh
        ? '面板里选目录、打包、安装；这里只放高级项。'
        : 'Use the panel for folder, pack and install; this tab keeps advanced options.',
      properties: {
        'worlds.figure.cover': {
          type: 'boolean',
          title: zh ? '打包时拍封面' : 'Capture a cover when packing',
          description: zh ? '关掉就不启动无头浏览器，也不量尺寸' : 'Off: skip headless render',
          'x-hot': true,
          default: true,
        },
        'worlds.figure.autoDelete': {
          type: 'boolean',
          title: zh ? '安装后删除打包产物' : 'Delete the pack after install',
          description: zh ? '装完只留 figures 那一份，省一半磁盘' : 'Keep only the installed copy',
          'x-hot': true,
          default: false,
        },
        'worlds.figure.figuresDir': {
          type: 'string',
          title: zh ? '安装目录（可留空）' : 'Install folder (optional)',
          description: zh ? '留空 = Coo 自己的 figures' : 'Empty = Coo figures',
          'x-hot': true,
          'x-path': { kind: 'directory' },
        },
      },
    },
  };
}
