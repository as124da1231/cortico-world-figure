import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIVE2D } from '../src/index.ts';
import { MODEL, makeCtx, needModel, prepareWorld } from './_ctx.mjs';

const dir = needModel();
const tmp = await mkdtemp(join(tmpdir(), 'figure-panel-'));
const cfg = { enabled: true, modelDir: '', figuresDir: join(tmp, 'figures'), workDir: join(tmp, 'figure') };
const world = LIVE2D.create(makeCtx(tmp, cfg));
await prepareWorld(world, cfg.workDir);
const { invoke } = world.webUi('zh');

const show = (tag, r) => {
  const s = r.state ?? r;
  console.log(tag, JSON.stringify({
    dir: s.dir?.split(/[\\/]/).pop(),
    scan: s.scan && `${s.scan.params}/${s.scan.roles}`,
    build: s.build && `${(s.build.bytes / 1048576).toFixed(1)}MB words=${s.build.words} cover=${s.build.cover} fit=${s.build.fit}`,
    install: s.install?.target?.split(/[\\/]/).pop(),
  }));
  for (const line of r.log ?? []) console.log('   ', line);
};

show('state  ', await invoke('workbench', 'state', []));
show('setDir ', await invoke('workbench', 'setDir', [dir]));
show('scan   ', await invoke('workbench', 'scan', [dir]));
show('build  ', await invoke('workbench', 'build', [dir]));
show('install', await invoke('workbench', 'install', [dir]));

const ui = world.webUi('zh');
console.log('lamps  :', ui.lamps.map((l) => `${l.label}:${l.state}(${l.hint})`).join(' | '));
console.log('panels :', JSON.stringify(ui.panels));
console.log('config :', ui.config?.[0]?.id, Object.keys(ui.config?.[0]?.schema?.properties ?? {}));

await world.stop();
await rm(tmp, { recursive: true, force: true });
