// Smoke test: verifies the toolchain itself is wired up correctly.
// Real unit tests for state.js / materializer.js land in #45 / #10 / #11.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('vendor files', () => {
  const required = [
    'requirejs.js', 'jquery.js', 'underscore.js', 'numeral.js',
    'text.js', 'tpl.js', 'routie.js', 'native-console.js',
    'easeljs.js', 'tweenjs.js', 'preloadjs.js', 'soundjs.js',
    'sprintf.js', 'zynga-animate.js', 'zynga-scroller.js', 'jquery-mobile.js',
  ];
  for (const f of required) {
    it(`vendor/${f} exists`, () => {
      expect(existsSync(join(root, 'vendor', f))).toBe(true);
    });
  }
});

describe('esm entry', () => {
  it('exports __placeholder', async () => {
    const mod = await import('../scripts/esm-entry.js');
    expect(mod.__placeholder).toBe(true);
  });
});
