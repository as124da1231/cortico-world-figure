import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const KEY_DIRS = ['left-keys', 'right-keys'];
const keyName = /^[a-z][a-z0-9]{0,31}$/i;

/** Current BongoCat packages carry named artwork beside a normal Cubism entry. */
export async function readBongoPackage(dir, parameters, motionGroups, resolveAsset, pngSize) {
  const files = [];
  const art = (name) => {
    const source = resolveAsset('resources/' + name, false);
    const size = source && pngSize(source);
    if (!size || Math.min(size.w, size.h) < 1 || Math.max(size.w, size.h) > 4096) return null;
    const file = 'bongo/' + name;
    files.push({ source, file });
    return { file, ...size };
  };
  const keys = [];
  for (const side of KEY_DIRS) {
    const entries = await readdir(join(dir, 'resources', side), { withFileTypes: true }).catch(() => []);
    const mapped = {};
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 256)) {
      const name = entry.name.slice(0, -4);
      if (!entry.isFile() || !/\.png$/i.test(entry.name) || !keyName.test(name)) continue;
      const image = art(side + '/' + entry.name);
      if (image) mapped[name.toLowerCase()] = image;
    }
    keys.push(mapped);
  }
  const hasKeys = keys.some(side => Object.keys(side).length);
  // The legacy keyboard/mouse control IDs and CAT groups can also occur in a
  // standalone Cubism export, without any of the app's image layers.
  const hasBongoControls = parameters.includes('CatParamLeftHandDown') ||
    (Object.hasOwn(motionGroups ?? {}, 'CAT_motion') && parameters.includes('ParamMouseX') && parameters.includes('ParamMouseY'));
  if (!hasKeys && !hasBongoControls) return null;
  return { profile: { background: art('background.png'), keys }, files, cover: art('cover.png') };
}
