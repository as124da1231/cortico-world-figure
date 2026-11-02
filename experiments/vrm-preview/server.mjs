import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { buildApp, previousWorkbench, root } from './build.mjs';

await buildApp();
const sample = process.env.VRM_SAMPLE || join(previousWorkbench, '.workbench/src/aldina.vrm');
const port = Number(process.env.VRM_PREVIEW_PORT || 4783);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效端口');
const address = `http://127.0.0.1:${port}`;
const files = new Map([
  ['/', [join(root, 'index.html'), 'text/html; charset=utf-8']],
  ['/index.html', [join(root, 'index.html'), 'text/html; charset=utf-8']],
  ['/file-entry.js', [join(root, 'file-entry.js'), 'text/javascript; charset=utf-8']],
  ['/style.css', [join(root, 'style.css'), 'text/css; charset=utf-8']],
  ['/app.js', [join(root, '.local/app.js'), 'text/javascript; charset=utf-8']],
  ['/licenses', [join(root, '.local/THIRD_PARTY_LICENSES.txt'), 'text/plain; charset=utf-8']],
  ['/sample.vrm', [sample, 'model/gltf-binary']],
  ...['idle.vrma', 'idle-2.vrma', 'idle-3.vrma'].map(name => [`/animations/${name}`, [join(root, 'assets/animations/overte', name), 'model/gltf-binary']]),
]);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob: data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== address) || req.headers['sec-fetch-site'] === 'cross-site') {
    res.writeHead(403).end('Local preview only'); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  const url = new URL(req.url, address);
  if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (url.pathname === '/api/info') {
    let sampleInfo = null;
    try { const s = await stat(sample); if (s.isFile()) sampleInfo = { name: basename(sample), bytes: s.size }; } catch { /* Optional sample. */ }
    const body = JSON.stringify({ app: 'coo-vrm-preview', sample: sampleInfo });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(req.method === 'HEAD' ? undefined : body); return;
  }
  const resource = files.get(url.pathname);
  if (!resource) { res.writeHead(404).end('Not found'); return; }
  try {
    const s = await stat(resource[0]);
    res.writeHead(200, { 'Content-Type': resource[1], 'Content-Length': s.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(resource[0]).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404).end('Local resource not found'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(root, '.local/run.json'), JSON.stringify({ pid: process.pid, url: address, started: new Date().toISOString() }, null, 2));
  console.log(`3D 独立预览：${address}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
