/**
 * Shared fixture builders for tests/handlers/*.test.js
 *
 * Centralises the four helpers that every handler test file re-implemented
 * locally. Import from here instead of copying.
 */
import { freshState } from '../../scripts/state.js';

/** Stable epoch used across all handler test suites (2023-11-14). */
export const FIXED_NOW = 1_700_000_000_000;

/**
 * Default game_values for handler tests.
 * @param {object} [overrides]
 */
export function mkGv(overrides) {
  return Object.assign({
    xp_value: 5, xp_level: 1,
    karma_value: 50, cash_value: 300, cash_spent: 0,
    profiles_value: 0, profiles_max: 1,
    ap_snapshot: 6, ap_update: FIXED_NOW,
    ap_inc_value: 1, ap_inc_interval: 120000, ap_max: 6,
  }, overrides || {});
}

/**
 * Base state: freshState('test@local') deep-merged with mkGv() defaults and
 * optional per-test overrides.
 * @param {object} [overrides]
 */
export function mkState(overrides) {
  overrides = overrides || {};
  var base = freshState('test@local');
  var gv = Object.assign({}, base.game_values, mkGv(), overrides.game_values || {});
  return Object.assign({}, base, overrides, { game_values: gv });
}

/**
 * Generic node row builder. Gestalt is derived from path's last segment,
 * matching the _seedNodesFromTree invariant in state.js.
 * @param {string} gameType
 * @param {string} path
 * @param {object} [instData]
 */
export function mkNode(gameType, path, instData) {
  var parts = path.split('.');
  var gestalt = parts[parts.length - 1];
  return {
    game_id:       'node_' + gestalt,
    game_type:     gameType,
    full_type:     gameType + ':' + gestalt,
    gestalt:       gestalt,
    full_path:     path,
    instance_data: instData || {},
  };
}

/**
 * Pre-charge_end charging entry parametric over now.
 * Defaults: now = FIXED_NOW, duration = 120 000 ms.
 * @param {string} path
 * @param {object} result
 * @param {string} gameType
 * @param {number} [now]
 */
export function mkChargingEntry(path, result, gameType, now) {
  var t   = now !== undefined ? now : FIXED_NOW;
  var dur = 120_000;
  var parts   = path.split('.');
  var gestalt = parts[parts.length - 1];
  return {
    path:         path,
    result:       result,
    charge_start: t - dur,
    charge_end:   t + dur,
    game_id:      'node_' + gestalt,
    game_type:    gameType,
  };
}
