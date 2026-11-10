import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalPath, childPath, containsPath, packId } from './paths.ts';

type Manifest = Record<string, unknown> & { id: string };
const idPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const optionPattern = /^[a-z0-9]{1,24}$/;
const wordBreak = /[,，、\s【】<>＜＞]/;
const soundName = /^[a-z][a-zA-Z0-9-]{0,31}$/;
const moveParam = /^[a-z][a-zA-Z0-9]{0,23}$/;
const defaultMoves = new Set(['left', 'center', 'right', 'cursor']);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const hasNames = (value: unknown) => Object.values(record(value) ?? {})
  .some(text => typeof text === 'string' && text.trim());

/** Figure manifests produced by Windows tools may start with a UTF-8 BOM. */
export function parseFigureJson(text: string) {
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

/** Check the Coo v2 pack contract without importing executable figure code. */
export async function readPackManifest(root: string): Promise<Manifest> {
  const file = join(root, 'figure.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1048576) throw Error('形象清单无效或过大');
  const m = record(parseFigureJson(await readFile(file, 'utf8')));
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
    if (word.names != null && !record(word.names)) throw Error('动作词别名无效');
    const names = Object.values(record(word.names) ?? {});
    if (names.some(list => !Array.isArray(list))) throw Error('动作词别名无效');
    if (!hasNames(word.about) || typeof word.seconds !== 'number' || !Number.isFinite(word.seconds) || word.seconds <= 0) throw Error('动作词缺少说明或时长无效');
    for (const name of [word.id, ...names.flat()]) {
      if (typeof name !== 'string' || !name || name.length > 32 || wordBreak.test(name) || seen.has(name)) throw Error('动作词别名无效或重复');
      seen.add(name);
    }
  }
  if (m.needs !== undefined && !Array.isArray(m.needs)) throw Error('needs 应为数组');
  if (m.sounds !== undefined) {
    const sounds = record(m.sounds);
    if (!sounds) throw Error('sounds 应为对象');
    for (const [key, value] of Object.entries(sounds)) {
      const sound = record(value);
      if (!soundName.test(key) || typeof sound?.file !== 'string') throw Error('形象音效无效');
      checkPath(sound.file);
      if (sound.volume !== undefined && (typeof sound.volume !== 'number' || !(sound.volume >= 0 && sound.volume <= 1))) {
        throw Error('形象音效音量无效');
      }
    }
  }
  if (m.moves !== undefined) {
    if (!Array.isArray(m.moves) || m.moves.length > 8) throw Error('形象移动目标无效或过多');
    const moves = new Set<string>();
    for (const value of m.moves) {
      const move = record(value);
      const moveId = move?.id;
      if (typeof moveId !== 'string' || !idPattern.test(moveId) || moves.has(moveId) || defaultMoves.has(moveId)
          || Number.isFinite(Number(moveId)) || !hasNames(move?.name) || !hasNames(move?.about)) throw Error('形象移动目标无效');
      moves.add(moveId);
      const params = move?.params ?? [];
      if (!Array.isArray(params) || params.length > 2) throw Error('形象移动参数无效');
      const names = new Set<string>();
      for (const value of params) {
        const param = record(value);
        const paramId = param?.id;
        if (typeof paramId !== 'string' || !moveParam.test(paramId) || names.has(paramId) || !hasNames(param?.about)
            || typeof param?.min !== 'number' || typeof param?.max !== 'number'
            || !Number.isFinite(param.min) || !Number.isFinite(param.max) || param.min >= param.max) throw Error('形象移动参数无效');
        names.add(paramId);
      }
    }
  }
  return {...m, id};
}
