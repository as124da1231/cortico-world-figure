/** Local Coo 0.2.17 adapter, outside the extension package. Never run on install. */
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Kept self-contained so exactly this implementation is injected and tested.
export async function mountConfigurationOverride(host, pageId, groupIds, generation, slot, lifecycle) {
  const page = host.find(pageId);
  if (!page?.client) return false;
  let child;
  try {
    const bundle = await host.deps.loader.load(pageId, page.client);
    if (generation !== host.generation || lifecycle.disposed) return true;
    const custom = bundle.configuration;
    if (!custom || typeof custom.mount !== 'function' || !page.panels?.some(panel => panel.id === custom.panelId)) return false;
    child = lifecycle.own(new lifecycle.constructor(host.deps.onError));
    const out = await custom.mount(host.panelContext(pageId, custom.panelId, slot, child, generation, {configGroups: groupIds.join(',')}));
    if (out && typeof out.dispose === 'function') {
      if (generation !== host.generation || child.disposed) out.dispose();
      else child.own(out);
    }
    return true;
  } catch (error) {
    child?.dispose();
    if (generation !== host.generation || lifecycle.disposed) return true;
    host.deps.onError(error);
    slot.replaceChildren();
    return false; // Existing schema view remains available on renderer/load failure.
  }
}

const originalHash = '39821b5d647ff08452e90ac90aa292d1ca0ec21743fe1b698b7603064ca50c8b';
const marker = '/* figure-local-configuration-v1 */';
export function patchLocalHost(source) {
  if (source.includes(marker)) return source;
  if (createHash('sha256').update(source).digest('hex') !== originalHash) throw Error('Unknown Coo console build; refusing to overwrite it.');
  const anchor = 'async showConfig(t,n,o){let{slot:i}=this.ensurePanes(),a=new Ro(this.deps.onError);this.mounted={pageId:t,panelId:rd,lifecycle:a};';
  if (source.split(anchor).length !== 2) throw Error('Configuration entry point is not unique.');
  return source.replace(anchor, anchor + marker + `if(await (${mountConfigurationOverride.toString()})(this,t,n,o,i,a))return;`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [target, output, mode] = process.argv.slice(2);
  if (!target || !output) throw Error('Usage: node scripts/local-config-page.mjs <console/index.js> <preview-output-or-backup-dir> [--apply]');
  const source = await readFile(target, 'utf8');
  const patched = patchLocalHost(source);
  if (mode === '--apply') {
    if (source === patched) { console.log('Local configuration adapter already present.'); }
    else {
      await mkdir(output, {recursive:true});
      const backup = join(output, 'index.js.before-configuration');
      await copyFile(target, backup, 1); // EXCL: never overwrite an earlier recovery copy.
      await writeFile(target, patched);
      console.log('Local configuration adapter applied. Backup: ' + backup);
    }
  } else {
    await mkdir(dirname(output), {recursive:true}); await writeFile(output, patched);
    console.log('Preview console built: ' + output);
  }
}
