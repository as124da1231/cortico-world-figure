import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const WEB = new URL('./webui/', import.meta.url);
const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};
const MAX_REQUEST = 256 * 1024;
const RECONNECT_MS = 12000;

const STUDIO_THEME_COLORS = [
  'paper', 'paper-2', 'sheet', 'sheet-2', 'ink', 'ink-soft', 'ink-dim',
  'line', 'line-2', 'accent', 'on-accent', 'ok', 'warn', 'danger',
] as const;

type StudioTheme = {
  mode?: 'light' | 'dark';
  colors: Partial<Record<typeof STUDIO_THEME_COLORS[number], string>>;
};

function normalizeStudioTheme(value: unknown): StudioTheme | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const {mode, colors} = value as Record<string, unknown>;
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return;
  const result: StudioTheme = {colors:{}};
  if (mode === 'light' || mode === 'dark') result.mode = mode;
  for (const key of STUDIO_THEME_COLORS) {
    const color = (colors as Record<string, unknown>)[key];
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) result.colors[key] = color;
  }
  return result;
}

export interface BrowserDraft {
  bindings: unknown[];
  wardrobe: unknown[];
}

interface EditorOwner {
  id: string;
  resume: string;
  reconnectable: boolean;
  stream?: ServerResponse;
  draftRevision: number;
}

interface EditorOptions {
  data: { token: string };
  language: string;
  theme?: unknown;
  pack: string;
  workbench: string;
  draft?: BrowserDraft;
  setDraft?(draft?: BrowserDraft): void;
  keepAlive(): void;
  save(bindings: unknown[], wardrobe: unknown[]): Promise<unknown>;
  skipImages(): Promise<unknown>;
  progress?(): { stage: string | null };
  close(): Promise<void>;
}

export interface BrowserEditor {
  url: string;
  stop(): Promise<void>;
  isSaving(): boolean;
}

export async function openEditorInBrowser(url: string) {
  const run = promisify(execFile);
  if (process.platform === 'win32') {
    const command = Buffer.from(`Start-Process -FilePath '${url.replaceAll("'", "''")}'`, 'utf16le').toString('base64');
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], { windowsHide: true, timeout: 8000 });
    return;
  }
  await run(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { timeout: 8000 });
}

