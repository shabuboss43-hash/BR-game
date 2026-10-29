// Validate config.json against the game's schema rules.
// Run: node tests/config-validation.js   (exit 1 on any problem)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateConfig, deepMerge, FALLBACK_CONFIG } from '../src/config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

// 1. config.json must be valid JSON
let raw = null;
try {
  raw = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  console.log('OK   config.json is valid JSON');
} catch (err) {
  failures++;
  console.error(`FAIL config.json is not valid JSON: ${err.message}`);
}

// 2. Merged config must pass validation
if (raw) {
  const problems = validateConfig(deepMerge(FALLBACK_CONFIG, raw));
  if (problems.length === 0) console.log('OK   merged config passes validation');
  else { failures++; for (const p of problems) console.error(`FAIL ${p}`); }
}

// 3. The built-in fallback itself must be valid (game boots without the file)
const fb = validateConfig(FALLBACK_CONFIG);
if (fb.length === 0) console.log('OK   fallback config passes validation');
else { failures++; for (const p of fb) console.error(`FAIL fallback: ${p}`); }

// 4. Malformed configs must be reported, not silently accepted
const bad = validateConfig({ world: {}, weapons: { a: { id: 'b' } }, safeZone: { stages: [] } });
if (bad.length > 3) console.log(`OK   malformed config correctly reported (${bad.length} problems)`);
else { failures++; console.error('FAIL malformed config was not reported properly'); }

if (failures) { console.error(`\n${failures} config check(s) failed`); process.exit(1); }
console.log('\nAll config checks passed.');
