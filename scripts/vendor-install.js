#!/usr/bin/env node
// Regenerates vendor/ from npm packages. Run after a fresh clone if the vendor/
// directory is ever deleted, or to upgrade a pinned lib.
//
// Usage: node scripts/vendor-install.js
//
// Version notes (divergences from original bower.json pins):
//   jquery        bower: 2.0.3      npm: latest (4.x) — API-compatible for boot path
//   easeljs       bower: 0.6.1      npm: latest (1.x) — only used post-getToken
//   tweenjs       bower: 0.4.1      npm: latest (1.x) — only used post-getToken
//   preloadjs     bower: 0.3.1      npm: latest (1.x) — LoadQueue API is stable
//   soundjs       bower: 0.4.1      npm: latest (1.x) — only used post-getToken
//   jquery-migrate bower: 1.2.1     npm: latest (4.x) — only used post-getToken
//   requirejs-text bower: 2.0.9     npm: 2.0.12+
//   routie        bower: 0.3.2 (joestrong) — no matching npm pkg; stub in vendor/
//   tpl           bower: dawsontoth commit — no npm pkg; impl in vendor/
//   zynga-animate/scroller — no npm pkg; stubs in vendor/
//   jquery-mobile bower: 1.3.2     — no matching npm pkg with this version; stub in vendor/
//
// If internet access is available, replace the stubs with their real versions:
//   routie:        https://raw.githubusercontent.com/joestrong/routie/0.3.2/src/routie.js
//   tpl:           https://raw.githubusercontent.com/dawsontoth/requirejs-tpl/374b685/tpl.js
//   zynga-animate: https://raw.githubusercontent.com/zynga/scroller/7d460ea/src/Animate.js
//   zynga-scroller:https://raw.githubusercontent.com/zynga/scroller/dadd850/src/Scroller.js
//   sprintf:       https://raw.githubusercontent.com/alexei/sprintf.js/192bc60/src/sprintf.js
//   json2:         https://raw.githubusercontent.com/douglascrockford/JSON-js/e39db4b/json2.js
//   jquery-cookie: https://raw.githubusercontent.com/carhartl/jquery-cookie/v1.3.1/jquery.cookie.js
//   jquery-mobile: https://code.jquery.com/mobile/1.3.2/jquery.mobile-1.3.2.min.js

import { execSync } from 'child_process';
import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const vendorDir = join(root, 'vendor');
mkdirSync(vendorDir, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), 'dd-vendor-'));

function run(cmd) {
  execSync(cmd, { stdio: 'inherit', cwd: tmp });
}

function cp(src, dest) {
  const full = join(tmp, 'node_modules', src);
  if (!existsSync(full)) { console.warn(`  WARN: ${src} not found — skipping`); return; }
  copyFileSync(full, join(vendorDir, dest));
  console.log(`  ✓ ${dest}`);
}

console.log('Installing npm-sourced vendor packages…');
run(`npm init -y`);
run([
  'npm install --save-exact',
  'requirejs', 'jquery', 'jquery-migrate', 'jquery.cookie',
  'underscore@1.5.1', 'numeral@1.4.5', 'requirejs-text', 'almond@0.2.5',
  'easeljs', 'tweenjs', 'preloadjs', 'soundjs',
  'sprintf-js', 'json2',
].join(' '));

console.log('\nCopying to vendor/…');
cp('requirejs/require.js',                       'requirejs.js');
cp('jquery/dist/jquery.min.js',                  'jquery.js');
cp('jquery-migrate/dist/jquery-migrate.min.js',  'jquery-migrate.js');
cp('jquery.cookie/jquery.cookie.js',             'jquery-cookie.js');
cp('underscore/underscore.js',                   'underscore.js');
cp('numeral/numeral.js',                         'numeral.js');
cp('numeral/languages/de-de.js',                 'numeral-de.js');
cp('requirejs-text/text.js',                     'text.js');
cp('almond/almond.js',                           'almond.js');
cp('easeljs/lib/easeljs.min.js',                 'easeljs.js');
cp('tweenjs/lib/tweenjs.min.js',                 'tweenjs.js');
cp('preloadjs/lib/preloadjs.min.js',             'preloadjs.js');
cp('soundjs/lib/soundjs.min.js',                 'soundjs.js');
cp('sprintf-js/dist/sprintf.min.js',             'sprintf.js');
cp('json2/lib/JSON2.js',                         'json2.js');

console.log('\nVendor population complete.');
console.log('Stubs already in repo: native-console.js, routie.js, tpl.js,');
console.log('  zynga-animate.js, zynga-scroller.js, jquery-mobile.js');
console.log('\nFiles in vendor/:');
readdirSync(vendorDir).sort().forEach(f => console.log('  ' + f));
