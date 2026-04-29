#!/usr/bin/env node
// Build script: produces dist/ from source.
// Usage:
//   node esbuild.config.js          # one-shot build
//   node esbuild.config.js --serve  # dev server on http://localhost:8000

import esbuild from 'esbuild';
import {
  copyFileSync, mkdirSync, readdirSync, statSync,
  readFileSync, writeFileSync, existsSync,
} from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const serveMode = args.includes('--serve');
const prod = args.includes('--prod');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    statSync(s).isDirectory() ? copyDir(s, d) : copyFileSync(s, d);
  }
}

function copyFile(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(src, dest);
}

// ---------------------------------------------------------------------------
// Static asset copy
// ---------------------------------------------------------------------------

mkdirSync('dist/scripts', { recursive: true });
copyDir('css',    'dist/css');
copyDir('img',    'dist/img');
copyDir('font',   'dist/font');
copyDir('views',  'dist/views');
copyDir('data',   'dist/data');
copyDir('i18n',   'dist/i18n');
copyDir('vendor', 'dist/vendor');

// Legacy AMD scripts — copied as-is; RequireJS loads them at runtime.
const amdScripts = [
  'Game.js', 'Render.js', 'app.js', 'bootstrap.js', 'Remote.js', 'Socket.js',
  'RpcQueue.js', 'i18n.js', 'util.js', 'setup.js', 'setup_beta_local.js',
  'core.js', 'type_settings.js', 'LocalEngine.js',
];
for (const f of amdScripts) {
  copyFile(`scripts/${f}`, `dist/scripts/${f}`);
}

// ---------------------------------------------------------------------------
// Rewrite require.config.js: components/ → vendor/ paths
// ---------------------------------------------------------------------------

const requireConfigSrc = readFileSync('scripts/require.config.js', 'utf8');
const requireConfigOut = requireConfigSrc
  .replace(/'\.\.\/components\/EaselJS\/lib\/easeljs-0\.6\.1\.min'/g,      "'../vendor/easeljs'")
  .replace(/'\.\.\/components\/PreloadJS\/lib\/preloadjs-0\.3\.1\.min'/g,  "'../vendor/preloadjs'")
  .replace(/'\.\.\/components\/TweenJS\/lib\/tweenjs-0\.4\.1\.min'/g,      "'../vendor/tweenjs'")
  .replace(/'\.\.\/components\/SoundJS\/lib\/soundjs-0\.4\.1\.min'/g,      "'../vendor/soundjs'")
  .replace(/'\.\.\/components\/jquery\/jquery'/g,                           "'../vendor/jquery'")
  .replace(/'\.\.\/components\/jquery-migrate\/jquery-migrate'/g,           "'../vendor/jquery-migrate'")
  .replace(/'\.\.\/components\/jquery-mobile\/index'/g,                     "'../vendor/jquery-mobile'")
  .replace(/'\.\.\/components\/json2\/index'/g,                             "'../vendor/json2'")
  .replace(/'\.\.\/components\/native-console\/native-console'/g,           "'../vendor/native-console'")
  .replace(/'\.\.\/components\/numeral\/numeral'/g,                         "'../vendor/numeral'")
  .replace(/'\.\.\/components\/numeral\/languages\/de-de'/g,                "'../vendor/numeral-de'")
  .replace(/'\.\.\/components\/routie\/lib\/routie'/g,                      "'../vendor/routie'")
  .replace(/'\.\.\/components\/sprintf\/index'/g,                           "'../vendor/sprintf'")
  .replace(/'\.\.\/components\/requirejs-text\/text'/g,                     "'../vendor/text'")
  .replace(/'\.\.\/components\/requirejs-tpl-dawsontoth\/index'/g,          "'../vendor/tpl'")
  .replace(/'\.\.\/components\/underscore\/underscore'/g,                   "'../vendor/underscore'")
  .replace(/'\.\.\/components\/zynga-animate\/index'/g,                     "'../vendor/zynga-animate'")
  .replace(/'\.\.\/components\/zynga-scroller\/index'/g,                    "'../vendor/zynga-scroller'");
writeFileSync('dist/scripts/require.config.js', requireConfigOut);

// ---------------------------------------------------------------------------
// Rewrite index.html: components/requirejs → vendor/requirejs
// Also inject esm-bundle.js before the requirejs script tag.
// ---------------------------------------------------------------------------

let html = readFileSync('index.html', 'utf8');
html = html.replace(
  "src='components/requirejs/require.js'",
  "src='vendor/requirejs.js'",
);
// Inject the ESM bundle (AMD-compat bridge) just before the requirejs script.
html = html.replace(
  "<script src='vendor/requirejs.js'",
  "<script src='scripts/esm-bundle.js'></script>\n    <script src='vendor/requirejs.js'",
);
writeFileSync('dist/index.html', html);

// ---------------------------------------------------------------------------
// Bundle ESM entry → AMD-compat IIFE
// ---------------------------------------------------------------------------

// Footer registers every named export as an AMD module so requirejs can
// require() new ESM modules by name without any changes to legacy AMD code.
const amdBridgeFooter = `
// AMD-compat bridge — auto-registers ESM exports as requirejs modules.
if (typeof define === 'function' && define.amd) {
  Object.keys(__DD).forEach(function(name) {
    if (name !== '__placeholder') {
      define(name, [], function() { return __DD[name]; });
    }
  });
}
`;

if (serveMode) {
  const ctx = await esbuild.context({
    entryPoints: ['scripts/esm-entry.js'],
    bundle: true,
    format: 'iife',
    globalName: '__DD',
    outfile: 'dist/scripts/esm-bundle.js',
    sourcemap: true,
    footer: { js: amdBridgeFooter },
  });
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: 'dist', port: 8000 });
  console.log(`Dev server → http://${host}:${port}`);
  console.log('Watching for changes… (Ctrl-C to stop)');
} else {
  await esbuild.build({
    entryPoints: ['scripts/esm-entry.js'],
    bundle: true,
    format: 'iife',
    globalName: '__DD',
    outfile: 'dist/scripts/esm-bundle.js',
    minify: prod,
    sourcemap: !prod,
    footer: { js: amdBridgeFooter },
  });
  console.log('Build complete → dist/');
}
