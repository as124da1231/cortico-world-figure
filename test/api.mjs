import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE2D } from '../src/index.ts';
import { MODEL, makeCtx, needModel, prepareWorld } from './_ctx.mjs';

needModel();
const tmp = await mkdtemp(join(tmpdir(), 'figure-api-'));
const cfg = { enabled: true, modelDir: MODEL, figuresDir: join(tmp, 'figures'), workDir: join(tmp, 'figure'), autoDelete: false };
const world = LIVE2D.create(makeCtx(tmp, cfg));
await prepareWorld(world, cfg.workDir);
const inv = (m, a = []) => world.webUi('zh').invoke('workbench', m, a);

await inv('setDir', [MODEL]);
await inv('build');
let list = await inv('list');
console.log('builds   :', list.builds.length, '| thumb?', Boolean(list.builds[0]?.thumb), '| auto', list.autoDelete);

await inv('install', [MODEL, list.builds[0].id]);
console.log('installed:', (await inv('list')).installed?.target?.split(/[\\/]/).pop());

await inv('setAuto', [true]);
console.log('auto     :', (await inv('list')).autoDelete);

await inv('build');
list = await inv('list');
console.log('builds #2:', list.builds.length);
await inv('install', [MODEL, list.builds[0].id]);
list = await inv('list');
console.log('after auto-delete install:', list.builds.length);

console.log('dirs left:', (await readdir(join(tmp, 'figure', 'builds')).catch(() => [])).length);
console.log('figures  :', await readdir(join(tmp, 'figures')).catch(() => []));

await world.stop();
await rm(tmp, { recursive: true, force: true });
