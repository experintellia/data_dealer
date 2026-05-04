// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Build-time validation of type_settings.js and the ruleset.
 *
 * Guards against silent gameplay breakage from typos:
 *   1. Every mission-goal `workflow` used in the ruleset has a display string
 *      in type_settings.js `goals_texts` AND a corresponding handler in
 *      LocalEngine.ts.
 *   2. Every mission-goal `target` gestalt exists in the ruleset perps/tokens.
 *   3. Every `perp_id` / `token_id` referenced in the ruleset missions exists
 *      in the combined perp+token catalogue.
 *
 * type_settings.js is an AMD module; we analyse it as source text to avoid
 * RequireJS + jQuery dependencies in the Node test environment.
 */
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── load fixtures ─────────────────────────────────────────────────────────────

let rulesetDe, rulesetEn, localeDe, localeEn;
let goalsTextWorkflows, goalsTextMsgids, knownHandlerWorkflows;

beforeAll(() => {
  rulesetDe = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.de.json'), 'utf8'));
  rulesetEn = JSON.parse(readFileSync(join(root, 'data', 'ruleset_3.en.json'), 'utf8'));
  localeDe = JSON.parse(readFileSync(join(root, 'i18n', 'de_AT.json'), 'utf8'));
  localeEn = JSON.parse(readFileSync(join(root, 'i18n', 'en_US.json'), 'utf8'));

  var typeSettingsSrc = readFileSync(join(root, 'scripts', 'type_settings.js'), 'utf8');
  var localEngineSrc = readFileSync(join(root, 'scripts', 'LocalEngine.ts'), 'utf8');
  goalsTextWorkflows = extractGoalsTextWorkflows(typeSettingsSrc);
  goalsTextMsgids = extractGoalsTextMsgids(typeSettingsSrc);
  knownHandlerWorkflows = extractHandlerWorkflows(localEngineSrc);
});

// ── helper: extract goals_texts workflow keys from type_settings.js source ───

function extractGoalsTextWorkflows(src) {
  // Find the goals_texts block and extract its keys.
  // Pattern: "goals_texts": { "key": ..., "key2": ... }
  var match = src.match(/["']?goals_texts["']?\s*:\s*\{([^}]+)\}/);
  if (!match) return [];
  var block = match[1];
  var keys = [];
  var keyRe = /["']?([a-z_]+)["']?\s*:/g;
  var m;
  while ((m = keyRe.exec(block)) !== null) {
    keys.push(m[1]);
  }
  return keys;
}

// ── helper: extract display string msgids from goals_texts ────────────────────
//
// Each goals_texts entry maps a workflow key to _._("msgid").  This extracts
// the msgid strings so we can verify they exist in the locale files.

function extractGoalsTextMsgids(src) {
  var match = src.match(/["']?goals_texts["']?\s*:\s*\{([^}]+)\}/);
  if (!match) return [];
  var block = match[1];
  var msgids = [];
  // Matches: _._("goal Charge Perp %s") or _._(  'goal Buy Perp %s'  )
  // Note: _._( = identifier _ + dot + method _ + open-paren (one dot, not two).
  var re = /_\._\(\s*["']([^"']+)["']\s*\)/g;
  var m;
  while ((m = re.exec(block)) !== null) {
    msgids.push(m[1]);
  }
  return msgids;
}

// ── helper: check msgstr in locale JSON ──────────────────────────────────────

function hasMsgstr(localeData, msgid) {
  var entry = localeData[msgid];
  return Array.isArray(entry) && entry.length > 1 && entry[1] != null;
}

// ── helpers: derive handler workflows from LocalEngine.ts source ──────────────
//
// Instead of a hand-maintained constant, we extract the workflow string
// literals that LocalEngine.ts actually compares against goal.workflow so
// that removing a handler branch automatically fails the test.

function extractHandlerWorkflows(src) {
  // Matches: goal.workflow !== 'foo'  OR  goal.workflow === 'foo'
  var re = /goal\.workflow\s*[!=]==\s*'([^']+)'/g;
  var found = new Set();
  var m;
  while ((m = re.exec(src)) !== null) {
    found.add(m[1]);
  }
  return found;
}

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

describe('LocalEngine.ts — handler workflow extraction', () => {
  it('extracts at least 7 workflow handlers from LocalEngine.ts', () => {
    expect(knownHandlerWorkflows.size).toBeGreaterThanOrEqual(7);
  });

  it('contains the core workflows that have always existed', () => {
    ['buy_perp', 'charge_perp', 'collect_profiles', 'integrate_profiles', 'collect_cash'].forEach(
      function (w) {
        expect(knownHandlerWorkflows.has(w)).toBe(true);
      }
    );
  });
});

describe('type_settings.js — goals_texts workflow coverage', () => {
  it('goals_texts block is present in type_settings.js', () => {
    expect(goalsTextWorkflows.length).toBeGreaterThan(0);
  });

  it('every goals_texts workflow key is a known handler workflow', () => {
    var unknown = goalsTextWorkflows.filter(function (w) {
      return !knownHandlerWorkflows.has(w);
    });
    expect(unknown).toEqual([]);
  });

  it('every ruleset (de) mission-goal workflow has a display string in goals_texts', () => {
    var definedWorkflows = new Set(goalsTextWorkflows);
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
    var definedWorkflows = new Set(goalsTextWorkflows);
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
      if (w && !knownHandlerWorkflows.has(w)) {
        invalid.push({ mission: entry.mission, workflow: w });
      }
    });
    expect(invalid).toEqual([]);
  });

  it('every mission-goal target gestalt exists in perps, tokens, or powerups', () => {
    var allPerps = Object.keys(rulesetDe.perps || {});
    var allTokens = Object.keys(rulesetDe.tokens || {});
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
    var allPerps = Object.keys(rulesetEn.perps || {});
    var allTokens = Object.keys(rulesetEn.tokens || {});
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
    var allPerps = new Set(Object.keys(rulesetDe.perps || {}));
    var allTokens = new Set(Object.keys(rulesetDe.tokens || {}));
    var KNOWN_STATS = new Set([
      'xp_value',
      'cash_value',
      'karma_value',
      'profiles_max',
      'ap_snapshot',
      'ap_max',
    ]);

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

describe('goals_texts display strings — locale file coverage', () => {
  // Closes the loop between type_settings.js and the translation files:
  // every msgid used in goals_texts must have a non-null msgstr in both
  // de_AT.json and en_US.json.  This would have caught the missing
  // "goal Charge Perp %s" entry that was the root bug in issue #136.

  it('every goals_texts display string has a German translation in de_AT.json', () => {
    expect(goalsTextMsgids.length).toBeGreaterThan(0);
    var missing = goalsTextMsgids.filter(function (id) {
      return !hasMsgstr(localeDe, id);
    });
    expect(missing).toEqual([]);
  });

  it('every goals_texts display string has an English translation in en_US.json', () => {
    expect(goalsTextMsgids.length).toBeGreaterThan(0);
    var missing = goalsTextMsgids.filter(function (id) {
      return !hasMsgstr(localeEn, id);
    });
    expect(missing).toEqual([]);
  });
});
