// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Regression guard for the Database.mergeCued duplicate-updateGameValues
// fix. The function used to call `updateGameValues(gv, …, true)` twice:
// once silently at the top of the merge (line ~553) and again at the
// bottom after the profile-set was integrated. The second call re-ran
// Missions.updateMissions, re-fired `FXMissionGoalComplete` per completed
// goal, and re-cued `profile_set` rewards via getDatabase().cue — both
// effects duplicated.
//
// Reviewer point #272: the PR description says "structural fix, no test"
// but a regex assertion against the source pinning the call count
// guards against a future revert that re-introduces the duplicate.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../scripts/game/Database.ts'), 'utf8');

// Extract just the body of mergeCued so we don't accidentally count
// updateGameValues calls in other methods (e.g. the integrateProfileSet
// path at line 378 in this file uses it once, legitimately).
function mergeCuedBody() {
  const start = SRC.indexOf('mergeCued(');
  expect(start, 'mergeCued must exist in Database.ts').toBeGreaterThan(-1);
  // Walk braces from the opening of the method body to find the matching close.
  const openBrace = SRC.indexOf('{', start);
  expect(openBrace).toBeGreaterThan(-1);
  let depth = 0;
  let i = openBrace;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return SRC.slice(openBrace, i);
}

describe('Database.mergeCued — duplicate-updateGameValues guard', () => {
  it('calls groot.updateGameValues exactly once in the mergeCued body', () => {
    const body = mergeCuedBody();
    const matches = body.match(/groot\.updateGameValues\s*\(/g) || [];
    expect(matches.length).toBe(1);
  });

  it('does not call updateGameValues after setProfiles() in the same block', () => {
    // The duplicate call lived after `ps.remove()` and before
    // `groot.setProfiles()`. Pre-fix the sequence was
    //   ps.remove(); groot.updateGameValues(...); groot.setProfiles();
    // Post-fix it's just
    //   ps.remove(); groot.setProfiles();
    // Catch the regression even if someone reverts only the inner call
    // by checking the ordered pattern.
    const body = mergeCuedBody();
    expect(body).toMatch(/ps\.remove\(\)[\s\S]*?groot\.setProfiles\(/);
    expect(body).not.toMatch(/ps\.remove\(\)[\s\S]{0,500}groot\.updateGameValues\(/);
  });
});
