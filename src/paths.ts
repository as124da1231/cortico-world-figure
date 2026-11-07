import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

/** Keep imported paths portable, including on Windows (devices, ADS and aliases). */
export function childPath(root: string, path: string): string {
  const parts = path.split(/[\\/]/);
  if (!path || isAbsolute(path) || parts.some((p) => !p || p === '.' || p === '..'
    || /[<>:"|?*\u0000-\u001f]/.test(p) || /[. ]$/.test(p)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error(`路径不合法：${path}`);
  }
  const full = resolve(root, ...parts);
  const rel = relative(resolve(root), full);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`路径超出目录：${path}`);
  }
  return full;
}

export function packId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value) || value === 'coo') {
    throw new Error('figure.json 的 id 必须是 1–32 位小写字母、数字或连字符，不能使用内置 id coo');
  }
  childPath('.', value);
  return value;
}

export function containsPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

/** Resolve existing ancestors too when the destination has yet to be created. */
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || absolute === dirname(absolute)) throw error;
    return join(await canonicalPath(dirname(absolute)), basename(absolute));
  }
}
