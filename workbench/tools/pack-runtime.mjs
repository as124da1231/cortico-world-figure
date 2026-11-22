import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';

const commonBackends = [
  'live2d.js', 'native-actions.js', 'native-combination.js', 'wardrobe.js', 'wardrobe-slots.js',
  'render-config.js', 'render-quality.js', 'role-values.js', 'soullink.js', 'voice-playback.js',
  'body-crop.js', 'crop-config.js', 'gaze-config.js', 'performance-plan.js',
];

export function packBackends(format) {
  return [
    ...commonBackends,
    ...(format === 'live2d' ? [] : ['bongo.js']),
    ...(format === 'bongocat' ? [] : ['performance-playback.js']),
  ];
}

/** Keep SoulLink's module layout and license while reducing the generated copy. */
export async function writePackSoulLink(runtime, pack) {
  const source = join(runtime, 'vendor', 'soullink');
  const target = join(pack, 'vendor', 'soullink');
  await mkdir(target, {recursive:true});
  for (const name of await readdir(source)) {
    const original = join(source,name);
    if (!(await stat(original)).isFile()) continue;
    const destination = join(target,name);
    if (name.endsWith('.js')) {
      const bytes = await readFile(original);
      const {code} = await transform(bytes.toString('utf8'), {
        loader:'js', sourcefile:name, minify:true, keepNames:true, legalComments:'inline',
      });
      const compact = Buffer.from('// Minified for this Figure pack. See LICENSE and README.md.\n' + code);
      await writeFile(destination, compact.length < bytes.length ? compact : bytes);
    } else await copyFile(original,destination);
  }
}
