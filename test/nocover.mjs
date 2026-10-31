import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE2D } from '../src/index.ts';
import { MODEL, makeCtx, needModel, prepareWorld } from './_ctx.mjs';

needModel();
const tmp = await mkdtemp(join(tmpdir(), 'figure-nocover-'));
const cfg = { enabled: true, modelDir: MODEL, figuresDir: join(tmp, 'figures'), workDir: join(tmp, 'figure'), autoDelete: false, cover: false };
const world = LIVE2D.create(makeCtx(tmp, cfg));
await prepareWorld(world, cfg.workDir);
const inv = (m, a = []) => world.webUi('zh').invoke('workbench', m, a);

const r = await inv('build', [MODEL]);
console.log('warn   :', r.warn);
console.log('lamp   :', world.webUi('zh').lamps[1].hint);

const list = await inv('list');
console.log('thumb? :', Boolean(list.builds[0]?.thumb), '| cover', list.builds[0]?.cover);

const packs = join(tmp, 'figure', 'builds');
console.log('packs  :', (await readdir(packs).catch(() => [])).length);

await world.stop();
await rm(tmp, { recursive: true, force: true });
