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
  const required = [
    'index.html',
    'scripts/require.config.js',
    'scripts/bootstrap.js',
    // LocalEngine.js, app.js, util.js, setup.js, i18n.js, type_settings.js
    // are now ESM — bundled into esm-bundle.js via the AMD bridge; they
    // are NOT copied as standalone AMD files.
    'scripts/esm-bundle.js',
    'vendor/requirejs.js',
    'vendor/jquery.js',
    'vendor/underscore.js',
    'css/dd.css',
  ];

  for (const f of required) {
    it(`dist/${f} exists`, () => {
      expect(existsSync(join(root, 'dist', f))).toBe(true);
    });
  }
});

describe('dist/index.html', () => {
  it('references vendor/requirejs.js (not components/)', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    expect(html).toContain('vendor/requirejs.js');
    expect(html).not.toContain('components/');
  });
});

describe('dist/scripts/require.config.js', () => {
  it('references vendor/ paths (not components/)', async () => {
    const { readFileSync } = await import('fs');
    const cfg = readFileSync(join(root, 'dist', 'scripts', 'require.config.js'), 'utf8');
    expect(cfg).toContain('../vendor/');
    expect(cfg).not.toContain('../components/');
  });
});

describe('dist/scripts/esm-bundle.js', () => {
  it('contains the AMD bridge footer', async () => {
    const { readFileSync } = await import('fs');
    const bundle = readFileSync(join(root, 'dist', 'scripts', 'esm-bundle.js'), 'utf8');
    expect(bundle).toContain('define.amd');
  });

  it('registers LocalEngine via the AMD bridge', async () => {
    const { readFileSync } = await import('fs');
    const bundle = readFileSync(join(root, 'dist', 'scripts', 'esm-bundle.js'), 'utf8');
    // The bridge footer emits define("LocalEngine", ...) for the AMD loader.
    expect(bundle).toContain('LocalEngine');
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
    expect(listing).toMatch(/\bviews\//);
    expect(listing).toMatch(/\bfont\//);
    expect(listing).toMatch(/\bdata\//);
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
});
