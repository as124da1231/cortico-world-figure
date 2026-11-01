import {createHash} from 'node:crypto';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
export const ORIGINAL_HASH='36fbb7e17876d1421bb2b1d90ec8faed0984e81f331ee3a0d3a014bca25e1689';
export function patchPreviewHost(source){
  if(source.includes('/* figure-local-preview-v1 */'))return source;
  if(createHash('sha256').update(source).digest('hex')!==ORIGINAL_HASH)throw Error('Unknown Coo main build; refusing to patch.');
  const anchor='  if (url.origin !== petOrigin && url.origin !== await learnPetOrigin()) return refused();';
  if(source.split(anchor).length!==2)throw Error('Preview forwarding anchor is not unique.');
  const patched=source.replace(anchor,`  /* figure-local-preview-v1 */
  if (url.pathname.startsWith('/figure-preview/')) {
    const preview = require('./figure-preview.cjs');
    return preview.allows(request, coreOrigin()) ? forward(preview.clean(request), url, from || 'null') : refused();
  }
${anchor}`);
  const startup='  void core.start();\n});';
  if(patched.split(startup).length!==2)throw Error('Startup anchor is not unique.');
  return patched.replace(startup,`  // One-shot route restoration for this local adapter's application restart.
  const resumeArg = process.argv.find(value => value.startsWith('--figure-preview-resume='));
  if (resumeArg) {
    const route = decodeURIComponent(resumeArg.slice('--figure-preview-resume='.length));
    if (route.startsWith('#/')) core.once('ready', () => openSettings(route));
  }
${startup}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [target,backup,mode]=process.argv.slice(2);if(!target||!backup)throw Error('Usage: local-preview-host.mjs <main.cjs> <backup-dir> [--apply]');
  const source=await readFile(target,'utf8'),patched=patchPreviewHost(source);
  if(mode==='--apply'&&patched!==source){
    await mkdir(backup,{recursive:true});await copyFile(target,join(backup,'main.cjs.before-preview'),1);
    await copyFile(new URL('./preview-host.cjs',import.meta.url),join(dirname(target),'figure-preview.cjs'),1);
    await writeFile(target,patched);console.log('Preview host adapter applied. Backup: '+join(backup,'main.cjs.before-preview'));
  }else console.log(patched===source?'Preview adapter already present.':'Preview host adapter verified; no files changed.');
}
