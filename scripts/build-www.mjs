// Builds the self-contained www/ folder used by Capacitor for the Android app.
// The browser build in the repository root uses an import map, but import
// maps need Chrome 89+. Android 10's WebView can be older, so the APK gets
// one bundled script (esbuild, Chrome 80 target) with no import map needed.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const www = path.join(root, 'www');

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

// 1. Bundle the game + Three.js into a single script for older WebViews.
await build({
  entryPoints: [path.join(root, 'game.js')],
  bundle: true,
  format: 'esm',
  target: ['chrome80'],
  minify: true,
  legalComments: 'none',
  outfile: path.join(www, 'game.bundle.js')
});

// 2. Rewrite index.html: drop the import map, load the bundle.
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/m, '');
html = html.replace('<script type="module" src="game.js"></script>',
  '<script type="module" src="game.bundle.js"></script>');
if (html.includes('importmap') || html.includes('src="game.js"')) {
  throw new Error('index.html rewrite failed for APK bundle');
}
await writeFile(path.join(www, 'index.html'), html);

// 3. Copy the runtime files the game fetches/loads at runtime.
await cp(path.join(root, 'style.css'), path.join(www, 'style.css'));
await cp(path.join(root, 'config.json'), path.join(www, 'config.json'));
if (existsSync(path.join(root, 'assets'))) {
  await cp(path.join(root, 'assets'), path.join(www, 'assets'), {
    recursive: true,
    filter: (src) => !src.endsWith('.gitkeep')
  });
}

console.log('www/ ready for Capacitor (bundled script, no import map).');
