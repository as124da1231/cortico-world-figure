import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export const root = dirname(fileURLToPath(import.meta.url));
export const previousWorkbench = String.raw`G:\000000000AAII\0cortico 形象 插件\cortico工作台3d简易版本`;

export async function buildApp() {
  const candidates = [process.env.VRM_ENGINE_ROOT, root, previousWorkbench].filter(Boolean);
  let dependencies;
  for (const candidate of candidates) {
    try {
      const modules = join(resolve(candidate), 'node_modules');
      for (const [name, version] of [['three', '0.180.0'], ['@pixiv/three-vrm', '3.4.2'], ['esbuild', '0.25.10']]) {
        const manifest = JSON.parse(await readFile(join(modules, name, 'package.json'), 'utf8'));
        if (manifest.version !== version) throw new Error(`${name} version mismatch`);
      }
      dependencies = modules;
      break;
    } catch { /* Try the next existing installation without changing it. */ }
  }
  if (!dependencies) throw new Error('缺少同版本依赖。请在本试验台目录 npm install，或设置 VRM_ENGINE_ROOT。');
  const require = createRequire(join(dependencies, '_resolver.cjs'));
  const { build } = require('esbuild');
  await mkdir(join(root, '.local'), { recursive: true });
  await build({
    entryPoints: [join(root, 'src/app.js')], outfile: join(root, '.local/app.js'),
    nodePaths: [dependencies], bundle: true, format: 'esm', platform: 'browser',
    target: 'chrome120', minify: true, legalComments: 'eof', logLevel: 'warning',
  });
  const licenses = [];
  for (const name of ['three', '@pixiv/three-vrm']) {
    licenses.push(`${name}\n${await readFile(join(dependencies, name, 'LICENSE'), 'utf8')}`);
  }
  await writeFile(join(root, '.local/THIRD_PARTY_LICENSES.txt'), licenses.join('\n\n'), 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildApp();
  console.log('3D 预览构建完成。');
}
