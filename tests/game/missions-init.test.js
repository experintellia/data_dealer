// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Regression guards for Missions.initMissions completion handling.
//
// 1. Original #272 fix: when the server reports an empty/undefined
//    `active_missions`, the old unguarded else-branch flipped EVERY
//    loaded mission complete=true and re-fired spurious
//    mission_complete events on reload. The active-walk must stay
//    gated on Array.isArray(active_missions) && length.
//
// 2. Empty-mission-tab regression: removing that else-branch left
//    finished missions with complete=false whenever the player had
//    completed every available mission (producer emits
//    `active_missions: []`). getVisibleMissions() needs active||
//    complete, so the mission tab rendered EMPTY on reload. The fix
//    derives `complete` from goal state independently of
//    active_missions — a mission whose goals are all done is marked
//    complete, which (unlike the blanket else-branch) never touches a
//    never-started mission.
//
// Runtime instantiation of Missions drags in app.js → Game.js → game/*
// and is CI-flaky under v8 coverage (see mission-tutorial-slice note),
// so these stay source-text guards.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../scripts/game/Missions.ts'), 'utf8');

// Anchor on the method signature (not the line-32 comment mention) and
// take through the method's terminating `checkProjectGoals()` call.
const initBodyMatch = SRC.match(
  /initMissions\(raw_data[\s\S]*?this\.checkProjectGoals\(\);\n {2}\}/
);
const INIT_BODY = initBodyMatch ? initBodyMatch[0] : '';

describe('Missions.initMissions — original #272 completion guard', () => {
  it('init body is locatable', () => {
    expect(initBodyMatch, 'initMissions body must be locatable').toBeTruthy();
  });

  it('gates the active-walk on Array.isArray(active_missions)', () => {
    expect(INIT_BODY).toMatch(/Array\.isArray\s*\(\s*[A-Za-z_]+\.active_missions\s*\)/);
  });

  it('marks complete via the active_missions walk, not a blanket else', () => {
    expect(INIT_BODY).toMatch(
      /Array\.isArray[\s\S]{0,400}active_missions\.forEach[\s\S]{0,400}setState\(\s*['"]complete['"]/
    );
    // The pre-fix `else { Object.values(this.Missions).forEach(... mark
    // every mission complete ...) }` must not come back.
    expect(INIT_BODY).not.toMatch(
      /\}\s*else\s*\{[\s\S]{0,200}Object\.values\(this\.Missions\)[\s\S]{0,200}setState\(\s*['"]complete['"]\s*,\s*true/
    );
  });
});

describe('Missions.initMissions — empty-tab regression fix', () => {
  it('derives complete from mission_goals independently of active_missions', () => {
    // A goals-aggregation pass keyed by mission gestalt, followed by a
    // setState('complete', true) for missions whose goals are all done.
    expect(INIT_BODY).toMatch(/raw_data\.mission_goals/);
    expect(INIT_BODY).toMatch(/allGoalsDone/);
    expect(INIT_BODY).toMatch(
      /allGoalsDone[\s\S]{0,300}setState\(\s*['"]complete['"]\s*,\s*true\s*\)/
    );
  });

  it('the goal-derived pass is outside the active_missions length guard', () => {
    // It must run even when active_missions is empty — i.e. it is not
    // nested inside the `if (Array.isArray(...) && ....length)` block.
    const guardIdx = INIT_BODY.indexOf('Array.isArray');
    const guardClose = INIT_BODY.indexOf('\n    }', guardIdx);
    const goalsIdx = INIT_BODY.indexOf('allGoalsDone');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(goalsIdx).toBeGreaterThan(guardClose);
  });
});
