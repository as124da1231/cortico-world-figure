import type { Stats } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { parse, type AnyNode } from 'acorn';
import { fullAncestor } from 'acorn-walk';
import { childPath, containsPath } from './paths.ts';

const packUrl = new URL('https://figure.invalid/pack/');
const maxModuleBytes = 8 * 1048576;
const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const conditionalTypes = new Set([
  'IfStatement', 'ConditionalExpression', 'LogicalExpression', 'SwitchCase', 'TryStatement',
  'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement',
]);

type ModuleReference = { file: string; module: boolean };

function literal(node: AnyNode | undefined): string | undefined {
  return node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
}

function isImportMetaUrl(node: AnyNode | undefined): boolean {
  return node?.type === 'MemberExpression' && !node.computed
    && node.object.type === 'MetaProperty' && node.object.meta.name === 'import' && node.object.property.name === 'meta'
    && node.property.type === 'Identifier' && node.property.name === 'url';
}

function packPath(specifier: string, base: URL): string | undefined {
  if (!specifier || /^(?:\/|#|[a-z][a-z\d+.-]*:)/i.test(specifier)) return;
  const url = new URL(specifier, base);
  if (url.origin !== packUrl.origin || !url.pathname.startsWith(packUrl.pathname) || url.pathname.endsWith('/')) return;
  return url.pathname.slice(packUrl.pathname.length).split('/').map(decodeURIComponent).join('/');
}

function references(ast: ReturnType<typeof parse>, file: string, entryExport?: string): ModuleReference[] {
  const moduleUrl = new URL(file.split('/').map(encodeURIComponent).join('/'), packUrl);
  const found: ModuleReference[] = [];
  const add = (name: string | undefined, base: URL, module: boolean) => {
    const file = name && packPath(name, base);
    if (file) found.push({ file, module });
  };
  fullAncestor(ast, (node, _state, parents) => {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      const specifier = literal(node.source ?? undefined);
      if (specifier?.startsWith('./') || specifier?.startsWith('../')) add(specifier, moduleUrl, true);
      return;
    }
    if (node.type !== 'ImportExpression' && node.type !== 'NewExpression') return;
    if (parents.some(parent => conditionalTypes.has(parent.type))) return;
    const scopes = parents.filter(parent => functionTypes.has(parent.type));
    const scope = scopes[0];
    const scopeParent = scope && parents[parents.indexOf(scope) - 1];
    const entry = entryExport && (
      scope?.type === 'FunctionDeclaration' && scope.id?.name === entryExport
      || scopeParent?.type === 'VariableDeclarator' && scopeParent.id.type === 'Identifier' && scopeParent.id.name === entryExport
      || scopeParent?.type === 'ExportDefaultDeclaration' && entryExport === 'default'
    );
    if (scopes.length > 1 || scope && !entry) return;
    if (node.type === 'ImportExpression') {
      const specifier = literal(node.source);
      if (specifier?.startsWith('./') || specifier?.startsWith('../')) add(specifier, moduleUrl, true);
      return;
    }
    if (node.callee.type !== 'Identifier' || node.callee.name !== 'URL') return;
    const [reference, base] = node.arguments;
    if (isImportMetaUrl(base)) add(literal(reference), moduleUrl, false);
    else if (scope && 'params' in scope && scope.params[0]?.type === 'Identifier'
      && base?.type === 'Identifier' && base.name === scope.params[0].name) add(literal(reference), packUrl, false);
  });
  return found;
}

function literalModels(ast: ReturnType<typeof parse>, source: string): unknown[] {
  for (const statement of ast.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.declaration?.type !== 'VariableDeclaration') continue;
    const binding = statement.declaration.declarations.find(item => item.id.type === 'Identifier' && item.id.name === 'models');
    if (binding?.init?.type !== 'ObjectExpression') continue;
    try { return Object.values(JSON.parse(source.slice(binding.init.start, binding.init.end))); }
    catch { return []; }
  }
  return [];
}

/** Check provable local dependencies without running the pack or resolving network imports. */
export async function checkPackRuntime(root: string, entry: string, exported: string): Promise<void> {
  const base = await realpath(root);
  const missing = new Set<string>();
  const modules = new Set<string>();
  const locations = new Map<string, Stats | null>();

  async function info(file: string) {
    if (locations.has(file)) return locations.get(file);
    const path = childPath(base, file);
    const entry = await lstat(path).catch(() => null);
    const valid = entry?.isFile() && !entry.isSymbolicLink() && containsPath(base, await realpath(path)) ? entry : null;
    locations.set(file, valid);
    return valid;
  }

  async function visit(ref: ModuleReference, entryExport?: string) {
    const fileInfo = await info(ref.file);
    if (!fileInfo) { missing.add(ref.file); return; }
    if (!ref.module || modules.has(ref.file) || fileInfo.size > maxModuleBytes
      || !entryExport && !/\.(?:mjs|js)$/i.test(ref.file)) return;
    modules.add(ref.file);
    const source = await readFile(childPath(base, ref.file), 'utf8');
    let ast;
    try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }); }
    catch { throw Error(`形象脚本无法解析：${ref.file}`); }
    for (const next of references(ast, ref.file, entryExport)) await visit(next);
    if (ref.file !== 'models/index.js') return;
    for (const value of literalModels(ast, source)) {
      if (!value || typeof value !== 'object') continue;
      const model = value as Record<string, unknown>;
      if (typeof model.id !== 'string' || typeof model.model !== 'string' || typeof model.moc !== 'string'
        || !Array.isArray(model.textures)) continue;
      const modelPath = `models/${model.id}/`;
      for (const file of [model.model, ...model.textures]) {
        if (typeof file === 'string') await visit({file: modelPath + file, module: false});
      }
      const moc = modelPath + model.moc;
      const fallback = typeof model.mocFallback === 'string' ? modelPath + model.mocFallback : null;
      if (!await info(moc) && !(fallback && await info(fallback))) missing.add(moc);
    }
  }

  await visit({file: entry.replaceAll('\\', '/'), module: true}, exported);
  if (missing.size) {
    const files = [...missing].slice(0, 6).join('、');
    throw Error(`形象包缺少运行文件：${files}${missing.size > 6 ? ' 等' : ''}`);
  }
}
