/**
 * 封面：起一个临时 HTTP 服务（工作台页面 + 形象包 + kit），
 * 用无头 Chrome 打开渲染页，页面自己调 `__l2dCover()` 并把两张 PNG POST 回来。
 *
 * 不依赖 Electron，也不装依赖：Chrome / Edge 用系统里已有的。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const COVER_PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>cover</title>
<style>html,body{margin:0;background:transparent;overflow:hidden}#root{position:relative}</style>
</head><body><div id="root"></div>
<script type="module">
const post = (body) => fetch('/__cover', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
try {
  const kit = await import('/kit/body.js');
  const mod = await import('/pack/figure.js');
  const rootEl = document.getElementById('root');
  const bounds = { W: 620, H: 620, floorY: 512, S: 2 };
  const host = { root: rootEl, bounds: () => bounds, emit: () => {}, sound: () => {}, start: { x: bounds.W / 2, facing: 1 } };
  const loadImage = (u) => new Promise((ok, bad) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => bad(new Error('image failed: ' + u));
    img.src = String(u);
  });
  const body = await mod.createFigureBody(new URL('/pack/', location.origin), { kit, host, loadImage, scheme: '', model: undefined });
  body.do?.('neutral');
  body.set?.({ roam: 'off' });
  await new Promise((r) => setTimeout(r, 1200));
  let fit = null;
  try { globalThis.__l2dAutoFit?.(); fit = globalThis.__l2dFit?.get?.() ?? null; } catch (e) { fit = null; }
  await new Promise((r) => setTimeout(r, 400));
  const r = globalThis.__l2dCover?.();
  if (!r || !r.png) throw new Error('cover api unavailable');
  await post({ png: r.png, png128: r.png128, fit });
  document.title = 'done';
} catch (e) {
  await post({ error: String((e && e.message) || e) }).catch(() => {});
  document.title = 'failed';
}
</script></body></html>`;

export interface CoverResult {
  ok: boolean;
  error?: string;
  bytes?: number;
  fit?: { zoom?: number; offset?: [number, number]; autoFit?: boolean } | null;
}

/** 系统里找一个 Chromium 内核的浏览器。 */
export function findBrowser(): string | null {
  const env = process.env.CHROME_PATH?.trim();
  if (env && existsSync(env)) return env;
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Chromium/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return cands.find((p) => existsSync(p)) ?? null;
}

/**
 * 给已构建的包补上 thumb/cover.png + thumb/opt-model.png，并写回 figure.json。
 * 失败只返回 ok:false，不影响构建本身。
 */
export async function captureCover(
  packDir: string,
  workbenchDir: string,
  timeoutMs = 60000,
): Promise<CoverResult> {
  const browser = findBrowser();
  if (!browser) return { ok: false, error: '没找到 Chrome / Edge，跳过封面' };

  let resolveResult: (r: CoverResult) => void = () => {};
  const done = new Promise<CoverResult>((resolve) => { resolveResult = resolve; });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/__cover') {
      let raw = '';
      for await (const c of req) raw += c;
      res.writeHead(200).end('ok');
      try {
        const body = JSON.parse(raw);
        if (body.error) { resolveResult({ ok: false, error: String(body.error) }); return; }
        const fit = body.fit && typeof body.fit === 'object' ? body.fit : null;
        const main = pngOf(body.png);
        const small = pngOf(body.png128);
        const dir = join(packDir, 'thumb');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'cover.png'), main);
        await writeFile(join(dir, 'opt-model.png'), small);
        const file = join(packDir, 'figure.json');
        const manifest = JSON.parse(await readFile(file, 'utf8'));
        manifest.thumb = 'thumb/cover.png';
        if (Array.isArray(manifest.axes) && manifest.axes[0]?.options?.[0]) {
          manifest.axes[0].options[0].thumb = 'thumb/opt-model.png';
        }
        await writeFile(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        resolveResult({ ok: true, bytes: main.length, fit });
      } catch (e) {
        resolveResult({ ok: false, error: String((e as Error)?.message ?? e) });
      }
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(COVER_PAGE);
      return;
    }
    const isKit = url.pathname.startsWith('/kit/');
    const root = isKit ? join(workbenchDir, 'vendor', 'coo-kit') : join(packDir);
    const rel = isKit ? 'kit/' + url.pathname.slice(5) : url.pathname.replace(/^\/pack\//, '');
    const file = join(root, normalize(decodeURIComponent(rel)).replace(/^([/\\])+/, ''));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const buf = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(buf);
    } catch {
      res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/`;

  const profile = await mkdtemp(join(tmpdir(), 'l2d-cover-'));
  const child = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--window-size=640,640',
    '--virtual-time-budget=30000',
    '--user-data-dir=' + profile,
    url,
  ], { windowsHide: true, stdio: 'ignore' });

  const timeout = new Promise<CoverResult>((resolve) => {
    setTimeout(() => resolve({ ok: false, error: '封面超时' }), timeoutMs).unref?.();
  });
  const result = await Promise.race([done, timeout]);

  try { child.kill(); } catch { /* ignore */ }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  return result;
}

/** PNG data URL → Buffer，顺带校验头。 */
function pngOf(raw: unknown): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(raw ?? ''));
  if (!m) throw new Error('封面不是 PNG data URL');
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('封面不是有效 PNG');
  return buf;
}
