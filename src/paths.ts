import { isAbsolute, relative, resolve, sep } from 'node:path';

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
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value)) {
    throw new Error('figure.json 的 id 必须是 1–80 位字母、数字、下划线或连字符');
  }
  childPath('.', value);
  return value;
}
