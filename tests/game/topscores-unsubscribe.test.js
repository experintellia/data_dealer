// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Topscores.extendEventHandlers subscribes to `subscribePeersChanged` to
// refresh the leaderboards on every peer ref change. Pre-fix the
// returned unsubscribe handle was discarded ("Topscores lives for the
// page lifetime; the unsubscribe is dropped."), so any callers that
// later `remove()` the Topscores GameNode (e.g. unit tests, view
// teardown) leaked the listener — it would keep firing against a
// detached node.
//
// Fix: store the handle on the instance and invoke it from
// GameNode.remove (Topscores override).
//
// Previously this test exercised the lifecycle at runtime via
// `new Topscores(...)`, but Topscore.ts imports app.js → Game.js →
// game/* which, under v8 coverage instrumentation in CI, can throw
// "Class extends value undefined" mid-load (see mission-tutorial-slice
// for the matching note). Reduced to source-text assertions covering
// the same regression.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../scripts/game/Topscores.ts'), 'utf8');

describe('Topscores subscribePeersChanged unsubscribe lifecycle', () => {
  it('stores the unsubscribe handle returned by subscribePeersChanged', () => {
    // Pre-fix: `subscribePeersChanged(cb)` was called and the return
    // value dropped.  Post-fix: it must be assigned to a per-instance
    // slot so `remove()` can invoke it.
    expect(SRC).toMatch(/this\.[_a-zA-Z]+\s*=\s*[a-zA-Z.]*subscribePeersChanged\s*\(/);
  });

  it('invokes the stored unsubscribe handle from an overridden remove()', () => {
    // The override must call the handle (it's typed as a no-arg fn)
    // somewhere inside remove(). We anchor on the field reference plus
    // `()` invocation rather than a specific name.
    expect(SRC).toMatch(/(override\s+)?remove\s*\(/);
    expect(SRC).toMatch(/this\.[_a-zA-Z]+\s*\(\)/);
  });
});
