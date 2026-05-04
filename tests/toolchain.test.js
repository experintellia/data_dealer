// Smoke test: verifies the toolchain itself is wired up correctly.
// Real unit tests for state.js / materializer.js land in #45 / #10 / #11.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('vendor files', () => {
  // After issue #58 closed, requirejs.js, almond.js, text.js, tpl.js,
  // native-console.js and jquery-mobile.js are no longer shipped — the
  // remaining vendor libs are loaded as plain `<script>` tags from
  // index.html and exposed via browser globals.
  const required = [
    'jquery.js', 'jquery-migrate.js', 'underscore.js', 'numeral.js', 'numeral-de.js',
    'easeljs.js', 'tweenjs.js', 'soundjs.js',
    'sprintf.js', 'zynga-animate.js', 'zynga-scroller.js',
  ];
  for (const f of required) {
    it(`vendor/${f} exists`, () => {
      expect(existsSync(join(root, 'vendor', f))).toBe(true);
    });
  }

  // Negative assertions: confirm the AMD-era plumbing is really gone.
  const removed = ['requirejs.js', 'almond.js', 'text.js', 'tpl.js', 'jquery-mobile.js', 'native-console.js'];
  for (const f of removed) {
    it(`vendor/${f} no longer exists`, () => {
      expect(existsSync(join(root, 'vendor', f))).toBe(false);
    });
  }
});

describe('esm entry', () => {
  it('imports cleanly', async () => {
    // The module performs side-effect imports (boot, devtools, bootstrap)
    // — in Node those imports run but the bootstrap UI hooks fail silently
    // (no DOM, no window.jQuery).  We only assert the import itself does
    // not throw at module-load time, which catches syntax errors and
    // unresolved import paths.
    await expect(import('../scripts/esm-entry.js')).resolves.toBeDefined();
  });
});
