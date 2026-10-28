import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { PackImporter, filesFromZip } from '../src/import.ts';

/** 把一份打包产物打成 zip，外面套一层目录，模拟从 GitHub 下载的压缩包。 */
async function zipPack(packDir, rootName) {
  const entries = {};
  const walk = async (dir, rel) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, at);
      else entries[`${rootName}/${at}`] = new Uint8Array(await readFile(full));
    }
  };
  await walk(packDir, '');
  return zipSync(entries, { level: 1 });
}

const SRC = process.argv[2];
if (!SRC) {
  console.log('skip: 用法 node test/import.mjs <一份打包产物的目录>');
  process.exit(0);
}

const tmp = await mkdtemp(join(tmpdir(), 'figure-import-'));
const figures = join(tmp, 'figures');
try {
  const zip = await zipPack(SRC, 'downloaded-pack');
  console.log('zip     :', (zip.length / 1048576).toFixed(1), 'MB');

  const files = filesFromZip(zip);
  if (typeof files === 'string') throw new Error(files);
  console.log('files   :', files.length);

  const importer = new PackImporter();
  const staged = await importer.stage(files, false, new Map());
  if ('error' in staged) throw new Error(staged.error);
  console.log('staged  :', staged.packs.map((p) => `${p.id} v${p.version} ${(p.bytes / 1048576).toFixed(1)}MB thumb=${Boolean(p.thumb)}`));
  console.log('problems:', staged.problems);

  const first = staged.packs[0];
  const out = await importer.install(staged.token, [first.dir], [], { figuresDir: figures, backupRoot: join(tmp, 'backups') });
  if ('error' in out) throw new Error(out.error);
  if ('conflicts' in out) throw new Error('unexpected conflicts');
  console.log('installed:', out.installed.map((x) => x.id));

  const installedDir = join(figures, first.id);
  const manifest = JSON.parse(await readFile(join(installedDir, 'figure.json'), 'utf8'));
  console.log('figure  :', manifest.id, '|', manifest.name?.zh, '| files', (await readdir(installedDir)).length);

  // 再装一次，应报冲突
  const again = new PackImporter();
  const staged2 = await again.stage(files, false, new Map([[first.id, manifest.version]]));
  if ('error' in staged2) throw new Error(staged2.error);
  const blocked = await again.install(staged2.token, [first.dir], [], { figuresDir: figures });
  console.log('conflict:', 'conflicts' in blocked ? blocked.conflicts : blocked);
  const ok = await again.install(staged2.token, [first.dir], [first.id], { figuresDir: figures, backupRoot: join(tmp, 'backups') });
  console.log('replace :', 'installed' in ok ? ok.installed.map((x) => x.id) : ok);
  console.log('backups :', (await readdir(join(tmp, 'backups'))).length);
  console.log('size    :', ((await stat(installedDir)).isDirectory() ? 'dir' : '?'));
} finally {
  await rm(tmp, { recursive: true, force: true });
}
