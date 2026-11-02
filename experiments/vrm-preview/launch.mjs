import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VRM_PREVIEW_PORT || 4783);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效端口');
const address = `http://127.0.0.1:${port}/`;

async function probe() {
  try {
    const response = await fetch(`${address}api/info`, { signal: AbortSignal.timeout(1000) });
    const info = await response.json().catch(() => null);
    return response.ok && info?.app === 'coo-vrm-preview' ? 'ready' : 'occupied';
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return 'missing';
    return 'occupied';
  }
}

try {
  const initial = await probe();
  if (initial === 'occupied') throw new Error(`${port} 端口被其他服务占用。请设置 VRM_PREVIEW_PORT 后重试。`);
  if (initial !== 'ready') {
    await mkdir(join(root, '.local'), { recursive: true });
    const log = await open(join(root, '.local/server.log'), 'a');
    const errorLog = await open(join(root, '.local/server-error.log'), 'a');
    let child;
    try {
      child = spawn(process.execPath, [join(root, 'server.mjs')], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, errorLog.fd],
      });
    } finally { await log.close(); await errorLog.close(); }
    let failure;
    child.on('error', error => { failure = error.message; });
    child.on('exit', code => { if (code !== 0) failure = `预览服务退出（${code}）。`; });
    child.unref();
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      if (failure) throw new Error(failure);
      const status = await probe();
      if (status === 'ready') { ready = true; break; }
      if (status === 'occupied') throw new Error(`${port} 端口响应不是本试验台。`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('启动超时。详细错误见 .local/server-error.log。');
  }
  console.log(`3D 预览已就绪：${address}`);
  if (!process.argv.includes('--no-open')) {
    const opener = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const browser = spawn(opener, [address], { detached: true, windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.error(`未能自动打开浏览器，请手动打开 ${address}`));
    browser.unref();
  }
} catch (error) {
  console.error(`无法启动 3D 预览：${error.message}`);
  process.exitCode = 1;
}
