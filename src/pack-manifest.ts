import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalPath, childPath, containsPath, packId } from './paths.ts';

type Manifest = Record<string, unknown> & { id: string };
const idPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const optionPattern = /^[a-z0-9]{1,24}$/;
const wordBreak = /[,，、\s【】<>＜＞]/;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hasNames = (value: unknown) => Object.values(record(value) ?? {})
  .some(text => typeof text === 'string' && text.trim());

/** Check the Coo v2 pack contract without importing executable figure code. */
export async function readPackManifest(root: string): Promise<Manifest> {
  const file = join(root, 'figure.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1048576) throw Error('形象清单无效或过大');
  const m = record(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
  if (!m) throw Error('figure.json 必须是对象');
  const id = packId(m.id);
  if (m.manifest !== 2 || m.api !== 2) throw Error('形象清单的 manifest 和 api 必须是 2');
  if (!hasNames(m.name) || !hasNames(m.about)) throw Error('形象清单缺少名称或简介');
  if (typeof m.entry !== 'string' || typeof m.export !== 'string' || !m.export.trim()) throw Error('形象入口或导出名称无效');
  const entry = childPath(root, m.entry);
  const entryInfo = await lstat(entry).catch(() => null);
  if (!entryInfo?.isFile() || entryInfo.isSymbolicLink()
      || !containsPath(await canonicalPath(root), await canonicalPath(entry))) throw Error('形象包内缺少有效的入口文件');
  const checkPath = (path: unknown) => {
    if (path !== undefined) {
      if (typeof path !== 'string') throw Error('形象资源路径无效');
      childPath(root, path);
    }
  };
  checkPath(m.thumb); checkPath(m.model);
  const axes = new Map<string, Set<string>>();
  for (const value of Array.isArray(m.axes) ? m.axes : []) {
    const axis = record(value);
    if (!axis || typeof axis.id !== 'string' || !idPattern.test(axis.id) || axes.has(axis.id)
        || !hasNames(axis.name) || !Array.isArray(axis.options) || !axis.options.length) throw Error('形象装扮栏位无效');
    const options = new Set<string>();
    for (const item of axis.options) {
      const option = record(item);
      if (!option || typeof option.id !== 'string' || !optionPattern.test(option.id) || options.has(option.id)
          || !hasNames(option.name)) throw Error('形象装扮选项无效');
      options.add(option.id); checkPath(option.thumb);
    }
    axes.set(axis.id, options);
  }
  for (const value of Array.isArray(m.presets) ? m.presets : []) {
    const preset = record(value), pick = record(preset?.pick);
    if (typeof preset?.id !== 'string' || !idPattern.test(preset.id) || !pick
        || [...axes].some(([axis, options]) => typeof pick[axis] !== 'string' || !options.has(pick[axis]))) throw Error('形象装扮预设无效');
  }
  if (!Array.isArray(m.vocab)) throw Error('形象清单缺少动作词表');
  const seen = new Set<string>();
  for (const value of m.vocab) {
    const word = record(value);
    if (!word || typeof word.id !== 'string' || !idPattern.test(word.id)) throw Error('动作词 ID 无效');
    if (word.kind !== 'expression' && word.kind !== 'motion') continue;
    const names = Object.values(record(word.names) ?? {});
    if (names.some(list => !Array.isArray(list))) throw Error('动作词别名无效');
    if (!hasNames(word.about) || typeof word.seconds !== 'number' || !Number.isFinite(word.seconds) || word.seconds <= 0) throw Error('动作词缺少说明或时长无效');
    for (const name of [word.id, ...names.flat()]) {
      if (typeof name !== 'string' || !name || name.length > 32 || wordBreak.test(name) || seen.has(name)) throw Error('动作词别名无效或重复');
      seen.add(name);
    }
  }
  return {...m, id};
}
