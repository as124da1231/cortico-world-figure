import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE2D } from '../src/index.ts';
import { MODEL, makeCtx, needModel } from './_ctx.mjs';

needModel();
const tmp = await mkdtemp(join(tmpdir(), 'figure-edit-'));
const cfg = { enabled: true, modelDir: MODEL, figuresDir: join(tmp, 'figures'), workDir: join(tmp, 'figure'), autoDelete: false };
const world = LIVE2D.create(makeCtx(tmp, cfg));
await world.start({});
const inv = (m, a = []) => world.webUi('zh').invoke('workbench', m, a);

const built = await inv('build', [MODEL]);
const id = built.state?.build ? (await inv('list')).builds[0].id : null;
console.log('build id:', id);

console.log('detail  :', JSON.stringify(await inv('detail', [id])));

await inv('edit', [id, {
  nameZh: '测试名字', nameEn: 'Test Name',
  aboutZh: '一句话测试', aboutEn: 'about test',
  bodyGain: 2.4, style: 'calm',
}]);

console.log('detail2 :', JSON.stringify(await inv('detail', [id])));

const list = await inv('list');
console.log('figures :', list.figuresDir.split(/[\\/]/).pop());
console.log('clear   :', (await inv('clearAll', [])).removed);

await world.stop();
await rm(tmp, { recursive: true, force: true });
