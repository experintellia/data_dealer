// Verifies that `pnpm build` completes without errors and produces the
// expected dist/ layout and data-dealer.xdc. Runs the real build script as
// a child process so that vite/rollup errors, missing files, etc. are caught.
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

beforeAll(() => {
  execSync('pnpm build', { cwd: root, stdio: 'pipe' });
}, 60_000);

describe('dist/ structure', () => {
  const required = [
    'index.html',
    'scripts/require.config.js',
    'scripts/bootstrap.js',
    'scripts/app.js',
    // LocalEngine.js is now ESM — bundled into esm-bundle.js via the AMD
    // bridge; it is NOT copied as a standalone AMD file any more.
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

describe('data-dealer.xdc', () => {
  const xdcPath = join(root, 'data-dealer.xdc');

  function listXdc() {
    return execSync(`unzip -l "${xdcPath}"`, { encoding: 'utf8' });
  }

  it('file exists', () => {
    expect(existsSync(xdcPath)).toBe(true);
  });

  it('size is logged (target <5 MB, sprites may exceed this)', () => {
    const { size } = statSync(xdcPath);
    const mb = (size / 1024 / 1024).toFixed(1);
    if (size >= 5 * 1024 * 1024) {
      console.warn(`data-dealer.xdc is ${mb} MB — over 5 MB target (sprite PNGs are pre-compressed)`);
    } else {
      console.log(`data-dealer.xdc is ${mb} MB`);
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
});
