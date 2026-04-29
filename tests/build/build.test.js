// Verifies that `pnpm build` completes without errors and produces the
// expected dist/ layout. Runs the real build script as a child process so
// that esbuild errors, missing files, etc. are all caught here.
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

beforeAll(() => {
  execSync('node esbuild.config.js', { cwd: root, stdio: 'pipe' });
}, 30_000);

describe('dist/ structure', () => {
  const required = [
    'index.html',
    'scripts/require.config.js',
    'scripts/bootstrap.js',
    'scripts/app.js',
    'scripts/LocalEngine.js',
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
});
