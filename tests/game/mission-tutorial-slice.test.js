// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Regression guard for the Mission.checkTutorial off-by-one fix in
// scripts/game/Mission.ts. `deletefrom` records the index of the *last
// completed* tutorial step (either buyPerp already in IPerps or
// integrateProfileSet already resolved server-side). The remaining
// `steps.slice(deletefrom + 1)` must therefore start *after* that index,
// not at it (otherwise the player re-sees a step they already finished).
//
// A previous version of this test imported Mission.ts at runtime and
// exercised checkTutorial against a stub GameRoot. That dragged in
// app.js → Game.js → game/* and, under v8 coverage instrumentation in
// CI, failed with "Class extends value undefined is not a constructor
// or null" before the assertions even ran. Reduced to source-text
// assertions here so the guard rides on whatever import graph the
// production code happens to use.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../scripts/game/Mission.ts'), 'utf8');

describe('Mission.checkTutorial step-slicing fix', () => {
  it('initialises deletefrom to -1 (no step completed sentinel)', () => {
    // Pre-fix this was `let deletefrom = 0;`, which combined with
    // `slice(deletefrom)` kept the completed step at the head of the
    // remaining tutorial.
    expect(SRC).toMatch(/let\s+deletefrom\s*=\s*-1\b/);
    expect(SRC).not.toMatch(/let\s+deletefrom\s*=\s*0\b/);
  });

  it('slices the tutorial AFTER the completed index, not at it', () => {
    // The post-fix slice expression. We anchor on `slice(deletefrom +`
    // to catch any future "fix" that drops the +1 back off.
    expect(SRC).toMatch(/steps\s*=\s*steps\.slice\(\s*deletefrom\s*\+\s*1\s*\)/);
    expect(SRC).not.toMatch(/steps\s*=\s*steps\.slice\(\s*deletefrom\s*\)/);
  });

  it('still records deletefrom for both buyPerp and integrateProfileSet paths', () => {
    // Both completion sources must still mutate `deletefrom = k`,
    // otherwise the slice ends up dropping nothing.
    const buyPerpHit = /step\.buyPerp[\s\S]{0,200}deletefrom\s*=\s*k/m;
    const integrateHit = /step\.integrateProfileSet[\s\S]{0,200}deletefrom\s*=\s*k/m;
    expect(SRC).toMatch(buyPerpHit);
    expect(SRC).toMatch(integrateHit);
  });
});
