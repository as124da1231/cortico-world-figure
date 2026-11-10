import { createHash } from 'node:crypto';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const source = join(root, 'src', 'webui');
const pkgFile = join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
const keep = new Set();

for (const [extension, field] of [['js', 'webUiClient'], ['css', 'webUiStyle']]) {
  const content=await readFile(join(source, extension === 'js' ? 'client.js' : 'styles.css'),'utf8');
  const shared = extension === 'js' ? (await Promise.all([
    join(root, 'src', 'gear-appearance.mjs'),
    join(root, 'workbench', 'tools', 'emotion-effect.mjs'),
    join(root, 'src', 'voice-catalog.mjs'),
    join(root, 'src', 'voice-settings.mjs'),
    join(root, 'workbench', 'pack', 'backends', 'wardrobe-slots.js'),
    join(root, 'workbench', 'pack', 'backends', 'crop-config.js'),
    join(root, 'workbench', 'pack', 'backends', 'gaze-config.js'),
    join(source, 'manual.js'),
    join(source, 'voice.js'),
    join(source, 'effect-previews.js'),
    join(source, 'effects.js'),
    join(source, 'crop-editor.js'),
  ].map(file => readFile(file, 'utf8')))).map(code => code.replace(/^export /gm, '')).join('\n') + '\n' : '';
  const version = extension === 'js' ? `const FIGURE_UI_VERSION = ${JSON.stringify(pkg.version)};\n` : '';
  const bytes = Buffer.from((version + shared + content).replace(/\r\n/g, '\n'));
  await writeFile(join(dist, `webui.${extension}`), bytes);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const name = `webui-${hash}.${extension}`;
  await writeFile(join(dist, name), bytes);
  pkg.cortico[field] = `dist/${name}`;
  keep.add(name);
}
for (const name of await readdir(dist)) {
  if (/^webui-[a-f0-9]{12}\.(js|css)$/.test(name) && !keep.has(name)) await unlink(join(dist, name));
}
await writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.error(`UI assets: ${[...keep].join(', ')}`);
