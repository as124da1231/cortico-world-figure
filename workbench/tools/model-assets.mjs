import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

const invalidPart = part => !part || part === '..' || /[:\u0000-\u001f]/.test(part)
  || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part);
const nameKey = name => name.normalize('NFC').trim();

/** Resolve a declared Cubism resource without searching outside the model or guessing by extension. */
export function resolveModelAsset(root, name, { allowBasename = true, max = Infinity } = {}) {
  if (typeof name !== 'string' || /^[\\/]/.test(name) || isAbsolute(name)) return null;
  const parts = name.split(/[\\/]+/);
  if (parts.some(part => invalidPart(part) || invalidPart(nameKey(part)))) return null;
  const names = parts.filter(part => part !== '.');
  if (!names.length) return null;

  function locate(items, normalize = false) {
    let file = root;
    try {
      for (const [index, part] of items.entries()) {
        let actual = part;
        if (normalize) {
          const entries = readdirSync(file);
          if (!entries.includes(part)) {
            const matches = entries.filter(entry => nameKey(entry) === nameKey(part));
            if (matches.length !== 1) return null;
            [actual] = matches;
          }
        }
        file = join(file, actual);
        const info = lstatSync(file);
        if (info.isSymbolicLink() || (index < items.length - 1 ? !info.isDirectory() : !info.isFile() || info.size > max)) return null;
      }
      const real = realpathSync(file), rel = relative(realpathSync(root), real);
      return rel && rel.split(sep)[0] !== '..' && !isAbsolute(rel) ? real : null;
    } catch {
      return null;
    }
  }
  return locate(names) || locate(names, true)
    || (allowBasename && names.length > 1 ? locate(names.slice(-1)) || locate(names.slice(-1), true) : null);
}
