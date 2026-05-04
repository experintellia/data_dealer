// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Phase 6 regression guard for #120: scripts/LocalEngine.ts handlers must
// NOT call setState directly. State mutation goes through _persistDelta
// (which routes via applyDelta in the listener / its no-webxdc twin).
//
// This is a static text scan rather than an AST-based check — keeps the
// test deps light and stays robust against the var-style ESM in this
// codebase. The scan whitelists three legitimate setState callers that
// are NOT delta-emitting handlers:
//
//   - _persistDelta itself (it IS the listener-equivalent for tests)
//   - loadGame (runs the materializer and seeds mission_goals lazily)
//   - _scheduleChargeReady (one-shot setTimeout that materialises at
//     charge_end; not a handler — internal time-tick helper)
//
// Anything else calling setState in LocalEngine.ts fails CI.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const enginePath = resolve(__dirname, '../../scripts/LocalEngine.ts');

// Lines that may legitimately call setState. Each entry is a substring
// match against a single physical line. Keep this list short — every new
// entry must have a comment in the source explaining why it's NOT a
// delta-emitting handler. New entries also belong in
// docs/replay-safety-audit.md so reviewers can spot architectural drift.
const ALLOWLIST = [
  // _persistDelta no-webxdc echo — IS the listener-equivalent in tests.
  'setState(applyDelta(getState(), delta));',
  // loadGame — runs the materializer once and seeds mission_goals.
  'setState(seededState);',
  // _scheduleChargeReady — one-shot setTimeout's materialised tick.
  'setState(mat.state);',
];

function isAllowed(line) {
  for (var i = 0; i < ALLOWLIST.length; i++) {
    if (line.indexOf(ALLOWLIST[i]) !== -1) return true;
  }
  return false;
}

describe('LocalEngine handlers do not call setState directly (closes #120)', () => {
  const src = readFileSync(enginePath, 'utf8');

  it('every setState call site is on the audit allowlist', () => {
    const offenders = [];
    src.split('\n').forEach(function (line, idx) {
      // Skip imports, comments, and the var declaration itself.
      var trimmed = line.trim();
      if (trimmed.startsWith('//')) return;
      if (trimmed.startsWith('*')) return;
      if (trimmed.startsWith('import')) return;
      // Match `setState(` as a call (not the imported binding alone).
      var callIdx = line.indexOf('setState(');
      if (callIdx === -1) return;
      if (isAllowed(line)) return;
      offenders.push({ line: idx + 1, text: trimmed });
    });

    if (offenders.length) {
      const msg = offenders
        .map(function (o) {
          return '  scripts/LocalEngine.ts:' + o.line + '  ' + o.text;
        })
        .join('\n');
      throw new Error(
        'Found setState call(s) in scripts/LocalEngine.ts outside the\n' +
          'allowlist. Handlers must compute deltas and call _persistDelta —\n' +
          'they must NOT call setState directly. Offenders:\n' +
          msg
      );
    }
    expect(offenders).toEqual([]);
  });

  it('the import line is the only top-level reference to setState', () => {
    // Sanity check: the import binding exists, so the test isn't
    // accidentally green because setState was renamed.
    expect(src).toMatch(/import\s*\{[^}]*\bsetState\b[^}]*\}\s*from\s*['"]\.\/boot\.js['"]/);
  });
});
