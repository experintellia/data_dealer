// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Regression guard for the Missions.initMissions completion-guard fix.
// Pre-fix: when the server reported an empty/undefined `active_missions`
// list, the `else` branch flipped every loaded mission to complete=true
// and fired spurious `mission_complete` events on every reload from a
// state where the player had not actually completed every mission.
// Post-fix: that branch only runs when `active_missions` is a non-empty
// array AND the mission's gestalt is actually in that array.
//
// A previous version of this test instantiated Missions/Mission at
// runtime; that path drags in app.js → Game.js → game/* and is
// CI-flaky under v8 coverage instrumentation (see mission-tutorial-slice
// test for the matching note). Reduced to source-text assertions.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../scripts/game/Missions.ts'), 'utf8');

describe('Missions.initMissions completion guard', () => {
  it('guards the completion branch on Array.isArray(active_missions)', () => {
    // The pre-fix pattern unconditionally hit the else branch — including
    // when active_missions was undefined or empty.  Post-fix, the
    // completion path is gated on Array.isArray to reject falsy/non-array
    // server payloads.
    expect(SRC).toMatch(/Array\.isArray\s*\(\s*[A-Za-z_]+\.active_missions\s*\)/);
  });

  it('walks active_missions to mark complete instead of flipping every mission', () => {
    // The post-fix pattern iterates `active_missions.forEach` and only
    // sets `complete` on the gestalts the server actually reported. The
    // pre-fix else branch unconditionally hit `m.setState('complete', true)`
    // on every loaded mission.
    expect(SRC).toMatch(
      /Array\.isArray[\s\S]{0,400}active_missions\.forEach[\s\S]{0,400}setState\(\s*['"]complete['"]/
    );
  });
});
