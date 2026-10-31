import { createHash } from 'node:crypto';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const pkgFile = join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgFile, 'utf8'));
const keep = new Set();

for (const [extension, field] of [['js', 'webUiClient'], ['css', 'webUiStyle']]) {
  const bytes = Buffer.from((await readFile(join(dist, `webui.${extension}`), 'utf8')).replace(/\r\n/g, '\n'));
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
