import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = path.resolve('src-v2');
const catalogText = fs.readFileSync(path.join(root, 'i18n/legacyCopy.generated.ts'), 'utf8');
const trBlock = catalogText.split('"en": {')[0];
const catalog = new Set();
for (const match of trBlock.matchAll(/^\s+("(?:\\.|[^"\\])*"):/gm)) catalog.add(JSON.parse(match[1]).replace(/\s+/g, ' ').trim());
const visibleAttributes = new Set(['placeholder', 'title', 'aria-label', 'aria-valuetext', 'alt', 'label']);
const missing = [];
function walkFiles(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) walkFiles(full); else if (entry.isFile() && full.endsWith('.tsx') && !full.includes('__tests__')) inspect(full); } }
function inspect(filename) {
  const sourceText = fs.readFileSync(filename, 'utf8');
  const source = ts.createSourceFile(filename, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function check(value, node) { const compact = value.replace(/\s+/g, ' ').trim(); if (compact.length > 1 && /\p{L}/u.test(compact) && !catalog.has(compact)) { const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1; missing.push(`${path.relative(process.cwd(), filename)}:${line} ${JSON.stringify(compact)}`); } }
  function visit(node) { if (ts.isJsxText(node)) check(node.text, node); if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) check(node.initializer.text, node); ts.forEachChild(node, visit); }
  visit(source);
}
walkFiles(root);
if (missing.length) { console.error(`Missing i18n catalog entries (${missing.length}):\n${missing.join('\n')}`); process.exit(1); }
console.log(`i18n catalog covers visible JSX copy (${catalog.size} source entries).`);
