#!/usr/bin/env node
// Regenerates vendor/ from npm packages. Run after a fresh clone if the vendor/
// directory is ever deleted, or to upgrade a pinned lib.
//
// Usage: node scripts/vendor-install.js (or, post-build, the .ts file is run
// through tsx or compiled by tsc — see package.json)
//
// Version notes (divergences from original bower.json pins):
//   jquery        bower: 2.0.3      npm: latest (4.x) — API-compatible for boot path
//   easeljs       bower: 0.6.1      npm: latest (1.x) — only used post-getToken
//   tweenjs       bower: 0.4.1      npm: latest (1.x) — only used post-getToken
//   preloadjs     bower: 0.3.1      npm: latest (1.x) — LoadQueue API is stable
//   soundjs       bower: 0.4.1      npm: latest (1.x) — only used post-getToken
//   zynga-animate — no npm pkg; vendored verbatim
//   zynga-scroller — no npm pkg; vendored from upstream + AMD wrapper
//
// `underscore@1.5.1` was removed; the project-local `scripts/dd-helpers.ts`
// supplies the formatting helpers (toKSNum, sprintf, span, …), the tiny
// `compileTemplate` replacement for `_.template`, and native swaps for
// the shuffle/debounce/keys/clone uses sprinkled around the codebase.
//
// `jquery-migrate` and `numeral`/`numeral-de` were removed as part of the
// same vendor-trimming pass: jquery-migrate had zero call sites for any
// API it shims (verified by grepping `scripts/`), and numeral was used at
// a single call site (`toKSNum` in dd-helpers.ts) which now uses
// `Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })` natively.
//
// scripts/ modules are pure ESM, bundled via Vite into
// scripts/esm-bundle.js; vendor libs ship as plain `<script>` tags
// in index.html.  The legacy module loader, its text / tpl plug-ins,
// almond, the no-op console polyfill, and the jquery-mobile stub are
// no longer installed.
//
// If internet access is available, replace the stubs with their real versions:
//   zynga-animate: https://raw.githubusercontent.com/zynga/scroller/7d460ea/src/Animate.js
//   zynga-scroller:https://raw.githubusercontent.com/zynga/scroller/dadd850/src/Scroller.js
//   sprintf:       https://raw.githubusercontent.com/alexei/sprintf.js/192bc60/src/sprintf.js

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const vendorDir = join(root, 'vendor');
mkdirSync(vendorDir, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), 'dd-vendor-'));

function run(cmd: string): void {
  execSync(cmd, { stdio: 'inherit', cwd: tmp });
}

function cp(src: string, dest: string): void {
  const full = join(tmp, 'node_modules', src);
  if (!existsSync(full)) {
    console.warn(`  WARN: ${src} not found — skipping`);
    return;
  }
  copyFileSync(full, join(vendorDir, dest));
  console.log(`  ✓ ${dest}`);
}

console.log('Installing npm-sourced vendor packages…');
run('npm init -y');
run(
  ['npm install --save-exact', 'jquery', 'easeljs', 'tweenjs', 'soundjs', 'sprintf-js'].join(' ')
);

console.log('\nCopying to vendor/…');
cp('jquery/dist/jquery.min.js', 'jquery.js');
cp('easeljs/lib/easeljs.min.js', 'easeljs.js');
cp('tweenjs/lib/tweenjs.min.js', 'tweenjs.js');
cp('soundjs/lib/soundjs.min.js', 'soundjs.js');
cp('sprintf-js/dist/sprintf.min.js', 'sprintf.js');

console.log('\nVendor population complete.');
console.log('Vendored verbatim in repo: zynga-animate.js, zynga-scroller.js');
console.log('\nFiles in vendor/:');
readdirSync(vendorDir)
  .sort()
  .forEach((f) => {
    console.log(`  ${f}`);
  });
