#!/usr/bin/env node
// Production build: produces dist/ from source.
// Vite handles the dev server (pnpm dev); this script handles pnpm build.
// Using esbuild+Node for the build lets us copy legacy CSS/AMD scripts as-is
// without running them through a CSS linter or module bundler.

import esbuild from 'esbuild';
import {
  copyFileSync, mkdirSync, readdirSync, statSync,
  existsSync, readFileSync, writeFileSync,
} from 'fs';
import { join } from 'path';

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

function cp(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(src, dest);
}

mkdirSync('dist/scripts', { recursive: true });

// Static assets — copied as-is, no processing.
copyDir('css',    'dist/css');
copyDir('img',    'dist/img');
copyDir('font',   'dist/font');
copyDir('views',  'dist/views');
copyDir('data',   'dist/data');
copyDir('i18n',   'dist/i18n');
copyDir('vendor', 'dist/vendor');
cp('index.html',  'dist/index.html');

// Legacy AMD scripts — copied as-is; requirejs loads them at runtime.
for (const f of [
  'Game.js', 'Render.js', 'app.js', 'bootstrap.js', 'Remote.js', 'Socket.js',
  'RpcQueue.js', 'i18n.js', 'util.js', 'setup.js', 'setup_beta_local.js',
  'core.js', 'type_settings.js', 'LocalEngine.js', 'require.config.js',
]) {
  cp(`scripts/${f}`, `dist/scripts/${f}`);
}

// ESM entry → AMD-compat IIFE.
// Footer calls define() for each named export so requirejs can require() new
// Wave-2 ESM modules without changes to legacy AMD source.
const amdBridgeFooter = `
if (typeof define === 'function' && define.amd) {
  Object.keys(__DD).forEach(function(name) {
    if (name !== '__placeholder') define(name, [], function() { return __DD[name]; });
  });
}`;

await esbuild.build({
  entryPoints: ['scripts/esm-entry.js'],
  bundle: true,
  format: 'iife',
  globalName: '__DD',
  outfile: 'dist/scripts/esm-bundle.js',
  footer: { js: amdBridgeFooter },
});

console.log('Build complete → dist/');
