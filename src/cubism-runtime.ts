import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { coreState, ensureCore, fetchRuntimeFile } from './core.ts';

// Live2D/CubismWebFramework release 5-r.5. Build only the modules Figure imports.
const REVISION = '198a3769c26ca3d7b600e932590433badd392edd';
const FRAMEWORK_URL = `https://codeload.github.com/Live2D/CubismWebFramework/zip/${REVISION}`;
const ARCHIVE_BYTES = 214305;
const ARCHIVE_SHA = 'f88f0132fc160b63bb633c869e5332c07498e778303cb1f26db8d4dba9a467cb';
const SHADERS_HEADER = '// Generated locally from Live2D Cubism Web Framework shaders.\n';
const files = ['framework.js', 'shaders.js'] as const;
const legacy = [
  'fc7e3740acecc341155e75eb2494343474462a8ad8cb1eeac68b618a744c9f0c',
  'c2420f2873289bd3323a8e350ec044c3dd18d0d8be3ea9b57880ca49d56250ea',
];
const current = ['13683d9ba99763096b2472799038cc64c597e4d1591747cdcbe92f1f8b8902b1', '66d952aa141da40eb99597f52d6c43208eaaa307001d31e423c87c4a6932c3a5'];
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const matches = (data: readonly Uint8Array[], hashes: readonly string[]) =>
  data.length === files.length && data.every((bytes, index) => sha256(Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'))) === hashes[index]);

async function readFramework(dir: string) {
  try {
    const paths = files.map(file => join(dir, file));
    const stats = await Promise.all(paths.map(file => stat(file)));
    if (stats.some(info => !info.isFile() || info.size > 256 * 1024)) return null;
    const data = await Promise.all(paths.map(file => readFile(file)));
    if (matches(data, legacy) || matches(data, current)) return data;
  } catch { /* A missing or unreadable cache can be recovered. */ }
  return null;
}

export async function cubismRuntimeState(dir: string) {
  const [core, framework] = await Promise.all([coreState(dir), readFramework(dir)]);
  return {
    ...core,
    ok: core.ok && framework !== null,
    bytes: core.bytes + (framework?.reduce((size, part) => size + part.length, 0) ?? 0),
    note: core.note || (framework ? '' : 'Live2D Framework 尚未准备好'),
  };
}

/** Pure inputs come from one pinned, verified official archive. Never run its scripts. */
export async function compileCubismFramework(archive: Uint8Array, cache: string) {
  if (archive.length !== ARCHIVE_BYTES || sha256(archive) !== ARCHIVE_SHA) {
    throw new Error('Live2D Framework 官方源码包校验失败');
  }
  const prefix = `CubismWebFramework-${REVISION}/`;
  const sourcePath = /^src\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.ts$/i;
  const shaderPath = /^Shaders\/WebGL\/[a-z0-9_-]+\.(?:frag|vert)$/i;
  const entries = unzipSync(archive, {
    filter: ({name}) => name.startsWith(prefix)
      && (sourcePath.test(name.slice(prefix.length)) || shaderPath.test(name.slice(prefix.length))),
  });
  const dir = await mkdtemp(join(cache, 'framework-build-'));
  try {
    const shaders: Record<string, string> = {};
    for (const name of Object.keys(entries).sort()) {
      const relative = name.slice(prefix.length);
      const source = Buffer.from(entries[name]).toString('utf8').replace(/\r\n/g, '\n');
      if (shaderPath.test(relative)) {
        shaders[relative.slice('Shaders/WebGL/'.length)] = source;
      } else {
        const file = join(dir, relative);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, source);
      }
    }
    if (Object.keys(shaders).length !== 13) throw new Error('Live2D Framework 着色器不完整');
    const result = await build({
      absWorkingDir: dir,
      stdin: {
        resolveDir: dir,
        contents: [
          "export { CubismFramework } from './src/live2dcubismframework';",
          "export { CubismMatrix44 } from './src/math/cubismmatrix44';",
          "export { CubismModelSettingJson } from './src/cubismmodelsettingjson';",
          "export { CubismShaderManager_WebGL } from './src/rendering/cubismshader_webgl';",
          "export { CubismUserModel } from './src/model/cubismusermodel';",
        ].join('\n'),
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      minify: true,
      banner: { js: '// Copyright(c) Live2D Inc. Compiled locally from CubismWebFramework 5-r.5. See LICENSE-live2d-components.txt.' },
      legalComments: 'inline',
    });
    return [Buffer.from(result.outputFiles[0].contents),
      Buffer.from(SHADERS_HEADER + 'export const SHADERS = ' + JSON.stringify(shaders) + ';\n')];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeFramework(dir: string, data: readonly Uint8Array[]) {
  for (const [index, file] of files.entries()) {
    const target = join(dir, file);
    const temporary = `${target}.${randomUUID()}.part`;
    try {
      await writeFile(temporary, data[index], {flag: 'wx'});
      await rename(temporary, target);
    } finally {
      await rm(temporary, {force: true});
    }
  }
}

export async function restoreCubismFramework(dir: string, previous: readonly string[]) {
  if (await readFramework(dir)) return true;
  for (const candidate of new Set(previous)) {
    const data = await readFramework(candidate);
    if (!data) continue;
    await mkdir(dir, { recursive: true });
    await writeFramework(dir, data);
    return true;
  }
  return false;
}

export async function ensureCubismRuntime(dir: string, previous: readonly string[], say: (line: string) => void) {
  await ensureCore(dir, say);
  if (!await restoreCubismFramework(dir, previous)) {
    say('从 Live2D 官方仓库获取 Web Framework…');
    const archive = await fetchRuntimeFile(FRAMEWORK_URL, ARCHIVE_BYTES);
    const data = await compileCubismFramework(archive, dir);
    if (!matches(data, current)) throw new Error('Live2D Framework 本机构建校验失败');
    await writeFramework(dir, data);
  }
  const state = await cubismRuntimeState(dir);
  if (!state.ok) throw new Error('Live2D 运行组件写入后校验失败');
  return state;
}
