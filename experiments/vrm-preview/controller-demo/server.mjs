import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url)), dist = join(root, 'dist');
const sample = process.env.VRM_SAMPLE || String.raw`G:\000000000AAII\0cortico 形象 插件\cortico工作台3d简易版本\.workbench\src\aldina.vrm`;
const port = Number(process.env.VRM_CONTROLLER_PORT || 4785);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效端口');
await stat(join(dist, 'index.html'));
const address = `http://127.0.0.1:${port}`, types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:; worker-src 'self' blob:; font-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== address) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, address).pathname);
    if (pathname === '/api/info') { const s = await stat(sample).catch(() => null); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ app: 'coo-vrm-locomotion-reference', sample: s ? { name: basename(sample), bytes: s.size } : null, upstream: 'norio/vrm-game-starter@b14c236' })); return; }
    const file = pathname === '/local-sample.vrm' ? sample : resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== sample && (!file.startsWith(dist + sep) || pathname.includes('\0'))) { res.writeHead(403).end(); return; }
    const s = await stat(file); if (!s.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': file === sample ? 'model/gltf-binary' : types[extname(file)] || 'application/octet-stream', 'Content-Length': s.size });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end('Local resource not found'); }
});
server.listen(port, '127.0.0.1', async () => { await mkdir(join(root, '.local'), { recursive: true }); await writeFile(join(root, '.local/run.json'), JSON.stringify({ pid: process.pid, url: address })); console.log(`成品行走试验：${address}`); });
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
