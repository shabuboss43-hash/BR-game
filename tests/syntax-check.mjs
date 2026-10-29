// Syntax-check every game JS module without executing browser code.
// Uses vm.SourceTextModule (parse only). Run: node tests/syntax-check.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['game.js'];
for (const f of readdirSync(join(root, 'src'))) {
  if (f.endsWith('.js')) files.push(join('src', f));
}

let failed = 0;
for (const rel of files) {
  const code = readFileSync(join(root, rel), 'utf8');
  try {
    new vm.SourceTextModule(code, { identifier: rel });
    console.log(`OK   ${rel}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${rel}: ${err.message}`);
  }
}
if (failed > 0) { console.error(`\n${failed} file(s) failed syntax check`); process.exit(1); }
console.log(`\nAll ${files.length} modules parse successfully.`);
