import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPack } from '../src/pipeline.ts';
import { captureCover } from '../src/cover.ts';
import { MODEL, needModel } from './_ctx.mjs';

needModel();
const wb = join(import.meta.dirname, '..', 'workbench');
const out = await mkdtemp(join(tmpdir(), 'figure-cover-'));

console.time('build');
const pack = await buildPack(wb, MODEL, out);
console.timeEnd('build');

console.time('cover');
const r = await captureCover(pack, wb);
console.timeEnd('cover');
console.log('cover:', r);

for (const f of ['thumb/cover.png', 'thumb/opt-model.png']) {
  try {
    const s = await stat(join(pack, f));
    console.log(f, s.size, 'bytes');
  } catch {
    console.log(f, 'MISSING');
  }
}

await rm(out, { recursive: true, force: true });
