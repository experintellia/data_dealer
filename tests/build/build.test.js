// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Verifies that `pnpm build:all` completes without errors and produces the
// expected dist/ layout and both `.xdc` variants. Runs the real build
// script as a child process so that vite/rollup errors, missing files,
// pngquant/oxipng failures in the casual pass, etc. are caught.
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Skip the rebuild if both `.xdc` artifacts are already present at the
// repo root.  Avoids spending ~60 s on a redundant `pnpm build:all` in
// CI (where the workflow already ran the build as a previous step) and
// avoids tripping vitest's worker-RPC heartbeat timeout on the long
// `oxipng -o max` pass.  Local cold-start `pnpm test` still gets a
// clean build.
beforeAll(() => {
  const haveHq = existsSync(join(root, 'data-dealer-hq.xdc'));
  const haveCasual = existsSync(join(root, 'data-dealer-casual.xdc'));
  if (haveHq && haveCasual) return;
  execSync('pnpm build:all', { cwd: root, stdio: 'pipe' });
}, 180_000);

describe('dist/ structure', () => {
  // RequireJS is gone.  scripts/require.config.js and scripts/bootstrap.js
  // + every other AMD module are folded into dist/scripts/esm-bundle.js;
  // views/*.html are inlined as `?raw` imports.
  const required = [
    'index.html',
    'scripts/esm-bundle.js',
    'vendor/jquery.js',
    'vendor/underscore.js',
    'vendor/easeljs.js',
    'vendor/sprintf.js',
    'css/dd.css',
  ];

  for (const f of required) {
    it(`dist/${f} exists`, () => {
      expect(existsSync(join(root, 'dist', f))).toBe(true);
    });
  }

  // Negative assertions: the legacy AMD plumbing must not regress back
  // into the build output.
  const removed = [
    'scripts/require.config.js',
    'scripts/bootstrap.js',
    'scripts/app.js',
    'scripts/Game.js',
    'scripts/Render.js',
    'vendor/requirejs.js',
    'vendor/text.js',
    'vendor/tpl.js',
    'vendor/jquery-mobile.js',
    'vendor/almond.js',
    'vendor/native-console.js',
  ];

  for (const f of removed) {
    it(`dist/${f} not shipped`, () => {
      expect(existsSync(join(root, 'dist', f))).toBe(false);
    });
  }
});

describe('dist/index.html', () => {
  it('references esm-bundle.js with the vendor <script> chain', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    expect(html).toContain('scripts/esm-bundle.js');
    expect(html).toContain('vendor/jquery.js');
    expect(html).toContain('vendor/underscore.js');
    expect(html).not.toContain('vendor/requirejs.js');
    expect(html).not.toContain('require.config');
  });
});

describe('dist/scripts/esm-bundle.js', () => {
  it('contains LocalEngine handler code', async () => {
    const { readFileSync } = await import('fs');
    const bundle = readFileSync(join(root, 'dist', 'scripts', 'esm-bundle.js'), 'utf8');
    // Sanity-check that handler names from LocalEngine survived bundling
    // (they appear as string literals because LocalEngine builds a
    // dispatch table over Object.keys(handlers)).
    expect(bundle).toContain('chargePerp');
    expect(bundle).toContain('integrateCollected');
  });

  it('does NOT contain a `define.amd` AMD-bridge footer', async () => {
    const { readFileSync } = await import('fs');
    const bundle = readFileSync(join(root, 'dist', 'scripts', 'esm-bundle.js'), 'utf8');
    expect(bundle).not.toContain('define.amd');
  });
});

// Both variants ship the same files (manifest, icon, scripts, etc.) — the
// casual variant just has palette-quantized PNGs.  Run the same structural
// assertions against both, plus a per-variant size sanity warning.
describe.each([
  { name: 'data-dealer-hq.xdc', warnAboveMb: 16 },
  { name: 'data-dealer-casual.xdc', warnAboveMb: 7 },
])('$name', ({ name, warnAboveMb }) => {
  const xdcPath = join(root, name);

  function listXdc() {
    return execSync(`unzip -l "${xdcPath}"`, { encoding: 'utf8' });
  }

  it('file exists', () => {
    expect(existsSync(xdcPath)).toBe(true);
  });

  it(`size is logged (warns above ${warnAboveMb} MB)`, () => {
    const { size } = statSync(xdcPath);
    const mb = (size / 1024 / 1024).toFixed(1);
    if (size >= warnAboveMb * 1024 * 1024) {
      console.warn(`${name} is ${mb} MB — over ${warnAboveMb} MB target`);
    } else {
      console.log(`${name} is ${mb} MB`);
    }
    expect(size).toBeGreaterThan(0);
  });

  it('contains manifest.toml and icon.png', () => {
    const listing = listXdc();
    expect(listing).toContain('manifest.toml');
    expect(listing).toContain('icon.png');
  });

  it('contains index.html at root', () => {
    expect(listXdc()).toContain('index.html');
  });

  it('contains static asset directories', () => {
    const listing = listXdc();
    expect(listing).toMatch(/\bimg\//);
    expect(listing).toMatch(/\bi18n\//);
    expect(listing).toMatch(/\bcss\//);
    expect(listing).toMatch(/\bvendor\//);
    expect(listing).toMatch(/\bscripts\//);
    expect(listing).toMatch(/\bfont\//);
    expect(listing).toMatch(/\bdata\//);
    // views/*.html are now `?raw`-imported into esm-bundle.js — the
    // standalone directory is no longer shipped.
    expect(listing).not.toMatch(/\bviews\//);
  });

  it('contains license and credits files', () => {
    const listing = listXdc();
    expect(listing).toContain('LICENSE.txt');
    expect(listing).toContain('CREDITS.txt');
  });

  it('does NOT contain webxdc.js (injected by messenger)', () => {
    expect(listXdc()).not.toContain('webxdc.js');
  });

  it('does NOT contain unused Bowlby TTFs (.woff is loaded instead)', () => {
    const listing = listXdc();
    expect(listing).not.toContain('font/BowlbyOne.ttf');
    expect(listing).not.toContain('font/BowlbyOneSC.ttf');
  });

  it('does NOT contain vendor/requirejs.js or other deleted AMD plumbing', () => {
    const listing = listXdc();
    expect(listing).not.toContain('vendor/requirejs.js');
    expect(listing).not.toContain('vendor/text.js');
    expect(listing).not.toContain('vendor/tpl.js');
    expect(listing).not.toContain('vendor/jquery-mobile.js');
    expect(listing).not.toContain('scripts/require.config.js');
    expect(listing).not.toContain('scripts/bootstrap.js');
  });
});
