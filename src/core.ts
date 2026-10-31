/**
 * Live2D Cubism Core 的获取。
 *
 * 扩展**不随包分发** Core（专有许可）。用户明确同意后，从 Live2D Inc. 官方托管地址
 * 取同一份文件，校验长度与 SHA-256，再落到本地缓存；打包时从缓存拷进形象包。
 *
 * 官方下载页把「Cubism Core for Web — for hosting use」的地址直接列出来供复制，
 * 这里用的是其中固定到 Cubism 5.3 的那条，避开 latest 漂移。
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { join } from 'node:path';

export const CORE_FILE = 'live2dcubismcore.min.js';

/** 官方托管地址：主用固定到 Cubism 5.3 的路径，备用 latest。 */
export const CORE_URLS = [
  'https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js',
  'https://cubism.live2d.com/sdk-web/core/live2dcubismcore.min.js',
];

/** 下载页上的版本标签。 */
export const CORE_VERSION = 'Cubism 5.3';
/** 官方下载页（许可与手动获取入口）。 */
export const CORE_HOME = 'https://www.live2d.com/en/sdk/download/web/';
/** 已知良好版本的长度与摘要（与官方托管文件逐字节一致）。 */
export const CORE_BYTES = 228042;
export const CORE_SHA256 = '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47';

/** 许可原文在扩展里的位置（随包分发，不含 Core 本体）。 */
export const LICENSE_FILES = {
  core: 'LICENSE-live2d-core.txt',
  sdk: 'LICENSE-live2d-components.txt',
};

export interface CoreState {
  /** 缓存里有、且校验通过。 */
  ok: boolean;
  /** 缓存里有文件。 */
  present: boolean;
  bytes: number;
  sha256: string;
  /** 期望的版本标签。 */
  version: string;
  /** 文件里的实际摘要与期望不一致时的说明。 */
  note: string;
  file: string;
}

export const coreFile = (dir: string): string => join(dir, CORE_FILE);

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** 读缓存里的 Core 并校验；文件不在或对不上都给 ok:false。 */
export async function coreState(dir: string): Promise<CoreState> {
  const file = coreFile(dir);
  const base = { present: false, bytes: 0, sha256: '', version: CORE_VERSION, note: '', file };
  if (!existsSync(file)) return { ...base, ok: false };
  try {
    const buf = await readFile(file);
    const digest = sha256(buf);
    const bytes = (await stat(file)).size;
    const match = digest === CORE_SHA256;
    return {
      ok: match,
      present: true,
      bytes,
      sha256: digest,
      version: CORE_VERSION,
      note: match ? '' : `摘要与已知 ${CORE_VERSION} 不一致`,
      file,
    };
  } catch (e) {
    return { ...base, ok: false, present: true, note: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** 单次 GET，跟三层以内的重定向。 */
function fetchOnce(url: string, redirects = 4): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { 'user-agent': 'cortico-world-figure' } }, (res) => {
      const code = res.statusCode ?? 0;
      const location = res.headers.location;
      if (code >= 300 && code < 400 && location) {
        res.resume();
        if (redirects <= 0) { reject(new Error('重定向次数过多')); return; }
        fetchOnce(new URL(location, url).toString(), redirects - 1).then(resolve, reject);
        return;
      }
      if (code !== 200) { res.resume(); reject(new Error(`HTTP ${code}`)); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      res.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > CORE_BYTES) { req.destroy(new Error('核心下载超过预期大小')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('下载超时')));
  });
}

/**
 * 从官方地址取 Core、校验、原子写入缓存。
 * 任何一步失败都抛错，并且不留下半截文件。
 */
export async function ensureCore(
  dir: string,
  say: (line: string) => void = () => {},
): Promise<CoreState> {
  const existing = await coreState(dir);
  if (existing.ok) return existing;

  await mkdir(dir, { recursive: true });
  const target = coreFile(dir);
  const tmp = `${target}.part`;

  let lastError = '';
  for (const url of CORE_URLS) {
    try {
      say(`下载 Live2D 核心组件 · ${new URL(url).host}`);
      const buf = await fetchOnce(url);
      if (buf.length !== CORE_BYTES) {
        lastError = `长度不符：${buf.length} ≠ ${CORE_BYTES}`;
        say(`! ${lastError}`);
        continue;
      }
      const digest = sha256(buf);
      if (digest !== CORE_SHA256) {
        lastError = `摘要不符：${digest.slice(0, 12)}… ≠ ${CORE_SHA256.slice(0, 12)}…`;
        say(`! ${lastError}`);
        continue;
      }
      await writeFile(tmp, buf);
      await rename(tmp, target);
      const state = await coreState(dir);
      if (!state.ok) throw new Error('写入后校验失败');
      say(`核心已就绪 · ${CORE_VERSION} · ${(state.bytes / 1024).toFixed(0)} KB`);
      return state;
    } catch (e) {
      lastError = String((e as Error)?.message ?? e).slice(0, 200);
      say(`! 取 Core 失败：${lastError}`);
    }
  }

  await rm(tmp, { force: true }).catch(() => {});
  throw new Error(`没能从 Live2D 官方地址取到核心组件：${lastError || '未知原因'}`);
}
