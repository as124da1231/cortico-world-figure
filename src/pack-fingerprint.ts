import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Bind approval to every installed file, without loading large textures into memory. */
export async function packFingerprint(root: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string, relative: string): Promise<void> {
    signal?.throwIfAborted();
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('形象包中不能包含符号链接');
    if (info.isDirectory()) {
      hash.update(JSON.stringify(['dir', relative]));
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), relative ? `${relative}/${name}` : name);
    } else if (info.isFile() && relative) {
      const contents = createHash('sha256');
      for await (const chunk of createReadStream(path, { signal })) contents.update(chunk);
      hash.update(JSON.stringify(['file', relative, contents.digest('hex')]));
    } else throw new Error('形象包中包含不支持的特殊文件');
  }
  await visit(root, '');
  return `sha256:${hash.digest('hex')}`;
}
