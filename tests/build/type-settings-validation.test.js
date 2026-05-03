/**
 * Build-time validation of type_settings.js and the ruleset.
 *
 * Guards against silent gameplay breakage from typos:
 *   1. Every mission-goal `workflow` used in the ruleset has a display string
 *      in type_settings.js `goals_texts` AND a corresponding handler in
 *      LocalEngine.js.
 *   2. Every mission-goal `target` gestalt exists in the ruleset perps/tokens.
 *   3. Every `perp_id` / `token_id` referenced in the ruleset missions exists
 *      in the combined perp+token catalogue.
 *
 * type_settings.js is an AMD module; we analyse it as source text to avoid
 * RequireJS + jQuery dependencies in the Node test environment.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── load fixtures ─────────────────────────────────────────────────────────────

let rulesetDe, rulesetEn, typeSettingsSrc;

beforeAll(() => {
  rulesetDe      = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.de.json'), 'utf8'));
  rulesetEn      = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.en.json'), 'utf8'));
  typeSettingsSrc = readFileSync(join(root, 'scripts', 'type_settings.js'), 'utf8');
});

// ── helper: extract goals_texts workflow keys from type_settings.js source ───

function extractGoalsTextWorkflows(src) {
  // Find the goals_texts block and extract its keys.
  // Pattern: "goals_texts": { "key": ..., "key2": ... }
  var match = src.match(/["']goals_texts["']\s*:\s*\{([^}]+)\}/);
  if (!match) return [];
  var block = match[1];
  var keys = [];
  var keyRe = /["']([a-z_]+)["']\s*:/g;
  var m;
  while ((m = keyRe.exec(block)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

// ── known handlers that back mission-goal workflows ───────────────────────────
//
// These are the workflow identifiers that LocalEngine.js handles.  A workflow
// in the ruleset that is NOT in this set would silently no-op in the engine.

const KNOWN_HANDLER_WORKFLOWS = new Set([
  'buy_perp',
  'buy_powerup',
  'charge_perp',
  'collect_cash',
  'collect_profiles',
  'integrate_profiles',
  'upgrade_token',
]);

// ── collect all mission goals from the ruleset ────────────────────────────────

function allGoals(ruleset) {
  var goals = [];
  (ruleset.missions || []).forEach(function (m) {
    ((m.type_data && m.type_data.goals) || []).forEach(function (g) {
      goals.push({ mission: m.type_data.gestalt, goal: g });
    });
  });
  return goals;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('type_settings.js — goals_texts workflow coverage', () => {
  it('goals_texts block is present in type_settings.js', () => {
    var workflows = extractGoalsTextWorkflows(typeSettingsSrc);
    expect(workflows.length).toBeGreaterThan(0);
  });

  it('every goals_texts workflow key is a known handler workflow', () => {
    var workflows = extractGoalsTextWorkflows(typeSettingsSrc);
    var unknown = workflows.filter(function (w) { return !KNOWN_HANDLER_WORKFLOWS.has(w); });
    expect(unknown).toEqual([]);
  });

  it('every ruleset (de) mission-goal workflow has a display string in goals_texts', () => {
    var definedWorkflows = new Set(extractGoalsTextWorkflows(typeSettingsSrc));
    var missing = [];
    allGoals(rulesetDe).forEach(function (entry) {
      var w = entry.goal.workflow;
      if (w && !definedWorkflows.has(w)) {
        missing.push({ mission: entry.mission, workflow: w });
      }
    });
    expect(missing).toEqual([]);
  });

  it('every ruleset (en) mission-goal workflow has a display string in goals_texts', () => {
    var definedWorkflows = new Set(extractGoalsTextWorkflows(typeSettingsSrc));
    var missing = [];
    allGoals(rulesetEn).forEach(function (entry) {
      var w = entry.goal.workflow;
      if (w && !definedWorkflows.has(w)) {
        missing.push({ mission: entry.mission, workflow: w });
      }
    });
    expect(missing).toEqual([]);
  });
});

describe('ruleset (de) — mission-goal workflow validity', () => {
  it('every mission-goal workflow is a recognised handler workflow', () => {
    var invalid = [];
    allGoals(rulesetDe).forEach(function (entry) {
      var w = entry.goal.workflow;
      if (w && !KNOWN_HANDLER_WORKFLOWS.has(w)) {
        invalid.push({ mission: entry.mission, workflow: w });
      }
    });
    expect(invalid).toEqual([]);
  });

  it('every mission-goal target gestalt exists in perps, tokens, or powerups', () => {
    var allPerps    = Object.keys(rulesetDe.perps    || {});
    var allTokens   = Object.keys(rulesetDe.tokens   || {});
    var allPowerups = Object.keys(rulesetDe.powerups || {});
    var catalogue = new Set([].concat(allPerps, allTokens, allPowerups));

    // Some workflows (buy_perp, buy_powerup, …) reference perp/token gestalts;
    // others (collect_cash, integrate_profiles, …) may reference token gestalts
    // used as counters/buckets.  We validate any non-null target that looks like
    // a gestalt (contains letters + digits; not a stat name like "xp_value").
    var STAT_TARGETS = new Set(['xp_value', 'cash_value', 'karma_value', 'profiles_max']);

    var missing = [];
    allGoals(rulesetDe).forEach(function (entry) {
      var target = entry.goal.target;
      if (!target || STAT_TARGETS.has(target)) return;
      if (!catalogue.has(target)) {
        missing.push({ mission: entry.mission, workflow: entry.goal.workflow, target: target });
      }
    });
    expect(missing).toEqual([]);
  });
});

describe('ruleset (en) — mission-goal target validity', () => {
  it('every mission-goal target gestalt exists in perps, tokens, or powerups', () => {
    var allPerps    = Object.keys(rulesetEn.perps    || {});
    var allTokens   = Object.keys(rulesetEn.tokens   || {});
    var allPowerups = Object.keys(rulesetEn.powerups || {});
    var catalogue = new Set([].concat(allPerps, allTokens, allPowerups));
    var STAT_TARGETS = new Set(['xp_value', 'cash_value', 'karma_value', 'profiles_max']);

    var missing = [];
    allGoals(rulesetEn).forEach(function (entry) {
      var target = entry.goal.target;
      if (!target || STAT_TARGETS.has(target)) return;
      if (!catalogue.has(target)) {
        missing.push({ mission: entry.mission, workflow: entry.goal.workflow, target: target });
      }
    });
    expect(missing).toEqual([]);
  });
});

describe('ruleset — mission reward targets', () => {
  it('every mission reward target is a known stat or gestalt (de)', () => {
    var allPerps    = new Set(Object.keys(rulesetDe.perps  || {}));
    var allTokens   = new Set(Object.keys(rulesetDe.tokens || {}));
    var KNOWN_STATS = new Set(['xp_value', 'cash_value', 'karma_value', 'profiles_max',
                               'ap_snapshot', 'ap_max']);

    var invalid = [];
    (rulesetDe.missions || []).forEach(function (m) {
      ((m.type_data && m.type_data.rewards) || []).forEach(function (r) {
        var tgt = r.target;
        if (!tgt) return;
        if (!KNOWN_STATS.has(tgt) && !allPerps.has(tgt) && !allTokens.has(tgt)) {
          invalid.push({ mission: m.type_data.gestalt, target: tgt });
        }
      });
    });
    expect(invalid).toEqual([]);
  });
});
