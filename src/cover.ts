/**
 * 封面：起一个临时 HTTP 服务（工作台页面 + 形象包 + kit），
 * 用无头 Chrome 打开渲染页，页面自己调 `__l2dCover()` 并把两张 PNG POST 回来。
 *
 * 不依赖 Electron，也不装依赖：Chrome / Edge 用系统里已有的。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import type {StaticPreviewPlan} from './manual-preview.ts';
import { parseFigureJson } from './pack-manifest.ts';

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
  method: 'POST', headers: { 'content-type': 'application/json', 'x-figure-capture': __CAPTURE_TOKEN__ }, body: JSON.stringify(body),
});
const checkRender = () => {
  const error = globalThis.__l2dRenderQuality?.()?.error;
  if (error) throw new Error(error);
};
let body;
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
  const asset = (p) => new URL(p, new URL('/pack/', location.origin));
  const plan = __STATIC_PREVIEW__;
  const imageOnly = __COVER_IMAGE_ONLY__;
  body = await mod.createFigureBody(new URL('/pack/', location.origin), { kit, host, loadImage, asset, scheme: '', model: undefined, preview: !!plan || imageOnly, previewSize: imageOnly ? 256 : undefined });
  body.do?.('neutral');
  body.set?.({ roam: 'off' });
  const deadline = performance.now() + 20000;
  while (globalThis.__l2dPreviewReady && !globalThis.__l2dPreviewReady()) {
    checkRender();
    if (performance.now() >= deadline) throw new Error('模型加载超时');
    body.step(1 / 60);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  checkRender();
  if (plan) {
    if (!globalThis.__l2dStaticSample) throw new Error('静态预览接口不可用');
    globalThis.__l2dPreview.wardrobe(plan.groups, {});
    for (let i = 0; i < 8; i++) body.step(1 / 60);
    const frames = plan.samples.map(sample => ({ ...sample, ...globalThis.__l2dStaticSample(sample) }));
    await post({ frames, quality: globalThis.__l2dRenderQuality?.() });
  } else {
    let fit = null, cover = null;
    if (!__WARDROBE_ONLY__) {
      try { globalThis.__l2dAutoFit?.(); fit = globalThis.__l2dFit?.get?.() ?? null; } catch { /* Cover can still work without auto-fit. */ }
      cover = globalThis.__l2dCover?.();
      checkRender();
      if (!cover?.png) throw new Error('封面渲染失败');
    }
    const evidence = [];
    for (const sample of __NATIVE_SAMPLES__) {
      const png = globalThis.__l2dNativeSample?.(sample.id, sample.time, sample.word, sample.generic);
      checkRender();
      if (!png) throw new Error('动作取样渲染失败');
      evidence.push({ ...sample, png });
    }
    const wardrobe = [];
    for (const sample of __WARDROBE_SAMPLES__) {
      await body.setScheme?.(sample.scheme);
      const shot = globalThis.__l2dCover?.();
      checkRender();
      if (!shot?.png128) throw new Error('装扮缩略图渲染失败');
      wardrobe.push({ ...sample, png: shot.png128 });
    }
    await post({ png: cover?.png, png128: cover?.png128, fit, evidence, wardrobe });
  }
  document.title = 'done';
} catch (e) {
  await post({ error: String((e && e.message) || e) }).catch(() => {});
  document.title = 'failed';
} finally {
  body?.dispose?.();
}
</script></body></html>`;

export interface CoverResult {
  ok: boolean;
  error?: string;
  bytes?: number;
  fit?: { zoom?: number; offset?: [number, number]; autoFit?: boolean } | null;
  evidence?: Array<{id:string;time:number;png:string}>;
  thumbnails?: number;
  frames?: Array<any>;
  quality?: any;
  image?: string;
}

/** Use the host's axis order; all other axes remain at their default option. */
export function wardrobeSamples(manifest:any,groups:any[]) {
  const ids=new Set(groups.filter(g=>g.options?.length).map(g=>g.id)),axes=manifest.axes||[];
  return axes.flatMap((axis:any,index:number)=>!ids.has(axis.id)?[]:axis.options.map((option:any)=>({axis:axis.id,option:option.id,scheme:axes.map((a:any,i:number)=>i===index?option.id:a.options[0].id).join('-')})));
}

export async function captureWardrobeThumbnails(packDir:string,workbenchDir:string,signal?:AbortSignal):Promise<CoverResult> {
  return captureCover(packDir,workbenchDir,60000,[],signal,{wardrobe:true});
}

/** 系统里找一个 Chromium 内核的浏览器。 */
export function findBrowser(): string | null {
  const env = process.env.CHROME_PATH?.trim();
  if (env && existsSync(env)) return env;
  const userApps = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Chromium/Application/chrome.exe',
    join(userApps, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(userApps, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(userApps, 'Chromium', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
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
  samples: Array<{id:string;time:number}> = [],
  signal?: AbortSignal,
  options: {wardrobe?:boolean;preview?:StaticPreviewPlan;imageOnly?:boolean} = {},
): Promise<CoverResult> {
  signal?.throwIfAborted();
  if (samples.length > 6) throw new Error('动作采样最多 6 帧');
  const manifest=options.wardrobe?parseFigureJson(await readFile(join(packDir,'figure.json'),'utf8')):null;
  const library=options.wardrobe?JSON.parse(await readFile(join(packDir,'native-library.json'),'utf8')):null;
  const wardrobe=options.wardrobe?wardrobeSamples(manifest,library.wardrobe||[]):[];
  if(wardrobe.length>136)return { ok: false, error: '装扮缩略图数量超出上限' };
  if(options.wardrobe&&!wardrobe.length)return {ok:true,thumbnails:0};
  const browser = findBrowser();
  if (!browser) return { ok: false, error: '没找到 Chrome / Edge，跳过封面' };

  type CaptureReply = CoverResult | { body: any };
  let resolveResult: (r: CaptureReply) => void = () => {};
  const done = new Promise<CaptureReply>((resolve) => { resolveResult = resolve; });
  const token = randomUUID();
  let origin = '';
  let received = false;

  async function persistCapture(body: any): Promise<CoverResult> {
    if (options.imageOnly) {
      pngOf(body.png, 512);
      return {ok:true,image:body.png};
    }
    if(options.preview){
      if(!Array.isArray(body.frames)||body.frames.length!==options.preview.samples.length)throw Error('预览图片不完整');
      const frames=body.frames.map((frame:any,i:number)=>{
        const png=pngOf(frame.png);if(png.length<24||png.length>262144||png.readUInt32BE(16)!==256||png.readUInt32BE(20)!==256)throw Error('预览图片尺寸无效');
        return {...options.preview!.samples[i],png:frame.png,fit:frame.fit,picks:frame.picks,values:frame.values};
      });
      if(body.quality?.error)throw Error(body.quality.error);
      if(body.quality?.textureLimit!==256||body.quality?.canvas?.some((n:number)=>n>256)||body.quality?.maskSize>256)throw Error('预览画质上限无效');
      return {ok:true,frames,quality:body.quality};
    }
    const fit = body.fit && typeof body.fit === 'object' ? body.fit : null;
    const main = options.wardrobe ? null : pngOf(body.png,512);
    const small = options.wardrobe ? null : pngOf(body.png128,128);
    const evidence = samples.length ? body.evidence : [];
    if (!Array.isArray(evidence) || evidence.length !== samples.length) throw new Error('动作采样不完整');
    for (const [i, item] of evidence.entries()) {
      if (item.id !== samples[i].id || item.time !== samples[i].time) throw new Error('动作采样标识不一致');
      pngOf(item.png,384);
    }
    const dir = join(packDir, 'thumb');
    await mkdir(dir, { recursive: true });
    if(main&&small){await writeFile(join(dir, 'cover.png'), main);await writeFile(join(dir, 'opt-model.png'), small);}
    const file = join(packDir, 'figure.json');
    const manifest = parseFigureJson(await readFile(file, 'utf8'));
    if(!options.wardrobe)manifest.thumb = 'thumb/cover.png';
    if (!options.wardrobe && Array.isArray(manifest.axes) && manifest.axes[0]?.options?.[0]) {
      manifest.axes[0].options[0].thumb = 'thumb/opt-model.png';
    }
    if(wardrobe.length){
      if(!Array.isArray(body.wardrobe)||body.wardrobe.length!==wardrobe.length)throw Error('装扮缩略图不完整');
      for(const [i,item]of body.wardrobe.entries()){
        const expected=wardrobe[i];if(item.axis!==expected.axis||item.option!==expected.option)throw Error('装扮缩略图标识不一致');
        const png=pngOf(item.png);if(png.length<24||png.length>131072||png.readUInt32BE(16)!==128||png.readUInt32BE(20)!==128)throw Error('装扮缩略图尺寸无效');
        const path='thumb/wardrobe-'+i+'.png';await writeFile(join(packDir,path),png);
        manifest.axes.find((a:any)=>a.id===expected.axis).options.find((o:any)=>o.id===expected.option).thumb=path;
      }
    }
    const next = file + '.' + token + '.tmp';
    try {
      await writeFile(next, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      signal?.throwIfAborted();
      await rename(next, file);
    } finally {
      await rm(next, { force: true }).catch(() => {});
    }
    return { ok: true, bytes: main?.length, fit, evidence,thumbnails:wardrobe.length };
  }

  const server = http.createServer(async (req, res) => {
    if (!origin || req.headers.host !== new URL(origin).host) { res.writeHead(421).end(); return; }
    let url: URL;
    try { url = new URL(req.url ?? '/', 'http://x'); decodeURIComponent(url.pathname); }
    catch { res.writeHead(400).end(); return; }
    if (req.method === 'POST' && url.pathname === '/__cover') {
      if (req.headers.origin !== origin || req.headers['x-figure-capture'] !== token
          || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
      if (received) { res.writeHead(409).end(); return; }
      received = true;
      let raw = '';
      try {
        for await (const c of req) {
          raw += c;
          if (raw.length > (options.wardrobe?16:4) * 1048576) { res.writeHead(413).end(); resolveResult({ ok: false, error: '封面数据过大' }); return; }
        }
      } catch { resolveResult({ ok: false, error: '封面上传中断' }); return; }
      res.writeHead(200).end('ok');
      try {
        const body = JSON.parse(raw);
        if (body.error) { resolveResult({ ok: false, error: String(body.error) }); return; }
        resolveResult({ body });
      } catch (e) {
        resolveResult({ ok: false, error: String((e as Error)?.message ?? e) });
      }
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (req.method !== 'GET' || url.searchParams.get('capture') !== token) { res.writeHead(404).end(); return; }
      const json=(v:unknown)=>JSON.stringify(v).replaceAll('<','\\u003c');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).end(COVER_PAGE.replace('__CAPTURE_TOKEN__',json(token)).replace('__STATIC_PREVIEW__',()=>json(options.preview||null)).replace('__COVER_IMAGE_ONLY__',String(!!options.imageOnly)).replace('__NATIVE_SAMPLES__',()=>json(samples)).replace('__WARDROBE_ONLY__',String(!!options.wardrobe)).replace('__WARDROBE_SAMPLES__',()=>json(wardrobe)));
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

  let profile = '';
  let child: ReturnType<typeof spawn> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure = '启动封面渲染服务失败';
  const abort = () => resolveResult({ ok: false, error: '任务已停止' });
  signal?.addEventListener('abort',abort,{once:true});
  try {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.on('error', (error) => {
        reject(error);
        resolveResult({ ok: false, error: `封面渲染服务失败：${error.message}` });
      });
      server.listen(0, '127.0.0.1', resolve);
    });
    signal?.throwIfAborted();
    const port = (server.address() as { port: number }).port;
    origin = `http://127.0.0.1:${port}`;
    const url = `${origin}/?capture=${token}`;

    failure = '启动浏览器失败';
    profile = await mkdtemp(join(tmpdir(), 'l2d-cover-'));
    signal?.throwIfAborted();
    child = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--window-size=640,640',
      '--user-data-dir=' + profile,
      url,
    ], { windowsHide: true, stdio: 'ignore' });

    child.once('error', (e) => resolveResult({ ok: false, error: `启动浏览器失败：${e.message}` }));
    child.once('exit', (code, signal) => {
      if (!received) resolveResult({ ok: false, error: `封面浏览器已退出（${signal ?? code}）` });
    });
    const timeout = new Promise<CaptureReply>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: '封面超时' }), timeoutMs).unref?.();
    });
    const reply = await Promise.race([done, timeout]);
    signal?.throwIfAborted();
    if (!('body' in reply)) return reply;

    // Only the winning reply can write files, and those writes finish before returning.
    failure = '保存封面失败';
    const result = await persistCapture(reply.body);
    signal?.throwIfAborted();
    return result;
  } catch (e) {
    signal?.throwIfAborted();
    return { ok: false, error: `${failure}：${(e as Error).message}` };
  } finally {
    signal?.removeEventListener('abort',abort);
    clearTimeout(timer);
    try { child?.kill(); } catch { /* already exited */ }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/** PNG data URL → Buffer，顺带校验头。 */
export function pngOf(raw: unknown, size?: number): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(raw ?? ''));
  if (!m) throw new Error('封面不是 PNG data URL');
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  const invalid = () => new Error('封面不是有效 PNG');
  if (buf.length < 45 || !buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || buf.readUInt32BE(8) !== 13 || buf.toString('ascii',12,16) !== 'IHDR') throw invalid();
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024 || size && (width !== size || height !== size)) throw invalid();
  let hasImage = false;
  for (let offset=33; offset+12<=buf.length;) {
    const length = buf.readUInt32BE(offset), end = offset+12+length;
    if (end > buf.length) throw invalid();
    const kind = buf.toString('ascii',offset+4,offset+8);
    if (kind === 'IDAT' && length) hasImage = true;
    if (kind === 'IEND' && !length && hasImage && end === buf.length) return buf;
    offset = end;
  }
  throw invalid();
}
