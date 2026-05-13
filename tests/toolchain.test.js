// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Smoke test: verifies the toolchain itself is wired up correctly.
// Real unit tests for state.js / materializer.js land in #45 / #10 / #11.
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('vendor files', () => {
  // The libs index.html `<script>`-loads, in dependency order.
  const required = [
    'jquery.js',
    'easeljs.js',
    'tweenjs.js',
    'soundjs.js',
    'sprintf.js',
    'zynga-animate.js',
    'zynga-scroller.js',
  ];
  for (const f of required) {
    it(`vendor/${f} exists`, () => {
      expect(existsSync(join(root, 'vendor', f))).toBe(true);
    });
  }

  // The legacy AMD plumbing must not regress back into vendor/, plus
  // underscore (replaced by scripts/dd-helpers.ts), plus jquery-migrate
  // and numeral (replaced by Intl.NumberFormat in dd-helpers.ts).
  const removed = [
    'requirejs.js',
    'almond.js',
    'text.js',
    'tpl.js',
    'jquery-mobile.js',
    'native-console.js',
    'underscore.js',
    'jquery-migrate.js',
    'numeral.js',
    'numeral-de.js',
  ];
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

// vitest's `include` glob must keep picking up .ts test files. Read the
// config source directly so a regression that drops .ts from the glob
// surfaces as a loud failure rather than a silently-skipped test file.
describe('vitest TypeScript test discovery', () => {
  it('vitest.config.js include glob covers .ts/.tsx/.mts', () => {
    const cfgSrc = readFileSync(join(root, 'vitest.config.js'), 'utf8');
    const includeMatch = cfgSrc.match(/include\s*:\s*\[([^\]]+)\]/);
    expect(includeMatch, 'vitest.config.js must declare an include array').not.toBeNull();
    const includeBody = includeMatch[1];
    expect(includeBody).toMatch(/\bts\b/);
    expect(includeBody).toMatch(/\btsx\b/);
    expect(includeBody).toMatch(/\bmts\b/);
  });
});