async function readJson(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Error('请求格式无效');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST) throw Error('编辑请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function serveBrowserEditor(opts: EditorOptions): Promise<BrowserEditor> {
  const [common, style, editor, studio] = await Promise.all([
    Promise.all([
      join(opts.workbench, 'pack/backends/wardrobe-slots.js'),
      join(opts.workbench, 'pack/backends/native-combination.js'),
      new URL('manual.js', WEB),
    ].map(file => readFile(file, 'utf8'))),
    readFile(new URL('styles.css', WEB), 'utf8'),
    readFile(new URL('browser-editor.js', WEB), 'utf8'),
    readFile(new URL('browser-editor.css', WEB), 'utf8'),
  ]);
  const js = [...common, editor].map(code => code.replace(/^\uFEFF/, '').replace(/^export /gm, '')).join('\n');
  const zh = opts.language !== 'en';
  const title = zh ? 'Figure 形象编辑器' : 'Figure editor';
  const html = `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="icon" href="data:,">
<link rel="stylesheet" href="editor.css"><main class="figure-studio" aria-label="${title}"></main>
<div class="figure-studio-toast" role="status"></div><script type="module" src="editor.js"></script></html>`;
  const theme = normalizeStudioTheme(opts.theme);
  const prefix = `/${opts.data.token}/`;
  let origin = '';
  let timer: ReturnType<typeof setTimeout>;
  let closing: Promise<void> | undefined;
  let owner: EditorOwner | undefined;
  let draft = opts.draft;
  let saving: { id: string; digest: string; promise: Promise<unknown> } | undefined;
  let receipt: { id: string; digest: string; result: unknown } | undefined;
  const stage = (value?: BrowserDraft) => {
    draft = value;
    opts.setDraft?.(value);
  };
  const stop = () => closing ??= (async () => {
    clearTimeout(timer);
    await saving?.promise.catch(() => {});
    await new Promise<void>(ok => {
      server.close(() => ok());
      server.closeAllConnections();
    });
    await opts.close();
  })();
  const expireAfter = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (saving) expireAfter(RECONNECT_MS);
      else void stop().catch(() => {});
    }, ms);
    timer.unref();
  };
  const json = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(value));
  };
  const expired = (res: ServerResponse) => json(res, { code: 'expired', error: zh ? '编辑连接已失效。' : 'The editing connection expired.' }, 410);
  const belongsTo = (req: IncomingMessage, current?: EditorOwner) =>
    !!current && req.headers.authorization === `Bearer ${current.id}`;
  const isDraft = (value: BrowserDraft | null | undefined): value is BrowserDraft =>
    Array.isArray(value?.bindings) && Array.isArray(value?.wardrobe);

  function detach(current: EditorOwner) {
    if (closing || owner !== current || current.reconnectable) return;
    const stream = current.stream;
    current.stream = undefined;
    current.reconnectable = true;
    expireAfter(RECONNECT_MS);
    stream?.end();
  }

  function connect(current: EditorOwner, res: ServerResponse) {
    if (current.stream) return json(res, { code: 'occupied' }, 409);
    current.stream = res;
    current.reconnectable = false;
    clearTimeout(timer);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.write(': ready\n\n');
    res.socket?.setKeepAlive(true, 30000);
    const heartbeat = setInterval(() => {
      try {
        if (!receipt && !saving) opts.keepAlive();
        res.write(': heartbeat\n\n');
      } catch { void stop().catch(() => {}); }
    }, 25000);
    heartbeat.unref();
    res.once('close', () => {
      clearInterval(heartbeat);
      if (current.stream === res) detach(current);
    });
  }
  async function serveScene(path: string, res: ServerResponse) {
    const scene = origin + prefix + 'scene/';
    if (!path) {
      res.setHeader('content-security-policy', `sandbox allow-scripts; default-src 'none'; script-src ${scene} 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src ${scene} data: blob:; connect-src ${scene}; frame-ancestors ${origin}; base-uri 'none'; form-action 'none'`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        `<!doctype html><meta charset="utf-8"><style>html{color-scheme:${theme?.mode ?? 'light dark'}}html,body,#root{position:absolute;inset:0;margin:0;overflow:hidden;background:transparent}</style><div id="root"></div><script type="module" src="figure-frame.js"></script>`,
      );
      return;
    }
    let root: string;
    let name: string;
    if (path.startsWith('pack/')) {
      root = opts.pack;
      name = path.slice(5);
      if (name !== 'figure.js' && !/^(models|sdk|backends|vendor)\//.test(name)) {
        res.writeHead(404).end();
        return;
      }
    } else if (path.startsWith('kit/')) {
      root = join(opts.workbench, 'vendor/coo-kit');
      name = path;
    } else if (path === 'figure-frame.js' || path === 'i18n.js') {
      root = join(opts.workbench, 'vendor/coo-preview');
      name = path;
    } else {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(root, name);
    if (!file.startsWith(resolve(root) + sep) || !await stat(file).then(s => s.isFile(), () => false)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'access-control-allow-origin': 'null',
    });
    await pipeline(createReadStream(file), res);
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch(error => {
      if (!res.headersSent) json(res, { error: String(error?.message ?? error).slice(0, 500) }, 400);
      else if (!res.writableEnded) res.destroy();
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    const url = new URL(req.url ?? '/', origin);
    if (closing || req.headers.host !== new URL(origin).host || url.origin !== origin || !url.pathname.startsWith(prefix)) {
      res.writeHead(404).end();
      return;
    }
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    if (path.includes('\\') || path.split('/').some(part => part === '.' || part === '..')) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'GET' && path.startsWith('scene/')) {
      await serveScene(path.slice(6), res);
      return;
    }
    if (req.method === 'GET') {
      if (!path) {
        res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: 'self'; frame-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
        return;
      }
      if (path === 'editor.js' || path === 'editor.css') {
        const script = path.endsWith('.js');
        res.writeHead(200, { 'content-type': script ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }).end(script ? js : style + '\n' + studio);
        return;
      }
      if (path === 'events') {
        const current = owner;
        if (!current || current.reconnectable || !belongsTo(req, current)) return expired(res);
        connect(current, res);
        return;
      }
      if (path === 'save-progress') {
        if (!belongsTo(req, owner)) return expired(res);
        json(res, opts.progress?.() ?? { stage: null });
        return;
      }
    }
    if (req.method !== 'POST' || req.headers.origin !== origin) {
      res.writeHead(403).end();
      return;
    }
    if (path === 'claim') {
      const body = await readJson(req);
      if (closing) return expired(res);
      const resume = typeof body?.resume === 'string' && /^[a-f0-9-]{36}$/i.test(body.resume) ? body.resume : '';
      const resuming = !!resume && owner?.resume === resume;
      if (owner && (!resuming || !owner.reconnectable)) {
        return json(res, { code: 'occupied', retry: resuming }, 409);
      }
      if (!receipt && !saving) opts.keepAlive();
      owner = { id: randomUUID(), resume: resuming ? resume : randomUUID(), reconnectable: false, draftRevision: -1 };
      expireAfter(RECONNECT_MS);
      json(res, { owner: owner.id, resume: owner.resume, data: { ...opts.data, draft, theme }, saved: receipt?.result });
      return;
    }

    const current = owner;
    if (!current || !belongsTo(req, current)) return expired(res);
    if (path === 'detach') {
      detach(current);
      json(res, { ok: true });
    } else if (path === 'close') {
      if (saving) return json(res, { code: 'saving', error: zh ? '正在保存，请稍候。' : 'Save in progress.' }, 409);
      stage();
      res.once('finish', () => void stop().catch(() => {}));
      json(res, { ok: true });
    } else if (path === 'skip-images') {
      if (!current.stream) return expired(res);
      json(res, await opts.skipImages());
    } else if (path === 'draft') {
      const body = await readJson(req);
      if (closing || owner !== current || !current.stream) return expired(res);
      if (!Number.isSafeInteger(body?.revision) || (body.draft !== null && !isDraft(body.draft))) throw Error('编辑草稿无效');
      if (!receipt && !saving && body.revision > current.draftRevision) {
        current.draftRevision = body.revision;
        stage(body.draft ?? undefined);
      }
      json(res, { ok: true });
    } else if (path === 'save') {
      const body = await readJson(req);
      if (closing || owner !== current || !current.stream) return expired(res);
      const id = body?.id;
      if (!isDraft(body) || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw Error('编辑内容无效');
      const value = { bindings: body.bindings, wardrobe: body.wardrobe };
      const digest = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const previous = receipt ?? saving;
      if (previous) {
        if (previous.id !== id || previous.digest !== digest) {
          return json(res, { code: 'save-conflict', error: zh ? '已有另一份提交，请重新打开模型卡核对。' : 'Another submission exists. Reopen the model card to check it.' }, 409);
        }
        json(res, receipt ? receipt.result : await saving!.promise);
        return;
      }
      stage(value);
      const promise = Promise.resolve().then(() => opts.save(value.bindings, value.wardrobe));
      saving = { id, digest, promise };
      try {
        const result = await promise;
        receipt = { id, digest, result };
        stage();
        json(res, result);
      } finally { saving = undefined; }
    } else {
      res.writeHead(404).end();
    }
  }

  await new Promise<void>((ok, bad) => {
    server.once('error', bad);
    server.listen(0, '127.0.0.1', ok);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  expireAfter(60000);
  return { url: origin + prefix, stop, isSaving: () => !!saving };
}
