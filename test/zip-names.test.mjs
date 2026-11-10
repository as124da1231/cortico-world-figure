import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { filesFromZip, PackImporter } from '../src/import.ts';

// Write the legacy filename bytes into the local and central names of a stored ZIP.
function legacyZip(entries, standard = {}) {
  const files = { ...standard };
  const replacements = entries.map(([path, data], index) => {
    const placeholder = String(index).padStart(path.length, 'X');
    files[placeholder] = Buffer.from(data);
    return [Buffer.from(placeholder), path];
  });
  const zip = Buffer.from(zipSync(files, { level: 0 }));
  for (const [placeholder, path] of replacements) {
    const local = zip.indexOf(placeholder);
    const central = zip.indexOf(placeholder, local + placeholder.length);
    assert.ok(local >= 30 && central >= 46);
    path.copy(zip, local);
    path.copy(zip, central);
  }
  return zip;
}

const rawPath = (name, ext) => Buffer.concat([Buffer.from('c4cccddc2f' + name, 'hex'), Buffer.from(ext)]);
const model = rawPath('d6d0cec4', '.model3.json');
const moc = rawPath('d6d0cec4', '.moc3');

test('legacy Chinese ZIP paths round-trip through model import alongside explicit UTF-8 names', async t => {
  const archive = legacyZip([
    [model, JSON.stringify({ FileReferences: { Moc: '中文.moc3', Textures: [] } })],
    [moc, 'moc fixture'],
    [Buffer.from('résumé.txt'), 'Unflagged UTF-8 filename'],
  ], { 'caféa.txt': Buffer.from('UTF-8 filename') });
  const files = filesFromZip(archive);
  assert.ok(Array.isArray(files), String(files));
  assert.deepEqual(files.map(file => file.path), ['caféa.txt', '奶蛙/中文.model3.json', '奶蛙/中文.moc3', 'résumé.txt']);
  const importer = new PackImporter();
  t.after(() => importer.cancel());
  const stage = await importer.stage(files, false, new Map());
  assert.equal(stage.models[0]?.title, '中文');
  assert.equal(await readFile(join(importer.resolve(stage.token, stage.models[0].dir), '中文.moc3'), 'utf8'), 'moc fixture');
});

test('ZIP compatibility rejects collisions after decoding and traversal', () => {
  assert.match(filesFromZip(legacyZip([[model, 'legacy']], { '奶蛙/中文.model3.json': Buffer.from('UTF-8') })), /路径重复/);
  assert.match(filesFromZip(legacyZip([[Buffer.concat([Buffer.from('../'), model]), 'escape']])), /路径不合法/);
});
