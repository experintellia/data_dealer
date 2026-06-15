// In-process gameplay handlers, consumed by app.js as a default-namespace
// import.  No DOM globals in handler bodies; safe to import from Node
// for tests.
//
// Handlers implemented here: getToken, ping, getSessionLocale, loadGame (#12),
// getRanking, setDisplayName, setPerpCoordinates (#13),
//   getProvidedPerps, getPowerups (#14), buyKarma (#19),
//   buyPowerup, sellPowerup, buySlots (#18), buyPerp (#15),
//   chargePerp (#16), collectPerp, integrateCollected (#17).
// resetGame is intentionally absent — in webxdc, reset = re-share the .xdc.
// Remaining handlers are stubs that return a rejected Promise.

import rulesetBase from '../data/ruleset_base.json' with { type: 'json' };
import i18nDe from '../i18n/de_AT.json' with { type: 'json' };
import i18nEn from '../i18n/en_US.json' with { type: 'json' };
import rulesetStringsDe from '../i18n/ruleset.de.json' with { type: 'json' };
import rulesetStringsEn from '../i18n/ruleset.en.json' with { type: 'json' };
import rulesetStringsFr from '../i18n/ruleset.fr.json' with { type: 'json' };
import { getState, setState } from './boot.js';
import { now as clockNow } from './clock.js';
import type { UpgradeValuesShape } from './game/ProfileSet.js';
import { injectTranslations } from './inject-translations.js';
import { materialize } from './materializer.js';
import { applyDelta, buildSaveFile, parseSaveFile } from './state.js';
import type {
  ChargingEntry,
  Delta,
  GameNode,
  GameValues,
  LocalState,
  MissionGoal,
} from './state.js';
import { getAvatarUrl } from './webxdc-avatars.js';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/** Locale shorthand persisted in state.locale and selected by handlers. */
type Locale = 'de' | 'en' | 'fr';

/** Loose ruleset shape — full schema is the JSON, not enforced here. */
interface PerpDef {
  game_type?: string;
  type_data?: PerpTypeData;
  [key: string]: unknown;
}

/**
 * Loose type for per-perp ruleset data.  Real schema lives in
 * data/ruleset_3.*.json and is not formalized; the fields below are the
 * ones actually read by the handlers in this module.  `[key: string]:
 * unknown` covers the long tail (description, illustration, etc.) without
 * forcing typed reads where the handlers don't care.
 */
interface PerpTypeData {
  required_level?: number;
  required_providers?: string[];
  provided_perps?: string[];
  provided_ads?: PowerupDef[];
  provided_upgrades?: PowerupDef[];
  provided_teammembers?: PowerupDef[];
  powerups?: PowerupDef[];
  charge_cost?: number;
  collect_amount?: number;
  collect_risk?: number;
  charge_time?: number;
  collect_time?: number;
  tokens?: TokenSpec[];
  contained_tokens?: TokenSpec[];
  income_base?: number;
  xp_inc?: number;
  price?: number;
  profileset_size?: number;
  profiles_max?: number;
  slot_cost?: number;
  slot_cost_modifier?: number;
  max_slots?: number;
  slots?: SlotEntry[];
  origin_full_type?: string;
  origin_gestalt?: string;
  title?: string;
  [key: string]: unknown;
}

interface SlotEntry {
  type: string;
  count: number;
  price?: number;
  [key: string]: unknown;
}

interface TokenSpec {
  gestalt?: string;
  amount?: number;
  is_required?: boolean;
  [key: string]: unknown;
}

interface PowerupDef {
  gestalt?: string;
  slot?: number;
  full_type?: string;
  price?: number;
  charge_cost_modifier?: number;
  collect_amount_modifier?: number;
  collect_risk_modifier?: number;
  [key: string]: unknown;
}

/**
 * Per-node instance_data fields handlers read.  Persisted into state.nodes
 * via reducers; not all nodes carry every field.  Open-ended so legacy
 * fields (x, y, charge_start, etc.) pass through without explicit typing.
 */
interface NodeInstanceData {
  amount?: number;
  charge_cost?: number;
  collect_amount?: number;
  collect_risk?: number;
  powerups?: PowerupDef[];
  tokens?: TokenSpec[];
  charge_start?: number;
  [key: string]: unknown;
}

interface MissionDef {
  game_type?: string;
  type_data?: MissionTypeData;
  [key: string]: unknown;
}

interface MissionTypeData {
  gestalt?: string;
  title?: string;
  required_mission?: string;
  goals?: GoalDef[];
  rewards?: Array<{ target?: string; amount?: number }>;
  [key: string]: unknown;
}

interface GoalDef {
  goal_id?: string;
  workflow?: string;
  target?: string;
  amount?: number;
  position?: number;
  project?: string | null;
  [key: string]: unknown;
}

interface RewardSet {
  cash_value?: number;
  xp_value?: number;
  karma_value?: number;
  profiles_max?: number;
  profile_sets?: Array<{ profile_set: unknown; origin: string; collect_id: string }>;
  [key: string]: unknown;
}

interface LevelEntry {
  number: number;
  xp_min: number;
  xp_max: number;
  ap_max: number;
  [key: string]: unknown;
}

interface Karmalauter {
  type_data: {
    gestalt: string;
    price: number;
    karma_points: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Karmalizer {
  type_data: {
    gestalt?: string;
    karma_points?: number;
    required_level?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Ruleset {
  version: string | number;
  perps: Record<string, PerpDef>;
  tokens: Record<string, PerpDef | undefined>;
  powerups: Record<string, { game_type?: string; type_data?: Record<string, unknown> } | undefined>;
  levels: LevelEntry[];
  karmalauters: Karmalauter[];
  karmalizers: Karmalizer[];
  missions: MissionDef[];
  [key: string]: unknown;
}

/** Union of all known translation keys derived from the canonical locale file. */
type I18nKey = keyof typeof i18nEn;
/** Locale-table entry: the actual value type from the JSON (metadata object or [msgctxt, msgstr] tuple). */
type I18nEntry = (typeof i18nEn)[I18nKey];
/** Typed over the exact key set of the canonical locale file. */
type I18nTable = typeof i18nEn;

/** Indexes built lazily over state.nodes. */
interface NodeMaps {
  paths: Record<string, GameNode>;
  gestalts: Record<string, true>;
}

/** Achievement event payload posted via webxdc.sendUpdate at action sites. */
interface AchievementPayload {
  kind: 'achievement';
  achievement_kind: string;
  addr: string;
  name: string;
  ts: number;
  [key: string]: unknown;
}

type Emitter = (ev: string, pl: unknown) => void;
type AchievementSender = (msg: { info: string; payload: AchievementPayload }) => void;

interface MissionUpdate {
  complete_missions: string[];
  updated_missions: string[];
  mission_data: {
    active_missions: string[];
    mission_goals: MissionGoal[];
  };
}

interface MissionAdvanceResult {
  missions: MissionUpdate | null;
  rewards?: RewardSet;
  mission_goals: MissionGoal[];
  active_missions: string[];
}

// ---------------------------------------------------------------------------
// Event emitter — injected by production boot (app.js); no-op in tests.
// Call setEmitter(fn) with fn(ev, pl) before any gameplay begins.
// ---------------------------------------------------------------------------
let _emitter: Emitter | null = null;

/** Inject the event emitter.  Call before gameplay begins. */
export function setEmitter(fn: Emitter): void {
  _emitter = fn;
}

function _emit(ev: string, pl: unknown): void {
  if (_emitter) _emitter(ev, pl);
}

// Typed read for the open-ended `[key: string]: unknown` regions of
// PerpTypeData / NodeInstanceData / ruleset records.  Returns the number
// at `key` or undefined if the field is missing or not a number — keeps
// the cast surface to a single helper instead of scattered `as` reads.
function _readNumber(rec: object | undefined, key: string): number | undefined {
  if (!rec) return undefined;
  var v = (rec as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

// ---------------------------------------------------------------------------
// Ruleset selection — locale-memoised, node-index helpers
// ---------------------------------------------------------------------------

let _rulesetLocaleCache: Locale | null = null;
let _rulesetCache: Ruleset | null = null;

function _getRuleset(): Ruleset {
  var state = getState();
  var locale: Locale = state && state.locale === 'en' ? 'en' : state && state.locale === 'fr' ? 'fr' : 'de';
  if (_rulesetLocaleCache === locale && _rulesetCache) {
    return _rulesetCache;
  }
  var strings = locale === 'en' ? rulesetStringsEn : locale === 'fr' ? rulesetStringsFr : rulesetStringsDe;
  var ruleset = injectTranslations(rulesetBase, strings) as unknown as Ruleset;
  _rulesetLocaleCache = locale;
  _rulesetCache = ruleset;
  return ruleset;
}

let _nodeMapRef: GameNode[] | null = null;
let _nodeMapCache: NodeMaps | null = null;

function _getNodeMaps(nodes: GameNode[]): NodeMaps {
  if (nodes === _nodeMapRef && _nodeMapCache) return _nodeMapCache;
  _nodeMapRef = nodes;
  var paths: Record<string, GameNode> = {};
  var gestalts: Record<string, true> = {};
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (!n) continue;
    paths[n.full_path] = n;
    var g = n.gestalt || _gestaltFrom(n.full_type);
    if (g) gestalts[g] = true;
  }
  _nodeMapCache = { paths: paths, gestalts: gestalts };
  return _nodeMapCache;
}

function _gestaltFrom(fullType: string | undefined): string | null {
  if (!fullType) return null;
  var idx = fullType.indexOf(':');
  return idx >= 0 ? fullType.slice(idx + 1) : null;
}

function _gameTypeFrom(fullType: string | undefined): string {
  if (!fullType) return '';
  var idx = fullType.indexOf(':');
  return idx >= 0 ? fullType.slice(0, idx) : fullType;
}

function _isProvidable(
  gestalt: string,
  ruleset: Ruleset,
  playerLevel: number,
  ownedGestalts: Record<string, true>
): boolean {
  var def = ruleset.perps[gestalt];
  if (!def) return false;
  var td = def.type_data || {};
  if ((td.required_level || 0) > playerLevel) return false;
  var reqs = td.required_providers || [];
  for (var i = 0; i < reqs.length; i++) {
    var req = reqs[i];
    if (!req || !ownedGestalts[req]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Delta persistence
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Achievement emit — fires info messages at action sites only.
// setSendAchievement(fn) injects a spy in tests; production uses webxdc.
// ---------------------------------------------------------------------------
let _sendAchievementFn: AchievementSender | null = null;

export function setSendAchievement(fn: AchievementSender): void {
  _sendAchievementFn = fn;
}

// Locale-aware format-string lookup.  Replaces %s tokens left-to-right.
function _t(msgid: string, ...subs: unknown[]): string {
  var state = getState();
  var locale: Locale = state && state.locale === 'en' ? 'en' : 'de';
  var table: I18nTable = locale === 'en' ? i18nEn : i18nDe;
  var entry = table[msgid as I18nKey];
  var tmpl: string = Array.isArray(entry) && entry[1] ? entry[1] : msgid;
  for (var i = 0; i < subs.length; i++) {
    tmpl = tmpl.replace('%s', String(subs[i]));
  }
  return tmpl;
}

// Fire an achievement info message.  Called only at handler action sites —
// never from applyDelta or the materializer so replay never re-emits.
function triggerAchievement(
  kind: string,
  info: string,
  extraPayload?: Record<string, unknown>
): void {
  var state = getState();
  var addr = state ? state.addr : '';
  var name = state ? state.display_name || addr : addr;
  // kind: 'achievement' is the top-level discriminator for webxdc consumers.
  // achievement_kind carries the subtype (mission_done, levelup, joined, …).
  var payload: AchievementPayload = {
    kind: 'achievement',
    achievement_kind: kind,
    addr: addr,
    name: name,
    ts: clockNow(),
  };
  if (extraPayload) Object.assign(payload, extraPayload);
  if (_sendAchievementFn) {
    _sendAchievementFn({ info: info, payload: payload });
  }
  if (typeof webxdc !== 'undefined' && webxdc) {
    webxdc.sendUpdate({ info: info, payload: payload }, '');
  }
}

// Canonical webxdc: handlers only SEND. State mutation happens solely in the
// setUpdateListener callback (scripts/boot.ts) when the messenger delivers the
// update back — including our own. Nothing here mutates state or reads it back;
// the real Delta Chat messenger delivers asynchronously, so any synchronous
// post-send read would observe stale state.
function _persistDelta(delta: Delta): void {
  if (typeof webxdc !== 'undefined' && webxdc) {
    webxdc.sendUpdate({ payload: delta }, '');
  }
}

// ---------------------------------------------------------------------------
// PRNG helpers — port of chargecollect.py::getVariatedAmount (±5% jitter).
// Seed is derived from (ts, path) so replaying the same delta always produces
// the same charge_result.
// ---------------------------------------------------------------------------
function _djb2(str: string): number {
  var h = 5381;
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(33, h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function _seededRand(seed: number): number {
  var s = seed >>> 0;
  s = (Math.imul(1664525, s) + 1013904223) >>> 0;
  return s / 0xffffffff;
}

function _getVariatedAmount(baseAmount: number, ts: number, path: string): number {
  var seed = ((ts & 0xffffffff) ^ _djb2(path)) >>> 0;
  var rand = _seededRand(seed); // uniform 0..1
  var variation = rand * 0.1 - 0.05; // map to −0.05…+0.05 (±5%)
  return Math.round(baseAmount * (1 + variation));
}

// ---------------------------------------------------------------------------
// Implemented handlers
// ---------------------------------------------------------------------------

/**
 * getToken() → Promise<{result: string}>
 * Returns webxdc.selfAddr (or 'local' in non-webxdc environments).
 */
export function getToken(): Promise<{ result: string }> {
  var addr = typeof webxdc !== 'undefined' && webxdc ? webxdc.selfAddr : '';
  return Promise.resolve({ result: addr || 'local' });
}

/**
 * ping() → Promise<{result: "pong"}>
 * Health check; resolves synchronously.
 */
export function ping(): Promise<{ result: 'pong' }> {
  return Promise.resolve({ result: 'pong' });
}

/**
 * getSessionLocale() → Promise<{result: string}>
 * Returns locale string; Game.js checks === "de" for branch selection.
 * Returns state.locale if persisted, otherwise defaults to "de".
 */
export function getSessionLocale(): Promise<{ result: Locale }> {
  var state = getState();
  var locale: Locale = state && (state.locale === 'en' || state.locale === 'fr') ? state.locale : 'de';
  return Promise.resolve({ result: locale });
}

/**
 * setLocale(localeCode) → Promise<{result: string}>
 *
 * Persists the player's preferred locale shorthand ('de', 'en', or 'fr') as a delta
 * so the choice survives a page reload.  The caller is responsible for
 * calling location.reload() after this resolves.
 * Invalid locale codes are silently ignored (result still echoes the code).
 */
export function setLocale(localeCode: string): Promise<{ result: string }> {
  if (localeCode !== 'de' && localeCode !== 'en' && localeCode !== 'fr') {
    return Promise.resolve({ result: localeCode });
  }

  var state = getState();
  _persistDelta({
    kind: 'delta',
    op: 'setLocale',
    addr: state ? state.addr : '',
    locale: localeCode,
    ts: clockNow(),
  });

  return Promise.resolve({ result: localeCode });
}

// ---------------------------------------------------------------------------
// Save export / import (issue #127)
// ---------------------------------------------------------------------------

/** Filename used for exported saves; also the suggested name on re-import. */
export var SAVE_FILE_NAME = 'data_dealer_save.json';

/** Result of an importSave attempt; the popup maps each error to a message. */
export type ImportSaveResult =
  | { ok: true }
  | { cancelled: true }
  | { error: 'malformed' | 'version' | 'unavailable' };

/**
 * exportSave() → Promise<{result: {ok: boolean}}>
 *
 * Serializes the *current player's* progress (no peer/leaderboard data — see
 * buildSaveState) and hands it to webxdc.sendToChat so the player can send the
 * file into any chat as a backup.  sendToChat may close the app before its
 * promise settles (per the webxdc contract); callers must not depend on the
 * resolution to do anything destructive.
 */
export function exportSave(): Promise<{ result: { ok: boolean } }> {
  if (typeof webxdc === 'undefined' || !webxdc || typeof webxdc.sendToChat !== 'function') {
    return Promise.resolve({ result: { ok: false } });
  }
  var save = buildSaveFile(getState());
  var json = JSON.stringify(save, null, 2);
  return webxdc
    .sendToChat({
      file: { name: SAVE_FILE_NAME, plainText: json },
      text: _t('save export chat text'),
    })
    .then(function () {
      return { result: { ok: true } };
    })
    .catch(function () {
      return { result: { ok: false } };
    });
}

/**
 * importSave() → Promise<{result: ImportSaveResult}>
 *
 * Lets the player pick a previously-exported save via webxdc.importFiles,
 * validates it, then persists an `importSave` delta that replaces the player's
 * own progress on the next replay.  A visible chat message is attached to the
 * same sendUpdate (issue #127's anti-cheat transparency requirement) so other
 * participants can see that a save was loaded.
 *
 * Mirrors setLocale's contract: state isn't mutated synchronously — the caller
 * reloads after a successful ({ok:true}) result so boot() replays the new
 * importSave delta and rebuilds state from it.
 */
export function importSave(): Promise<{ result: ImportSaveResult }> {
  if (typeof webxdc === 'undefined' || !webxdc || typeof webxdc.importFiles !== 'function') {
    return Promise.resolve({ result: { error: 'unavailable' } });
  }
  // Capture a non-undefined reference so the async closures below keep the
  // narrowing the early-return guard established.
  var wx = webxdc;
  return wx
    .importFiles({ extensions: ['.json'], mimeTypes: ['application/json'] })
    .then(function (files): Promise<{ result: ImportSaveResult }> {
      var file = files && files[0];
      if (!file) {
        return Promise.resolve({ result: { cancelled: true } });
      }
      return file.text().then(function (text):
        | { result: ImportSaveResult }
        | Promise<{ result: ImportSaveResult }> {
        var parsed = parseSaveFile(text);
        if (!parsed.ok) {
          return { result: { error: parsed.error } };
        }
        var state = getState();
        var snapshot = parsed.save.state;
        var name = state.display_name || snapshot.display_name || wx.selfName || state.addr;

        // Persist the import as a delta AND surface a one-line chat notice via
        // the same update's `info` field — this is the issue #127 anti-cheat
        // transparency signal, broadcast to every peer.  The delta replays
        // own-only (addr guard); `info`/`summary` are messenger metadata
        // ignored by applyDelta.
        //
        // CRITICAL: webxdc.sendUpdate does NOT deliver/persist synchronously
        // — the listener fires on a later turn and (in Delta Chat and the
        // @webxdc/vite-plugins simulator) the returned thenable resolves only
        // once the durability write commits.  The caller reloads the page on
        // {ok:true}, so we MUST wait for that write before reporting success;
        // otherwise the reload races persistence and the imported save — and
        // its chat message — are silently dropped.  `Promise.resolve(...)`
        // tolerates both the spec's `void` return and the simulator's
        // Promise.
        var sent = wx.sendUpdate(
          {
            payload: _mkDelta(state.addr, 'importSave', [], {
              state: snapshot,
              // Mirror game_values at the top level so the peer aggregator
              // refreshes this player's leaderboard row from the imported save.
              game_values: snapshot.game_values,
            }),
            info: _t('save imported chat info', name),
          },
          ''
        ) as unknown as void | Promise<void>;
        return Promise.resolve(sent).then(function (): { result: ImportSaveResult } {
          return { result: { ok: true } };
        });
      });
    })
    .catch(function (): { result: ImportSaveResult } {
      return { result: { error: 'malformed' } };
    });
}

/**
 * loadGame() → Promise<{result: GameData}>
 *
 * Runs the materializer once against current state, persists the result,
 * builds the response shape expected by GameRoot.prototype.loadGame
 * (Game.js:1876), and schedules event emission for any charges that
 * completed during the away window.
 */
export function loadGame(): Promise<{ result: ReturnType<typeof _buildLoadGameResponse> }> {
  var state = getState();
  var now = clockNow();

  // freshState now ships the trunk-mission seed inline, so a player whose
  // node_counter is still 0 has not yet bought anything — that's our
  // "is_new_game" signal for GameRoot.loadGame's scroll-to-top heuristic.
  var isNewGame = !state.node_counter;

  var mat = materialize(state, now);
  // Lazy-seed mission_goals from ruleset for any active mission that hasn't
  // had its goals populated yet (e.g. fresh game, or a mission activated by
  // legacy code that didn't seed goals). This is the prerequisite for
  // mission progression: empty goals → progression handlers no-op.
  var seededState = _seedMissionGoals(mat.state);
  seededState = _repairUpgradeTokens(seededState);
  setState(seededState);

  // Persist as a recheckMissions delta so the repair lands in durable
  // history; otherwise rewards would be reapplied every materialize pass.
  var startupRepair = _repairStuckMissionGoals(seededState);
  var startupLevelup = 0;
  if (startupRepair && startupRepair.missions) {
    // Reward XP banked while away may cross a level threshold; _applyRepairRewards
    // refills AP and advances ap_max/xp_level so the next materialize() pass
    // doesn't clamp the snapshot back to the old ceiling. The level number is
    // remembered so the load can surface the popup below.
    var rewardResult = _applyRepairRewards(seededState.game_values || {}, startupRepair.rewards);
    var startupGv = rewardResult.game_values;
    startupLevelup = rewardResult.levelup;
    var recheckDelta = _mkDelta(seededState.addr, 'recheckMissions', [], {
      game_values: startupGv,
      missions: startupRepair.missions,
    });
    _persistDelta(recheckDelta);
    // State mutates only in the setUpdateListener (canonical webxdc), which the
    // async messenger has not invoked yet. Project the same delta locally —
    // applyDelta is pure — to build this call's response without reading back
    // global state. The listener independently commits the durable mutation.
    seededState = applyDelta(seededState, recheckDelta);
  }

  // Re-arm one-shot materializers for any charges still in flight. Clear
  // any prior handles first so calling loadGame twice doesn't queue
  // duplicate node_ready emissions for the same charge.
  // A charge that completed during the away window is emitted by the
  // queueMicrotask mat.events loop below (and re-rendered ready via the
  // _loadReady path); only still-charging entries get a timer here. Any
  // overlap is a UI no-op because markReady() is idempotent
  // (`if (gperp.renderReady) return;` in all four perp classes).
  _clearAllChargeReady();
  var stillCharging = (seededState && seededState.nodes_charging) || [];
  for (var i = 0; i < stillCharging.length; i++) {
    var c = stillCharging[i];
    if (c && typeof c.charge_end === 'number') {
      _scheduleChargeReady(c);
    }
  }

  var gameData = _buildLoadGameResponse(seededState, now, isNewGame);

  // Schedule event emission via queueMicrotask so it runs after the caller's
  // .then() resolves and Game.js has wired up its event handlers.
  var events = mat.events;
  queueMicrotask(function () {
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e) _emit(e.ev, e.pl);
    }
    // A stuck-mission repair that banked enough XP to level up surfaces the
    // level-up popup the way mid-game handlers do — via a new_items event the
    // GameRoot turns into a notification.
    if (startupLevelup) {
      _emit('new_items', { levelup: startupLevelup });
    }
  });

  return Promise.resolve({ result: gameData });
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function _buildLoadGameResponse(state: LocalState, now: number, isNewGame: boolean) {
  var ruleset = _getRuleset();

  // type_registry: merged dict of all perp/token/powerup type definitions.
  // Keys are gestalt names (or hash keys for StoryPerps without a gestalt).
  var typeRegistry = Object.assign({}, ruleset.perps, ruleset.tokens, ruleset.powerups);

  // ap_initial / ap_offset are recomputed on read (never stored).
  // After materializer, ap_snapshot already reflects the current AP value.
  var gv = state.game_values || {};
  var gameValues = Object.assign({}, gv, {
    ap_initial: typeof gv.ap_snapshot === 'number' ? gv.ap_snapshot : 0,
    ap_offset: 0,
  });

  return {
    version: String(ruleset.version),
    _id: state.addr,
    type_registry: typeRegistry,
    // type_data becomes the GameRoot type_data; levels must be present for
    // GameRoot.getLevelByXP (Game.js:1704).
    type_data: {
      levels: ruleset.levels,
      game_values: gameValues,
    },
    user: {
      auth_username: state.addr,
      display_name: state.display_name || '',
    },
    Imperium: {
      game_id: 'Imperium',
      full_path: 'Imperium',
      instance_data: {},
      type_data: {},
    },
    Database: {
      game_id: 'Database',
      full_path: 'Database',
      instance_data: {},
      type_data: {},
    },
    nodes: state.nodes || [],
    nodes_charging: state.nodes_charging || [],
    nodes_collect: state.nodes_collect || [],
    db_queue: state.db_queue || [],
    karmalauters: ruleset.karmalauters,
    karmalizers: ruleset.karmalizers,
    server_time: { $date: now },
    is_new_game: typeof isNewGame === 'boolean' ? isNewGame : !state.node_counter,
    locale_persisted: !!state.locale,
    missions: ruleset.missions,
    mission_goals: state.mission_goals || [],
    active_missions: state.active_missions || [],
    // Clone the seen-maps so Game.js mutating raw_data.* doesn't poison
    // state.* via shared object reference (which would make
    // dismissMissionBriefing / markTokenSeen think the gestalt is already
    // seen and skip the delta commit, so the dismissal never persists).
    mission_briefings_seen: Object.assign({}, state.mission_briefings_seen || {}),
    tokens_seen: Object.assign({}, state.tokens_seen || {}),
  };
}

export function getProvidedPerps(
  gnodePath: string
): Promise<{ result: { error: number } | { buyable: string[] } }> {
  var state = getState();
  var nodes = (state && state.nodes) || [];
  var maps = _getNodeMaps(nodes);
  var node = maps.paths[gnodePath];
  if (!node) return Promise.resolve({ result: { error: 0 } });

  var gestalt = node.gestalt || _gestaltFrom(node.full_type);
  if (!gestalt) return Promise.resolve({ result: { error: 0 } });

  var ruleset = _getRuleset();
  var def = ruleset.perps[gestalt];
  if (!def) return Promise.resolve({ result: { error: 0 } });

  var provided = (def.type_data && def.type_data.provided_perps) || [];
  var level = (state.game_values && state.game_values.xp_level) || 1;
  var owned = maps.gestalts;

  var buyable = provided.filter(function (g) {
    return _isProvidable(g, ruleset, level, owned);
  });

  return Promise.resolve({ result: { buyable: buyable } });
}

interface PowerupListEntry {
  game_gestalt: string;
  game_type: string | undefined;
  type_data: Record<string, unknown>;
}

export function getPowerups(
  projectGestalt: string /*, version */
): Promise<{ result: PowerupListEntry[] }> {
  var ruleset = _getRuleset();
  var def = ruleset.perps[projectGestalt];
  if (!def) return Promise.resolve({ result: [] });

  var td: PerpTypeData = def.type_data || {};
  var entries: PowerupDef[] = (td.provided_ads || []).concat(
    td.provided_upgrades || [],
    td.provided_teammembers || []
  );

  var result: PowerupListEntry[] = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (!entry || typeof entry.gestalt !== 'string') continue;
    var puDef = ruleset.powerups[entry.gestalt];
    if (!puDef) continue;
    result.push({
      game_gestalt: entry.gestalt,
      game_type: puDef.game_type,
      type_data: Object.assign({ gestalt: entry.gestalt }, puDef.type_data || {}, entry),
    });
  }

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// getRanking
// ---------------------------------------------------------------------------

// Supported sort fields and their key in state.peers[addr].
// Matches val_type strings from docs/handler-map.md §getRanking and the call
// site at Game.js:3352 (Topscore.fetchScore). Includes `spent` (cash_spent)
// for the Investor tab registered in type_settings.js, and `level` as a
// forward-facing field. Unknown types fall back to 'xp' with a console.warn.
type RankingField = 'cash' | 'profiles' | 'xp' | 'level' | 'spent';
const _RANKING_FIELDS: Record<RankingField, true> = {
  cash: true,
  profiles: true,
  xp: true,
  level: true,
  spent: true,
};

function _isRankingField(s: string): s is RankingField {
  return Object.prototype.hasOwnProperty.call(_RANKING_FIELDS, s);
}

interface RankingRow {
  addr: string;
  display_name: string;
  value: number;
  self: boolean;
  /** Speculative webxdc avatar URL; the row template always emits the
   *  <img> and the .TopscoreList container only reserves slot space
   *  after at least one image has fired onload. */
  avatar?: string;
}

export function getRanking(
  type: string
): Promise<{ result: { top: RankingRow[]; user_rank: number } }> {
  var state = getState();
  var selfAddr = (state && state.addr) || '';
  var peers = (state && state.peers) || {};

  if (!_isRankingField(type)) {
    console.warn('[getRanking] unknown type "' + type + '", falling back to xp');
  }
  var field: RankingField = _isRankingField(type) ? type : 'xp';

  var rows: RankingRow[] = Object.keys(peers).map(function (addr) {
    var p = peers[addr] || {};
    var v = p[field];
    var row: RankingRow = {
      addr: addr,
      display_name: p.display_name || addr,
      value: typeof v === 'number' ? v : 0,
      self: addr === selfAddr,
    };
    var url = getAvatarUrl(addr);
    if (url) row.avatar = url;
    return row;
  });

  rows.sort(function (a, b) {
    return b.value - a.value;
  });

  var selfIdx = -1;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row && row.self) {
      selfIdx = i;
      break;
    }
  }

  var n = rows.length;
  var userRank = n === 0 ? 0 : selfIdx < 0 ? 0 : n === 1 ? 1 : 1 - selfIdx / (n - 1);

  return Promise.resolve({ result: { top: rows, user_rank: userRank } });
}

// ---------------------------------------------------------------------------
// Delta helpers
// ---------------------------------------------------------------------------

// Build a canonical delta envelope.  Always paired with _persistDelta — never
// pass the result anywhere else.  Kept as a tiny helper so handler call sites
// don't repeat the kind/ts boilerplate.
/**
 * Build a persisted delta object.
 *
 * TODO #147 follow-up: tighten Delta.args / Delta.result in state.ts so this
 * function can construct the Delta directly without the type-erasure cast.
 * The current shape `args?: any[] / result?: any` plus exactOptionalPropertyTypes
 * means an `unknown[]` argument can't be assigned to `args` without the seam.
 * Narrowing the Delta envelope is gated on typing the reducer family in
 * state.ts, which the per-handler PRs (4-N) finish off.
 */
function _mkDelta(addr: string, op: string, args: unknown[], result: unknown): Delta {
  return {
    kind: 'delta',
    addr: addr,
    op: op,
    args: args as unknown[] as never[],
    result: result as unknown,
    ts: clockNow(),
  } as Delta;
}

// ---------------------------------------------------------------------------
// Validation helpers (mirrors dd_app helpers.validateDisplayName)
// ---------------------------------------------------------------------------

// Printable Unicode, 1–30 chars; no ASCII control chars (< 0x20) or DEL (0x7f).
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional char-class exclusion for control chars
var DISPLAY_NAME_RE = /^[^\x00-\x1f\x7f]{1,30}$/;

function validateDisplayName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  return name.trim().length > 0 && DISPLAY_NAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// setDisplayName / setPerpCoordinates (#13)
// ---------------------------------------------------------------------------

/**
 * setDisplayName(dname) → Promise<{result: {}|{error:0|1}}>
 *
 * Validates dname (length cap, charset), writes state.user.display_name, and
 * emits a delta so the change survives a reload.
 * Returns {} on success or {error: 0} on bad input / {error: 1} on internal fault.
 */
export function setDisplayName(
  dname: unknown
): Promise<{ result: Record<string, never> | { error: 0 | 1 } }> {
  if (!validateDisplayName(dname)) {
    return Promise.resolve({ result: { error: 0 } });
  }

  var state = getState();
  if (!state) {
    return Promise.resolve({ result: { error: 1 } });
  }

  _persistDelta(_mkDelta(state.addr, 'setDisplayName', [dname], {}));

  return Promise.resolve({ result: {} });
}

/**
 * setPerpCoordinates(updates) → Promise<{result: 1}>
 *
 * updates = [[full_path, {x, y}], ...]
 * Matches nodes by full_path and $sets instance_data.x / instance_data.y.
 * Emits one delta covering all entries.  Always returns {result: 1} even when
 * some paths are not found (matches original server behaviour: Game.js:981).
 */
export function setPerpCoordinates(updates: unknown): Promise<{ result: 1 }> {
  if (!Array.isArray(updates) || updates.length === 0) {
    return Promise.resolve({ result: 1 });
  }

  var state = getState();
  if (!state || !Array.isArray(state.nodes)) {
    return Promise.resolve({ result: 1 });
  }

  // Build a lookup map: full_path → {x, y}.  Result is unused (the reducer
  // walks `updates` itself) — we just validate each entry's shape here so
  // malformed inputs are dropped before persistence.
  var coordMap: Record<string, unknown> = {};
  for (var i = 0; i < updates.length; i++) {
    var entry = updates[i];
    if (!Array.isArray(entry) || entry.length < 2) continue;
    var path = entry[0];
    var pos = entry[1];
    if (typeof path !== 'string' || !pos || typeof pos !== 'object') continue;
    coordMap[path] = pos;
  }

  _persistDelta(_mkDelta(state.addr, 'setPerpCoordinates', [updates], {}));

  return Promise.resolve({ result: 1 });
}

// ---------------------------------------------------------------------------
// buyKarma handler
// ---------------------------------------------------------------------------

// Returns the matching level entry (or the last level for XP beyond the cap).
function _findLevelByXP(levels: LevelEntry[], xp: number): LevelEntry {
  for (var i = 0; i < levels.length; i++) {
    var lvl = levels[i];
    if (lvl && xp >= lvl.xp_min && xp <= lvl.xp_max) return lvl;
  }
  var last = levels[levels.length - 1];
  if (!last) throw new Error('_findLevelByXP: empty levels');
  return last;
}

/**
 * buyKarma(karmalauterGestalt) → Promise<{result}>
 *
 * Looks up the karmalauter in the ruleset, validates cash, applies increments,
 * and returns {game_values, [levelup]}.  No missions payload (handler-map.md).
 */
export function buyKarma(
  karmalauterGestalt: string
): Promise<{ result: { error: number } | { game_values: GameValues; levelup?: boolean } }> {
  var state = getState();
  var ruleset = _getRuleset();

  var karmalauter: Karmalauter | null = null;
  for (var i = 0; i < ruleset.karmalauters.length; i++) {
    var k = ruleset.karmalauters[i];
    if (k && k.type_data.gestalt === karmalauterGestalt) {
      karmalauter = k;
      break;
    }
  }
  if (!karmalauter) {
    return Promise.resolve({ result: { error: 1 } });
  }

  var td = karmalauter.type_data;
  var gv = state.game_values;
  var cashValue = gv.cash_value || 0;

  if (cashValue < td.price) {
    return Promise.resolve({ result: { error: 2 } });
  }

  var newXp = (gv.xp_value || 0) + td.karma_points;
  var newKarma = Math.min(100, Math.max(-100, (gv.karma_value || 0) + td.karma_points));
  var newCash = cashValue - td.price;
  var newCashSpent = (gv.cash_spent || 0) + td.price;

  var oldLevelNum = gv.xp_level || 1;
  var newLevel = _findLevelByXP(ruleset.levels, newXp);
  var levelup = newLevel.number > oldLevelNum;

  var newGv: GameValues = Object.assign({}, gv, {
    xp_value: newXp,
    karma_value: newKarma,
    cash_value: newCash,
    cash_spent: newCashSpent,
    xp_level: newLevel.number,
  });

  if (levelup) newGv = _applyLevelUp(newGv, newLevel.number);

  _persistDelta(_mkDelta(state.addr, 'buyKarma', [karmalauterGestalt], { game_values: newGv }));

  // Achievements
  var _bkDisplayName = state.display_name || state.addr;
  if (levelup) {
    triggerAchievement(
      'levelup',
      _t('achievement_levelup', _bkDisplayName, String(newLevel.number))
    );
  }
  var _bkOldKarma = gv.karma_value || 0;
  if (_bkOldKarma !== 100 && newKarma === 100) {
    triggerAchievement('karma_saint', _t('achievement_karma_saint', _bkDisplayName));
  }
  if (_bkOldKarma !== -100 && newKarma === -100) {
    triggerAchievement('karma_devil', _t('achievement_karma_devil', _bkDisplayName));
  }

  var response: { game_values: GameValues; levelup?: boolean } = { game_values: newGv };
  if (levelup) response.levelup = true;
  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// Purchase helpers — shared by buyPowerup / sellPowerup / buySlots
// ---------------------------------------------------------------------------

// Looks up a node by full_path and its ruleset type_data.  Returns
// { state, nodeIdx, node, perpTypeData } or null when either is missing.
interface ResolvedNode {
  state: LocalState;
  nodeIdx: number;
  node: GameNode;
  perpTypeData: PerpTypeData;
}

function _resolveNode(perpPath: string): ResolvedNode | null {
  var state = getState();
  var nodeIdx = -1;
  for (var i = 0; i < state.nodes.length; i++) {
    var n0 = state.nodes[i];
    if (n0 && n0.full_path === perpPath) {
      nodeIdx = i;
      break;
    }
  }
  if (nodeIdx === -1) return null;
  var node = state.nodes[nodeIdx];
  if (!node) return null;
  var ft = node.full_type || '';
  var colon = ft.indexOf(':');
  var perpGestalt = colon >= 0 ? ft.slice(colon + 1) : node.gestalt || '';
  var perpTypeDef = _getRuleset().perps[perpGestalt];
  if (!perpTypeDef || !perpTypeDef.type_data) return null;
  return { state: state, nodeIdx: nodeIdx, node: node, perpTypeData: perpTypeDef.type_data };
}

// Searches provided_ads / provided_upgrades / provided_teammembers for a
// powerup entry by gestalt.  O(P) where P = total provided entries.
function _findPowerupDef(perpTypeData: PerpTypeData, powerupGestalt: string): PowerupDef | null {
  var lists: Array<PowerupDef[] | undefined> = [
    perpTypeData.provided_ads,
    perpTypeData.provided_upgrades,
    perpTypeData.provided_teammembers,
  ];
  for (var i = 0; i < lists.length; i++) {
    var list = lists[i] || [];
    for (var j = 0; j < list.length; j++) {
      var entry = list[j];
      if (entry && entry.gestalt === powerupGestalt) return entry;
    }
  }
  return null;
}

// Recomputes charge_cost / collect_amount / collect_risk from the perp's
// base type_data values plus the cumulative modifiers of all active powerups.
// Pre-indexes provided_* lists into a map so the powerup loop is O(N) not O(N×P).
interface ModifierResult {
  charge_cost: number;
  collect_amount: number;
  collect_risk: number;
}

function _computeModifiers(perpTypeData: PerpTypeData, powerups: PowerupDef[]): ModifierResult {
  var defByGestalt: Record<string, PowerupDef> = {};
  var provided: Array<PowerupDef[] | undefined> = [
    perpTypeData.provided_ads,
    perpTypeData.provided_upgrades,
    perpTypeData.provided_teammembers,
  ];
  for (var k = 0; k < provided.length; k++) {
    var list = provided[k] || [];
    for (var j = 0; j < list.length; j++) {
      var entry = list[j];
      if (entry && entry.gestalt) defByGestalt[entry.gestalt] = entry;
    }
  }
  var chargeCost = perpTypeData.charge_cost || 0;
  var collectAmount = perpTypeData.collect_amount || 0;
  var collectRisk = perpTypeData.collect_risk || 0;
  for (var i = 0; i < powerups.length; i++) {
    var pu = powerups[i];
    if (!pu || !pu.gestalt) continue;
    var puDef = defByGestalt[pu.gestalt];
    if (puDef) {
      chargeCost += puDef.charge_cost_modifier || 0;
      collectAmount += puDef.collect_amount_modifier || 0;
      collectRisk += puDef.collect_risk_modifier || 0;
    }
  }
  return { charge_cost: chargeCost, collect_amount: collectAmount, collect_risk: collectRisk };
}

// Venture base tokens carry amount=0 for upgrade-gated data points; the
// ProfileSet popup renders them greyed via lockAmountZero. Each active
// upgrade lifts per-gestalt amounts to the upgrade's value; overlapping
// upgrades take the max so removing one upgrade doesn't un-unlock a token
// still provided by another.
function _computeUpgradeTokens(perpTypeData: PerpTypeData, powerups: PowerupDef[]): TokenSpec[] {
  var merged: TokenSpec[] = (perpTypeData.tokens || []).map((t) => Object.assign({}, t));
  var byGestalt: Record<string, TokenSpec> = {};
  for (var i = 0; i < merged.length; i++) {
    var bt = merged[i];
    if (bt && bt.gestalt) byGestalt[bt.gestalt] = bt;
  }
  var ruleset = _getRuleset();
  for (var p = 0; p < powerups.length; p++) {
    var pu = powerups[p];
    if (!pu || !pu.gestalt) continue;
    var puDef = ruleset.powerups[pu.gestalt];
    var puTokens: TokenSpec[] =
      (puDef && puDef.type_data && (puDef.type_data as { tokens?: TokenSpec[] }).tokens) || [];
    for (var t = 0; t < puTokens.length; t++) {
      var ut = puTokens[t];
      if (!ut || !ut.gestalt) continue;
      var added = ut.amount || 0;
      var slot = byGestalt[ut.gestalt];
      if (slot) {
        var existing = slot.amount || 0;
        if (added > existing) slot.amount = added;
      } else {
        var clone: TokenSpec = Object.assign({}, ut);
        merged.push(clone);
        byGestalt[ut.gestalt] = clone;
      }
    }
  }
  return merged;
}

// Cold-start fixup for state where instance_data.tokens was persisted
// without the upgrade merge (legacy saves, replayed historical deltas).
// Reference identity is preserved for nodes whose tokens already match.
function _repairUpgradeTokens(state: LocalState): LocalState {
  var nodes = state.nodes || [];
  var changed = false;
  var newNodes = nodes.map(function (n) {
    var idata = (n.instance_data || {}) as NodeInstanceData;
    var powerups = idata.powerups;
    if (!powerups || !powerups.length) return n;
    var perpGestalt = _gestaltFrom(n.full_type) || n.gestalt || '';
    var perpTypeDef = _getRuleset().perps[perpGestalt];
    var perpTypeData = perpTypeDef && perpTypeDef.type_data;
    if (!perpTypeData || !perpTypeData.tokens || !perpTypeData.tokens.length) return n;
    var merged = _computeUpgradeTokens(perpTypeData, powerups);
    var existing = idata.tokens || [];
    if (_tokensEqual(existing, merged)) return n;
    changed = true;
    return Object.assign({}, n, {
      instance_data: Object.assign({}, idata, { tokens: merged }),
    });
  });
  if (!changed) return state;
  return Object.assign({}, state, { nodes: newNodes });
}

function _tokensEqual(a: TokenSpec[], b: TokenSpec[]): boolean {
  if (a.length !== b.length) return false;
  var aByGestalt: Record<string, number> = {};
  for (var i = 0; i < a.length; i++) {
    var ta = a[i];
    if (ta && ta.gestalt) aByGestalt[ta.gestalt] = ta.amount || 0;
  }
  for (var j = 0; j < b.length; j++) {
    var tb = b[j];
    if (!tb || !tb.gestalt) continue;
    if (!Object.prototype.hasOwnProperty.call(aByGestalt, tb.gestalt)) return false;
    if (aByGestalt[tb.gestalt] !== (tb.amount || 0)) return false;
  }
  return true;
}

function _getLevelByXP(xp: number): number {
  // Ruleset levels are defined with a gap between consecutive ranges
  // (L1: 0–10, L2: 11–30, …). A player whose xp lands exactly on a
  // level's `xp_max` would otherwise stay on the lower level until the
  // next +1 XP pushed them past the gap into the next `xp_min`. That's
  // visible as "10/10" sitting at level 1 with no levelup notification.
  //
  // Treat `xp_max` as the promotion threshold: walk high-to-low and
  // return the first level whose `xp_min` is reached, but if xp has
  // already met or passed that level's `xp_max` AND a higher level
  // exists, return the higher level instead.
  var levels = _getRuleset().levels;
  for (var i = levels.length - 1; i >= 0; i--) {
    var lvl = levels[i];
    if (lvl && xp >= lvl.xp_min) {
      var next = levels[i + 1];
      if (next && xp >= lvl.xp_max) return next.number;
      return lvl.number;
    }
  }
  var first = levels[0];
  return first ? first.number : 1;
}

function _checkLevelup(currentLevel: number, newXp: number): boolean {
  return _getLevelByXP(newXp) > currentLevel;
}

// Refill AP and raise ap_max/regen rates to the new level's values.
// Centralised because previously every level-up site (chargePerp,
// collectPerp, integrateCollected, buyKarma) open-coded a partial copy
// that forgot to advance ap_max — so the very next materialize() pass
// clamped ap_snapshot back to the old ceiling and the player visibly
// lost the energy refill they just earned.
function _applyLevelUp(gv: GameValues, newLevelNum: number): GameValues {
  var levels = _getRuleset().levels;
  var info = levels[newLevelNum - 1] || levels[levels.length - 1];
  if (!info) return Object.assign({}, gv, { xp_level: newLevelNum });
  var iv = info as LevelEntry & { ap_inc_value?: number; ap_inc_interval?: number };
  return Object.assign({}, gv, {
    xp_level: newLevelNum,
    ap_inc_value: iv.ap_inc_value !== undefined ? iv.ap_inc_value : gv.ap_inc_value,
    ap_inc_interval: iv.ap_inc_interval !== undefined ? iv.ap_inc_interval : gv.ap_inc_interval,
    ap_max: info.ap_max,
    ap_snapshot: info.ap_max,
  });
}

// All delta-emitting handlers funnel through _persistDelta (above). The legacy
// _commitDelta(computedNewState, addr, op, args, result) entry point that
// did setState(computedNewState) on the no-webxdc branch is gone — the
// reducer in scripts/state.js is now the sole transformation, applied via
// applyDelta in the listener (production) or in _persistDelta's fallback.

// ---------------------------------------------------------------------------
// buyPowerup(perpPath, slot, gestalt)
// ---------------------------------------------------------------------------

/**
 * buyPowerup — push a powerup into a slot on a project node.
 *
 * Validates: cash >= powerup price AND slot is empty.
 * Errors: 0 = node/type not found, 1 = slot occupied, 3 = insufficient cash.
 * Returns: { node, game_values, levelup }
 */
export function buyPowerup(
  perpPath: string,
  slot: number,
  gestalt: string
): Promise<{ result: { error: number } | Record<string, unknown> }> {
  var r = _resolveNode(perpPath);
  if (!r) return Promise.resolve({ result: { error: 0 } });
  var state = r.state,
    nodeIdx = r.nodeIdx,
    node = r.node,
    perpTypeData = r.perpTypeData;

  var puDef = _findPowerupDef(perpTypeData, gestalt);
  if (!puDef) return Promise.resolve({ result: { error: 0 } });

  var idata: NodeInstanceData = node.instance_data || {};
  var powerups: PowerupDef[] = idata.powerups || [];
  var puGameType = _gameTypeFrom(puDef.full_type);
  for (var i = 0; i < powerups.length; i++) {
    var pi = powerups[i];
    if (pi && pi.slot === slot && _gameTypeFrom(pi.full_type) === puGameType) {
      return Promise.resolve({ result: { error: 1 } });
    }
  }

  var price = puDef.price || 0;
  var cashValue = state.game_values.cash_value || 0;
  if (cashValue < price) return Promise.resolve({ result: { error: 3 } });

  var addedPu: PowerupDef = { slot: slot, gestalt: gestalt };
  if (puDef.full_type !== undefined) addedPu.full_type = puDef.full_type;
  var newPowerups: PowerupDef[] = powerups.concat([addedPu]);
  var mods = _computeModifiers(perpTypeData, newPowerups);

  var newInstanceData = Object.assign({}, node.instance_data, {
    powerups: newPowerups,
    charge_cost: mods.charge_cost,
    collect_amount: mods.collect_amount,
    collect_risk: mods.collect_risk,
    tokens: _computeUpgradeTokens(perpTypeData, newPowerups),
  });

  var newXp = (state.game_values.xp_value || 0) + (perpTypeData.xp_inc || 1);
  var levelup = _checkLevelup(state.game_values.xp_level || 1, newXp);

  var newGameValues: GameValues = Object.assign({}, state.game_values, {
    cash_value: cashValue - price,
    cash_spent: (state.game_values.cash_spent || 0) + price,
    xp_value: newXp,
    karma_value: (state.game_values.karma_value || 0) + 1,
  });
  if (levelup) newGameValues = _applyLevelUp(newGameValues, _getLevelByXP(newXp));

  var newNodes = state.nodes.slice();
  newNodes[nodeIdx] = Object.assign({}, node, { instance_data: newInstanceData });

  var preMissionStatePu = Object.assign({}, state, { nodes: newNodes, game_values: newGameValues });
  var puMissionResult = _advanceBuyPowerupMissions(preMissionStatePu, gestalt);
  newGameValues = _applyRewardsToGv(newGameValues, puMissionResult.rewards);
  // Mission rewards may add XP that crosses another level threshold — check again.
  if (_checkLevelup(newGameValues.xp_level || 1, newGameValues.xp_value || 0)) {
    levelup = true;
    newGameValues = _applyLevelUp(newGameValues, _getLevelByXP(newGameValues.xp_value || 0));
  }

  var responseNode = {
    game_id: node.game_id,
    game_type: node.game_type,
    full_path: node.full_path,
    instance_data: newInstanceData,
  };
  var result = {
    node: responseNode,
    game_values: newGameValues,
    levelup: levelup,
    missions: puMissionResult.missions || null,
  };

  _persistDelta(_mkDelta(state.addr, 'buyPowerup', [perpPath, slot, gestalt], result));

  // Achievements
  var _bpuDisplayName = state.display_name || state.addr;
  if (levelup) {
    triggerAchievement(
      'levelup',
      _t('achievement_levelup', _bpuDisplayName, String(newGameValues.xp_level))
    );
  }
  var _bpuCompletedMissions =
    (puMissionResult.missions && puMissionResult.missions.complete_missions) || [];
  for (var _bpuMi = 0; _bpuMi < _bpuCompletedMissions.length; _bpuMi++) {
    var mGestalt = _bpuCompletedMissions[_bpuMi];
    if (typeof mGestalt !== 'string') continue;
    var _bpuMDef = _findMissionDef(_getRuleset(), mGestalt);
    var _bpuMTitle = (_bpuMDef && _bpuMDef.type_data && _bpuMDef.type_data.title) || mGestalt;
    triggerAchievement(
      'mission_done',
      _t('achievement_mission_done', _bpuDisplayName, _bpuMTitle),
      { mission: mGestalt }
    );
  }
  var _bpuOldKarma = state.game_values.karma_value || 0;
  var _bpuNewKarma = newGameValues.karma_value || 0;
  if (_bpuOldKarma !== 100 && _bpuNewKarma === 100) {
    triggerAchievement('karma_saint', _t('achievement_karma_saint', _bpuDisplayName));
  }

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// sellPowerup(perpPath, slot, gestalt)
// ---------------------------------------------------------------------------

/**
 * sellPowerup — remove a powerup from a slot, refunding 0.75× the price.
 *
 * Validates: slot is occupied.
 * Errors: 0 = node/type not found, 1 = slot not occupied.
 * Returns: { node, game_values, levelup }
 */
export function sellPowerup(
  perpPath: string,
  slot: number,
  gestalt: string
): Promise<{ result: { error: number } | Record<string, unknown> }> {
  var r = _resolveNode(perpPath);
  if (!r) return Promise.resolve({ result: { error: 0 } });
  var state = r.state,
    nodeIdx = r.nodeIdx,
    node = r.node,
    perpTypeData = r.perpTypeData;

  var idata: NodeInstanceData = node.instance_data || {};
  var powerups: PowerupDef[] = idata.powerups || [];

  // Slot indices are per-category (Upgrade / Ad / TeamMember each keep
  // their own 0-based slot grid) but `powerups` is one flat array, so a
  // bare `p.slot === slot` match resolves the wrong category's entry and
  // the removal filter drops every entry sharing that slot index.  Scope
  // the match to the sold powerup's game type — same `full_type`-derived
  // guard buyPowerup uses for its slot-occupied check above.
  var soldDef = _findPowerupDef(perpTypeData, gestalt);
  var soldGameType = soldDef ? _gameTypeFrom(soldDef.full_type) : '';
  var isSold = function (p: PowerupDef | null | undefined): boolean {
    return !!p && p.slot === slot && _gameTypeFrom(p.full_type) === soldGameType;
  };

  var puEntry: PowerupDef | null = null;
  for (var i = 0; i < powerups.length; i++) {
    var p0 = powerups[i];
    if (p0 && isSold(p0)) {
      puEntry = p0;
      break;
    }
  }
  if (!puEntry) return Promise.resolve({ result: { error: 1 } });

  var puDef = puEntry.gestalt ? _findPowerupDef(perpTypeData, puEntry.gestalt) : null;
  var price = puDef ? puDef.price || 0 : 0;
  var refund = Math.floor(price * 0.75);

  var newPowerups: PowerupDef[] = powerups.filter(function (p) {
    return p && !isSold(p);
  });
  var mods = _computeModifiers(perpTypeData, newPowerups);

  var newInstanceData = Object.assign({}, node.instance_data, {
    powerups: newPowerups,
    charge_cost: mods.charge_cost,
    collect_amount: mods.collect_amount,
    collect_risk: mods.collect_risk,
    tokens: _computeUpgradeTokens(perpTypeData, newPowerups),
  });

  var newXp = (state.game_values.xp_value || 0) + 1;
  var levelup = _checkLevelup(state.game_values.xp_level || 1, newXp);

  var newGameValues: GameValues = Object.assign({}, state.game_values, {
    cash_value: (state.game_values.cash_value || 0) + refund,
    xp_value: newXp,
  });
  if (levelup) newGameValues = _applyLevelUp(newGameValues, _getLevelByXP(newXp));

  var newNodes = state.nodes.slice();
  newNodes[nodeIdx] = Object.assign({}, node, { instance_data: newInstanceData });

  var responseNode = {
    game_id: node.game_id,
    game_type: node.game_type,
    full_path: node.full_path,
    instance_data: newInstanceData,
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(_mkDelta(state.addr, 'sellPowerup', [perpPath, slot, gestalt], result));

  if (levelup) {
    var _spDisplayName = state.display_name || state.addr;
    triggerAchievement(
      'levelup',
      _t('achievement_levelup', _spDisplayName, String(newGameValues.xp_level))
    );
  }

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// buySlots(perpPath, slot_type, num)
// ---------------------------------------------------------------------------

/**
 * buySlots — purchase additional powerup/ad/upgrade/teammember slots.
 *
 * Validates: cash >= total slot cost.
 * Cost per slot: slot_cost + slot_cost_modifier * (current_slots + i).
 * Errors: 0 = node/type not found, 2 = would exceed max slots, 3 = no cash.
 * Returns: { node, game_values, levelup }
 */
export function buySlots(
  perpPath: string,
  slotType: string,
  num: number | string
): Promise<{ result: { error: number } | Record<string, unknown> }> {
  var nNum = Number.parseInt(String(num), 10) || 1;
  var r = _resolveNode(perpPath);
  if (!r) return Promise.resolve({ result: { error: 0 } });
  var state = r.state,
    nodeIdx = r.nodeIdx,
    node = r.node,
    perpTypeData = r.perpTypeData;
  var slotKey = slotType + '_slots';
  var maxKey = 'max_' + slotType + '_slots';

  // PerpTypeData / NodeInstanceData both whitelist their typed fields and
  // fall through to `[key: string]: unknown` for the long tail. The slot
  // counters are constructed from `slotType` at runtime so they live on the
  // open-ended portion — read once via _readNumber and the rest of the
  // function works on plain `number` values.
  var currentSlots: number =
    _readNumber(node.instance_data, slotKey) ?? _readNumber(perpTypeData, slotKey) ?? 0;
  var maxSlots: number = _readNumber(perpTypeData, maxKey) ?? Number.POSITIVE_INFINITY;

  if (currentSlots + nNum > maxSlots) return Promise.resolve({ result: { error: 2 } });

  var slotCost = perpTypeData.slot_cost || 0;
  var slotCostModifier = perpTypeData.slot_cost_modifier || 0;
  var totalCost = 0;
  for (var i = 0; i < nNum; i++) {
    totalCost += slotCost + slotCostModifier * (currentSlots + i);
  }

  var cashValue = state.game_values.cash_value || 0;
  if (cashValue < totalCost) return Promise.resolve({ result: { error: 3 } });

  var newInstanceData: NodeInstanceData = Object.assign({}, node.instance_data);
  newInstanceData[slotKey] = currentSlots + nNum;

  var newXp = (state.game_values.xp_value || 0) + 1;
  var levelup = _checkLevelup(state.game_values.xp_level || 1, newXp);

  var newGameValues: GameValues = Object.assign({}, state.game_values, {
    cash_value: cashValue - totalCost,
    cash_spent: (state.game_values.cash_spent || 0) + totalCost,
    xp_value: newXp,
  });
  if (levelup) newGameValues = _applyLevelUp(newGameValues, _getLevelByXP(newXp));

  var newNodes = state.nodes.slice();
  newNodes[nodeIdx] = Object.assign({}, node, { instance_data: newInstanceData });

  var responseNode = {
    game_id: node.game_id,
    game_type: node.game_type,
    full_path: node.full_path,
    instance_data: newInstanceData,
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(_mkDelta(state.addr, 'buySlots', [perpPath, slotType, nNum], result));

  if (levelup) {
    var _bsDisplayName = state.display_name || state.addr;
    triggerAchievement(
      'levelup',
      _t('achievement_levelup', _bsDisplayName, String(newGameValues.xp_level))
    );
  }

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// buyPerp — first non-trivial purchase handler (#15)
// ---------------------------------------------------------------------------

/**
 * buyPerp(parentPath, gestalt) → Promise<{result: BuyPerpResult}>
 *
 * Port of dd_app views.py:1001.  Single-tenant — no concurrent-writer guards.
 *
 * Error codes (mirrors original):
 *   1 — gestalt unknown / level too low / parent slot list excludes gestalt / dup
 *   2 — insufficient cash
 *   3 — ProxyPerp slot limit reached
 *   4 — already purchased under this parent
 */
interface BuyPerpProfileSetPayload {
  profile_set: { profiles_value: number; tokens_map: Record<string, { amount: number }> };
  origin: string;
  collect_id: string;
}

interface BuyPerpPayload {
  node: GameNode;
  game_values: GameValues;
  levelup: boolean;
  node_counter: number;
  missions: MissionUpdate | null;
  profile_set?: BuyPerpProfileSetPayload;
}

export function buyPerp(
  parentPath: string,
  gestalt: string
): Promise<{ result: { error: number } | BuyPerpPayload }> {
  var state = getState();
  var ruleset = _getRuleset();
  var allTypes: Record<string, PerpDef> = Object.assign({}, ruleset.perps, ruleset.tokens);

  var perpDef = allTypes[gestalt];
  if (!perpDef) {
    return Promise.resolve({ result: { error: 1 } });
  }
  var typeData: PerpTypeData = perpDef.type_data || {};
  var gameType = perpDef.game_type || '';

  var gv = state.game_values || {};
  var currentLevel = gv.xp_level || 1;
  var requiredLevel = typeData.required_level != null ? typeData.required_level : 1;
  if (currentLevel < requiredLevel) {
    return Promise.resolve({ result: { error: 1 } });
  }

  // Roots ("Imperium", "Database") are always valid.  Other paths are checked
  // against state.nodes; if not found we still allow the call (single-tenant,
  // client already guards this) so that pre-loaded seed nodes don't block buys.
  var parentNode: GameNode | null = null;
  if (parentPath !== 'Imperium' && parentPath !== 'Database') {
    var nodes = state.nodes || [];
    for (var ni = 0; ni < nodes.length; ni++) {
      var pn = nodes[ni];
      if (pn && pn.full_path === parentPath) {
        parentNode = pn;
        break;
      }
    }
  }

  // Only validate provided_perps when we can resolve the parent's type definition.
  var parentGestalt = parentNode ? parentNode.gestalt || '' : '';
  var parentTypeDef = parentGestalt ? allTypes[parentGestalt] : null;
  var parentTypeData: PerpTypeData | null = parentTypeDef ? parentTypeDef.type_data || {} : null;

  if (parentTypeData && Array.isArray(parentTypeData.provided_perps)) {
    if (parentTypeData.provided_perps.indexOf(gestalt) === -1) {
      return Promise.resolve({ result: { error: 1 } });
    }
  }

  if (parentNode && parentNode.game_type === 'ProxyPerp') {
    var maxSlots: number = (parentTypeData && parentTypeData.max_slots) || 0;
    var childPrefix = parentPath + '.';
    var childCount = 0;
    var allNodes = state.nodes || [];
    for (var ci = 0; ci < allNodes.length; ci++) {
      var an = allNodes[ci];
      if (an && an.full_path.indexOf(childPrefix) === 0) {
        childCount++;
      }
    }
    if (childCount >= maxSlots) {
      return Promise.resolve({ result: { error: 3 } });
    }
  }

  var price = typeof typeData.price === 'number' ? typeData.price : 0;
  var cashValue = gv.cash_value || 0;
  if (cashValue < price) {
    return Promise.resolve({ result: { error: 2 } });
  }

  var newFullPath = parentPath + '.' + gestalt;
  var stateNodes = state.nodes || [];
  for (var di = 0; di < stateNodes.length; di++) {
    var sn = stateNodes[di];
    if (sn && sn.full_path === newFullPath) {
      return Promise.resolve({ result: { error: 4 } });
    }
  }

  var nodeCounter = (state.node_counter || 0) + 1;
  var newNode: GameNode = {
    // game_id == gestalt (last path segment); see _seedNodesFromTree for invariant.
    game_id: gestalt,
    game_type: gameType,
    full_type: gameType + ':' + gestalt,
    gestalt: gestalt,
    full_path: newFullPath,
    instance_data: {},
  };

  var xpInc = typeof typeData.xp_inc === 'number' ? typeData.xp_inc : 0;
  var profilesMaxInc = typeof typeData.profiles_max === 'number' ? typeData.profiles_max : 0;
  var newGv: GameValues = Object.assign({}, gv, {
    cash_value: cashValue - price,
    cash_spent: (gv.cash_spent || 0) + price,
    xp_value: (gv.xp_value || 0) + xpInc,
    profiles_max: (gv.profiles_max || 0) + profilesMaxInc,
  });

  var oldLevel = gv.xp_level || 1;
  var newLevel = _getLevelByXP(newGv.xp_value || 0);
  var levelup = newLevel > oldLevel;
  if (levelup) newGv = _applyLevelUp(newGv, newLevel);

  // Project the just-bought node in before the mission cascade so a
  // cascade-unlocked buy_perp goal targeting this perp auto-completes now
  // instead of staying stuck until a reload replays the buy delta.
  var preMissionStateBuy = Object.assign({}, state, {
    nodes: state.nodes.concat([newNode]),
  });
  var missionResult = _advanceBuyPerpMissions(preMissionStateBuy, gestalt);
  newGv = _applyRewardsToGv(newGv, missionResult.rewards);

  // profile_set for project*/contact*/city* gestalts:
  // initial data batch pushed to db_queue; city-buy path also read by Game.js:3816.
  var profileSetPayload: BuyPerpProfileSetPayload | null = null;
  var isProfileGestalt =
    gestalt.indexOf('project') === 0 ||
    gestalt.indexOf('contact') === 0 ||
    gestalt.indexOf('city') === 0;
  if (isProfileGestalt) {
    var collectId = 'cq_' + nodeCounter;
    var tokensMap: Record<string, { amount: number }> = {};
    var tokList = typeData.tokens || [];
    for (var ti = 0; ti < tokList.length; ti++) {
      var tk = tokList[ti];
      if (tk && typeof tk.gestalt === 'string') {
        tokensMap[tk.gestalt] = { amount: tk.amount || 0 };
      }
    }
    var profilesValue: number =
      typeof typeData.profileset_size === 'number'
        ? typeData.profileset_size
        : typeof typeData.collect_amount === 'number'
          ? typeData.collect_amount
          : 0;
    var generatedProfileSet = { profiles_value: profilesValue, tokens_map: tokensMap };
    profileSetPayload = {
      profile_set: generatedProfileSet,
      origin: newFullPath,
      collect_id: collectId,
    };
  }

  var payload: BuyPerpPayload = {
    node: newNode,
    game_values: newGv,
    levelup: levelup,
    node_counter: nodeCounter,
    missions: missionResult.missions || null,
  };
  if (profileSetPayload) {
    payload.profile_set = profileSetPayload;
  }

  _persistDelta(_mkDelta(state.addr, 'buyPerp', [parentPath, gestalt], payload));

  // Achievements
  var _bpDisplayName = state.display_name || state.addr;
  if (levelup) {
    triggerAchievement(
      'levelup',
      _t('achievement_levelup', _bpDisplayName, String(newGv.xp_level))
    );
  }
  var _bpCompletedMissions =
    (missionResult.missions && missionResult.missions.complete_missions) || [];
  for (var _bpMi = 0; _bpMi < _bpCompletedMissions.length; _bpMi++) {
    var mGestalt = _bpCompletedMissions[_bpMi];
    if (typeof mGestalt !== 'string') continue;
    var _bpMDef = _findMissionDef(_getRuleset(), mGestalt);
    var _bpMTitle = (_bpMDef && _bpMDef.type_data && _bpMDef.type_data.title) || mGestalt;
    triggerAchievement('mission_done', _t('achievement_mission_done', _bpDisplayName, _bpMTitle), {
      mission: mGestalt,
    });
  }

  return Promise.resolve({ result: payload });
}

function _findMissionDef(ruleset: Ruleset, gestalt: string): MissionDef | null {
  if (!ruleset || !ruleset.missions || !gestalt) return null;
  for (var i = 0; i < ruleset.missions.length; i++) {
    var def = ruleset.missions[i];
    if (def && def.type_data && def.type_data.gestalt === gestalt) return def;
  }
  return null;
}

// Canonical mission-goal row shape. One source so adding a field touches one place.
function _seedGoalRow(missionGestalt: string, g: GoalDef): MissionGoal {
  var row: MissionGoal = {
    mission: missionGestalt,
    workflow: g.workflow || '',
    target: g.target || '',
    amount: g.amount || 0,
    current_amount: 0,
    complete: false,
  };
  if (typeof g.position === 'number') row.position = g.position;
  return row;
}

function _completeGoal(goal: MissionGoal): MissionGoal {
  return Object.assign({}, goal, { complete: true, current_amount: goal.amount || 1 });
}

// Returns the same array reference when nothing changed so callers can use
// reference equality to detect whether any repairs were made.
function _autoCompleteBuyPerpGoals(
  goals: MissionGoal[],
  nodes: GameNode[] | undefined
): MissionGoal[] {
  var owned: Record<string, true> = {};
  (nodes || []).forEach(function (n) {
    if (n.gestalt) owned[n.gestalt] = true;
  });
  var changed = false;
  var result = goals.map(function (g) {
    if (g.workflow !== 'buy_perp' || g.complete || !owned[g.target]) return g;
    changed = true;
    return _completeGoal(g);
  });
  return changed ? result : goals;
}

// buy_powerup analogue of _autoCompleteBuyPerpGoals. Powerups live in each
// node's instance_data.powerups[] rather than as standalone nodes, so a
// mission that unlocks after the player already owns the powerup would stay
// stuck (the goal only advances on a fresh buyPowerup event — which is why
// re-buying after a sell was the only workaround). Same same-reference
// contract so callers can detect "nothing changed".
function _autoCompleteBuyPowerupGoals(
  goals: MissionGoal[],
  nodes: GameNode[] | undefined
): MissionGoal[] {
  var hasCandidate = goals.some(function (g) {
    return g.workflow === 'buy_powerup' && !g.complete;
  });
  if (!hasCandidate) return goals;
  var owned: Record<string, true> = {};
  (nodes || []).forEach(function (n) {
    var pus = ((n.instance_data as NodeInstanceData) || {}).powerups || [];
    pus.forEach(function (pu) {
      if (pu && pu.gestalt) owned[pu.gestalt] = true;
    });
  });
  var changed = false;
  var result = goals.map(function (g) {
    if (g.workflow !== 'buy_powerup' || g.complete || !owned[g.target]) return g;
    changed = true;
    return _completeGoal(g);
  });
  return changed ? result : goals;
}

function _eachMissionDef(ruleset: Ruleset, fn: (def: MissionDef) => void): void {
  if (!ruleset.missions) return;
  for (var i = 0; i < ruleset.missions.length; i++) {
    var d = ruleset.missions[i];
    if (d) fn(d);
  }
}

// Without this, fresh games (or saves activated by legacy code) have empty
// mission_goals and progression handlers find nothing to advance.
function _seedMissionGoals(state: LocalState): LocalState {
  var activeMissions = state.active_missions || [];
  if (!activeMissions.length) return state;
  var ruleset = _getRuleset();
  if (!ruleset || !ruleset.missions) return state;

  var existingGoals = state.mission_goals || [];
  var existingByMission: Record<string, true> = {};
  existingGoals.forEach(function (g) {
    existingByMission[g.mission] = true;
  });

  var newGoals: MissionGoal[] = existingGoals.slice();
  var added = false;
  activeMissions.forEach(function (mGestalt) {
    if (existingByMission[mGestalt]) return;
    var mDef = _findMissionDef(ruleset, mGestalt);
    if (!mDef || !mDef.type_data || !mDef.type_data.goals) return;
    mDef.type_data.goals.forEach(function (g: GoalDef) {
      newGoals.push(_seedGoalRow(mGestalt, g));
      added = true;
    });
  });

  // Repair stuck buy_perp / buy_powerup goals for items the player already
  // owns — covers both newly seeded goals and goals seeded before a prior
  // session ended.
  var repairedGoals = _autoCompleteBuyPerpGoals(newGoals, state.nodes);
  repairedGoals = _autoCompleteBuyPowerupGoals(repairedGoals, state.nodes);
  if (!added && repairedGoals === newGoals) return state;
  return Object.assign({}, state, { mission_goals: repairedGoals });
}

// gestalt → instance_data.amount for every TokenPerp node, mirroring
// the GameRoot.DBTokens map the UI keys upgrade math against.
function _buildTokenMap(nodes: GameNode[] | undefined): Record<string, number> {
  var out: Record<string, number> = {};
  (nodes || []).forEach(function (n) {
    if (n.game_type === 'TokenPerp' && n.gestalt && n.instance_data) {
      var amt = (n.instance_data as NodeInstanceData).amount;
      out[n.gestalt] = typeof amt === 'number' ? amt : 0;
    }
  });
  return out;
}

// current_amount math mirrors TokenPerp.setAmount → DBTokensAbsolute
// (Game.js:5439) so the LocalEngine and UI agree on completion.
function _advanceIntegrateProfilesMissions(
  state: LocalState,
  profilesValue: number,
  nodes: GameNode[] | undefined
): MissionAdvanceResult {
  var goals = state.mission_goals || [];
  var activeMissions = state.active_missions || [];
  if (!goals.length || !activeMissions.length) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  var amountByGestalt = _buildTokenMap(nodes);

  var changed = false;
  var updatedGoals = goals.map(function (goal) {
    if (goal.workflow !== 'integrate_profiles' || goal.complete) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    var pct = amountByGestalt[goal.target] || 0;
    var absoluteAmount = Math.floor((profilesValue * pct) / 100);
    // Monotonic — never let a later integrate roll back progress (e.g. if
    // profiles_value drops or coverage decays, mission progress sticks).
    var newAmount = Math.max(goal.current_amount || 0, Math.min(absoluteAmount, goal.amount));
    if (newAmount === goal.current_amount) return goal;
    changed = true;
    return Object.assign({}, goal, {
      current_amount: newAmount,
      complete: newAmount >= goal.amount,
    });
  });

  if (!changed) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

function _advanceCollectProfilesMissions(
  state: LocalState,
  contactGestalt: string,
  profilesCollected: number
): MissionAdvanceResult {
  var goals = state.mission_goals || [];
  var activeMissions = state.active_missions || [];
  if (!goals.length || !activeMissions.length || !profilesCollected || !contactGestalt) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = goals.map(function (goal) {
    if (goal.workflow !== 'collect_profiles' || goal.complete) return goal;
    if (goal.target !== contactGestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    var newAmount = Math.min((goal.current_amount || 0) + profilesCollected, goal.amount);
    if (newAmount === goal.current_amount) return goal;
    changed = true;
    return Object.assign({}, goal, {
      current_amount: newAmount,
      complete: newAmount >= goal.amount,
    });
  });

  if (!changed) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

function _completeMissionsIfReady(
  updatedGoals: MissionGoal[],
  activeMissions: string[],
  nodes: GameNode[]
): MissionAdvanceResult {
  var ruleset = _getRuleset();
  var completed: string[] = [];
  var newActive = activeMissions.slice();

  // Loop so a cascade activation whose buy_perp goals auto-complete (because
  // the player already owns the targets) is itself recognized as finished
  // in the same pass — otherwise the mission stays in active_missions with
  // every goal checked off.
  while (true) {
    var newlyCompleted: string[] = [];
    var stillActive = newActive.filter(function (mGestalt) {
      var goals = updatedGoals.filter(function (g) {
        return g.mission === mGestalt;
      });
      if (!goals.length) return true;
      if (
        goals.every(function (g) {
          return g.complete;
        })
      ) {
        newlyCompleted.push(mGestalt);
        return false;
      }
      return true;
    });

    if (!newlyCompleted.length) break;
    completed = completed.concat(newlyCompleted);
    newActive = stillActive;

    if (ruleset && ruleset.missions) {
      _eachMissionDef(ruleset, function (def) {
        var td = def.type_data;
        if (!td) return;
        var req = td.required_mission;
        var gestalt = td.gestalt;
        if (!req || !gestalt || newActive.indexOf(gestalt) !== -1) return;
        if (newlyCompleted.indexOf(req) === -1) return;
        var seededGestalt: string = gestalt;
        newActive.push(seededGestalt);
        (td.goals || []).forEach(function (g) {
          updatedGoals = updatedGoals.concat([_seedGoalRow(seededGestalt, g)]);
        });
      });
      // Auto-complete buy_perp goals for items the player already owns so a
      // mission that unlocks after the item was bought doesn't get stuck.
      // `nodes` is the caller's locally-projected node list — reading global
      // state here would miss own deltas the async webxdc echo hasn't applied
      // yet (e.g. the perp just bought this turn), stranding the cascaded
      // mission until a reload replayed the log.
      updatedGoals = _autoCompleteBuyPerpGoals(updatedGoals, nodes);
      updatedGoals = _autoCompleteBuyPowerupGoals(updatedGoals, nodes);
    }
  }

  var updatedMissions = activeMissions.filter(function (m) {
    var goals = updatedGoals.filter(function (g) {
      return g.mission === m;
    });
    return goals.some(function (g) {
      return g.current_amount > 0 || g.complete;
    });
  });

  return {
    missions: {
      complete_missions: completed,
      updated_missions: updatedMissions,
      mission_data: {
        active_missions: newActive,
        mission_goals: updatedGoals,
      },
    },
    rewards: _collectMissionRewards(ruleset, completed),
    mission_goals: updatedGoals,
    active_missions: newActive,
  };
}

// Flips goals where current_amount >= amount but complete=false (caused by
// progression handlers that updated current_amount without setting complete),
// and also drives mission completion for missions whose goals were all
// flagged complete at seed time but never left active_missions.
// Returns null when nothing needed repair so callers can skip persistence.
function _repairStuckMissionGoals(state: LocalState): MissionAdvanceResult | null {
  var goals = state.mission_goals || [];
  var activeMissions = state.active_missions || [];
  if (!goals.length || !activeMissions.length) return null;

  var activeSet: Record<string, true> = {};
  activeMissions.forEach(function (m) {
    activeSet[m] = true;
  });

  var changed = false;
  var updatedGoals = goals.map(function (goal) {
    if (goal.complete || !activeSet[goal.mission]) return goal;
    var amount = goal.amount || 0;
    if (amount > 0 && (goal.current_amount || 0) >= amount) {
      changed = true;
      return Object.assign({}, goal, { complete: true, current_amount: amount });
    }
    return goal;
  });

  // Also catches missions whose goals were auto-completed at seed time
  // (e.g. buy_perp targets the player already owned): the goals are flagged
  // complete but the mission never left active_missions.
  var hasFinishedActiveMission = activeMissions.some(function (mGestalt) {
    var mg = updatedGoals.filter(function (g) {
      return g.mission === mGestalt;
    });
    return (
      mg.length > 0 &&
      mg.every(function (g) {
        return g.complete;
      })
    );
  });

  if (!changed && !hasFinishedActiveMission) return null;
  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

// Sums up cash / xp / karma rewards across the just-completed missions so
// the caller can fold them into the new game_values. Without this, mission
// completion notifications fire but the player never sees the payout.
type RewardKey = 'cash_value' | 'xp_value' | 'karma_value' | 'profiles_max';
type RewardTotals = Record<RewardKey, number>;

function _isRewardKey(s: string): s is RewardKey {
  return s === 'cash_value' || s === 'xp_value' || s === 'karma_value' || s === 'profiles_max';
}

function _collectMissionRewards(ruleset: Ruleset, completedGestalts: string[]): RewardTotals {
  var totals: RewardTotals = { cash_value: 0, xp_value: 0, karma_value: 0, profiles_max: 0 };
  if (!completedGestalts.length || !ruleset || !ruleset.missions) return totals;
  completedGestalts.forEach(function (mGestalt) {
    var def = _findMissionDef(ruleset, mGestalt);
    var rewards = (def && def.type_data && def.type_data.rewards) || [];
    rewards.forEach(function (r) {
      if (!r || typeof r.amount !== 'number') return;
      var t = r.target;
      if (t && _isRewardKey(t)) {
        totals[t] += r.amount;
      }
    });
  });
  return totals;
}

// Folds reward totals into a fresh game_values object, clamping karma to
// [-100, 100] to match the integrate/karmalizer math.
function _applyRewardsToGv(gv: GameValues, rewards: RewardSet | undefined): GameValues {
  if (!rewards) return gv;
  return Object.assign({}, gv, {
    cash_value: (gv.cash_value || 0) + (rewards.cash_value || 0),
    xp_value: (gv.xp_value || 0) + (rewards.xp_value || 0),
    karma_value: Math.max(-100, Math.min(100, (gv.karma_value || 0) + (rewards.karma_value || 0))),
    profiles_max: (gv.profiles_max || 0) + (rewards.profiles_max || 0),
  });
}

// Folds mission-repair reward totals into game_values and, when the reward XP
// crosses a level threshold, applies the level-up (energy refill + raised
// ap_max). Returns the new level number, or 0 when no level-up occurred.
// Shared by the loadGame startup repair and the recheckMissions handler so
// the two stay in lockstep.
function _applyRepairRewards(
  gv: GameValues,
  rewards: RewardSet | undefined
): { game_values: GameValues; levelup: number } {
  var newGv = _applyRewardsToGv(gv, rewards);
  if (_checkLevelup(gv.xp_level || 1, newGv.xp_value || 0)) {
    var newLevel = _getLevelByXP(newGv.xp_value || 0);
    return { game_values: _applyLevelUp(newGv, newLevel), levelup: newLevel };
  }
  return { game_values: newGv, levelup: 0 };
}

function _advanceChargePerpMissions(state: LocalState, gestalt: string): MissionAdvanceResult {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'charge_perp' || goal.complete) return goal;
    if (goal.target !== gestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    changed = true;
    return _completeGoal(goal);
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

function _advanceBuyPowerupMissions(
  state: LocalState,
  powerupGestalt: string
): MissionAdvanceResult {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'buy_powerup' || goal.complete) return goal;
    if (goal.target !== powerupGestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    changed = true;
    return _completeGoal(goal);
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

function _advanceUpgradeTokenMissions(
  state: LocalState,
  tokenGestalt: string
): MissionAdvanceResult {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'upgrade_token' || goal.complete) return goal;
    if (goal.target !== tokenGestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    changed = true;
    return _completeGoal(goal);
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

/**
 * Advance any active mission goals that have workflow==='buy_perp' and
 * target===gestalt.  Pure; does not mutate state.
 */
function _advanceBuyPerpMissions(state: LocalState, gestalt: string): MissionAdvanceResult {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow === 'buy_perp' && goal.target === gestalt && !goal.complete) {
      // !goal.complete is not sufficient: completing a goal for a mission already
      // removed from activeMissions leaves mission_goals in an inconsistent state.
      if (activeMissions.indexOf(goal.mission) === -1) return goal;
      changed = true;
      return _completeGoal(goal);
    }
    return goal;
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

function _advanceCollectCashMissions(
  state: LocalState,
  gestalt: string,
  cashGain: number
): MissionAdvanceResult {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length || !cashGain || !gestalt) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'collect_cash' || goal.complete) return goal;
    if (goal.target !== gestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    var newAmount = Math.min((goal.current_amount || 0) + cashGain, goal.amount);
    if (newAmount === goal.current_amount) return goal;
    changed = true;
    return Object.assign({}, goal, {
      current_amount: newAmount,
      complete: newAmount >= goal.amount,
    });
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions, state.nodes);
}

// ---------------------------------------------------------------------------
// chargePerp — Phase 3 (#16)
// ---------------------------------------------------------------------------

export function chargePerp(
  path: string
): Promise<{ result: { error: number } | Record<string, unknown> }> {
  var rawState = getState();
  var now = clockNow();
  var ruleset = _getRuleset();

  // Materialize before reading game_values so AP regen ticks accumulated
  // since the last handler call are visible. Without this, the UI's
  // APTicker can show 1 AP while state.ap_snapshot still says 0, and
  // chargePerp would refuse the action despite the visible bar.
  var mat = materialize(rawState, now);
  var state = mat.state;

  var nodes = state.nodes || [];
  var nodeIdx = -1;
  for (var i = 0; i < nodes.length; i++) {
    var n0 = nodes[i];
    if (n0 && n0.full_path === path) {
      nodeIdx = i;
      break;
    }
  }
  if (nodeIdx < 0) return Promise.resolve({ result: { error: 1 } });

  var node = nodes[nodeIdx];
  if (!node) return Promise.resolve({ result: { error: 1 } });
  var gestalt = node.gestalt || _gestaltFrom(node.full_type) || '';
  var perpDef: PerpDef | undefined = gestalt
    ? ruleset.perps[gestalt] || ruleset.tokens[gestalt]
    : undefined;
  var typeData: PerpTypeData | undefined = perpDef ? perpDef.type_data : undefined;
  if (!typeData || typeof typeData.charge_time !== 'number') {
    return Promise.resolve({ result: { error: 1 } });
  }

  var charging = state.nodes_charging || [];
  for (var j = 0; j < charging.length; j++) {
    var ce = charging[j];
    if (ce && ce.path === path) return Promise.resolve({ result: { error: 2 } });
  }

  var gv = state.game_values || {};
  var instanceData: NodeInstanceData = node.instance_data || {};
  // charge_cost: instance_data wins (powerup-modified), then type_data, then 0.
  var chargeCost =
    typeof instanceData.charge_cost === 'number'
      ? instanceData.charge_cost
      : typeof typeData.charge_cost === 'number'
        ? typeData.charge_cost
        : 0;

  // Distinct codes (1=AP, 3=cash) let Game.js show the correct feedback animation.
  // Return the materialized snapshot so the client can resync its free-running
  // APTicker estimate down to the authoritative value — otherwise the bar stays
  // showing phantom energy the engine has already refused.
  var apSnap = gv.ap_snapshot || 0;
  if (apSnap < 1) return Promise.resolve({ result: { error: 1, ap_snapshot: apSnap } });
  if ((gv.cash_value || 0) < chargeCost) return Promise.resolve({ result: { error: 3 } });

  // ClientPerps don't carry collect_amount in the ruleset — they ship
  // income_base / income_factor instead. Fall back so charging the car
  // company actually pays out when collected.
  var baseAmount =
    typeof instanceData.collect_amount === 'number'
      ? instanceData.collect_amount
      : typeof typeData.collect_amount === 'number'
        ? typeData.collect_amount
        : typeof typeData.income_base === 'number'
          ? typeData.income_base
          : 0;
  // SuperTokenPerp upgrade popup compares current DB state to the snapshot
  // taken at the last compute to render "not yet analyzed" vs "already
  // analyzed". Other perp types never read this, so skip the work.
  var lastUpgradeData: UpgradeValuesShape | undefined =
    node.game_type === 'TokenPerp'
      ? { profiles_value: gv.profiles_value || 0, token_map: _buildTokenMap(nodes) }
      : undefined;

  var chargeResult: { amount: number; last_upgrade_data?: UpgradeValuesShape } = {
    amount: _getVariatedAmount(baseAmount, now, path),
  };
  if (lastUpgradeData) chargeResult.last_upgrade_data = lastUpgradeData;

  var durationMs = typeData.charge_time;
  var chargeEntry = {
    path: path,
    result: chargeResult,
    charge_start: now,
    charge_end: now + durationMs,
    game_id: node.game_id || path,
    game_type: node.game_type || '',
  };

  var xpInc = typeof typeData.xp_inc === 'number' ? typeData.xp_inc : 0;

  // mirrors dd_app views.py:776: $set charge_start + last_upgrade_values,
  // $addToSet nodes_charging, $inc cash_value/cash_spent/xp_value, $dec ap_snapshot
  var newNodes = nodes.map(function (n, idx) {
    if (idx !== nodeIdx) return n;
    var inst: Record<string, unknown> = Object.assign({}, n.instance_data, {
      charge_start: now,
    });
    if (lastUpgradeData) inst.last_upgrade_values = lastUpgradeData;
    return Object.assign({}, n, { instance_data: inst });
  });

  var newGv: GameValues = Object.assign({}, gv, {
    cash_value: (gv.cash_value || 0) - chargeCost,
    cash_spent: (gv.cash_spent || 0) + chargeCost,
    xp_value: (gv.xp_value || 0) + xpInc,
    ap_snapshot: Math.max(0, (gv.ap_snapshot || 0) - 1),
  });

  var oldLevelNum = gv.xp_level || 1;
  var newLevelNum = _getLevelByXP(newGv.xp_value || 0);
  var levelup = newLevelNum > oldLevelNum;
  if (levelup) newGv = _applyLevelUp(newGv, newLevelNum);

  var preMissionStateCharge = Object.assign({}, state, {
    nodes: newNodes,
    nodes_charging: charging.concat([chargeEntry]),
    game_values: newGv,
  });

  var chargeMissionResult = _advanceChargePerpMissions(preMissionStateCharge, gestalt);
  newGv = _applyRewardsToGv(newGv, chargeMissionResult.rewards);

  _persistDelta(
    _mkDelta(state.addr, 'chargePerp', [path], {
      chargeEntry: chargeEntry,
      cashDelta: chargeCost,
      xpInc: xpInc,
      game_values: newGv,
      missions: chargeMissionResult.missions || null,
    })
  );

  // Live-tick: emit node_ready at exactly charge_end so the perp flips to
  // collectable without depending on the player reloading.
  _scheduleChargeReady(chargeEntry);

  // Achievements
  var _cpDisplayName = state.display_name || state.addr;
  if (levelup) {
    triggerAchievement('levelup', _t('achievement_levelup', _cpDisplayName, String(newLevelNum)));
  }
  var _cpCompletedMissions =
    (chargeMissionResult.missions && chargeMissionResult.missions.complete_missions) || [];
  for (var _cpMi = 0; _cpMi < _cpCompletedMissions.length; _cpMi++) {
    var mGestalt = _cpCompletedMissions[_cpMi];
    if (typeof mGestalt !== 'string') continue;
    var _cpMDef = _findMissionDef(_getRuleset(), mGestalt);
    var _cpMTitle = (_cpMDef && _cpMDef.type_data && _cpMDef.type_data.title) || mGestalt;
    triggerAchievement('mission_done', _t('achievement_mission_done', _cpDisplayName, _cpMTitle), {
      mission: mGestalt,
    });
  }

  return Promise.resolve({
    result: {
      game_values: newGv,
      duration: durationMs,
      levelup: levelup,
      missions: chargeMissionResult.missions || {},
    },
  });
}

// Active charge-ready timers, keyed by path. Tracking lets us clear stale
// handles before re-scheduling — e.g. when loadGame replays history we
// re-arm every in-flight charge, and without cleanup duplicate timers fire
// duplicate node_ready events for the same charge.
type TimerHandle = ReturnType<typeof setTimeout>;
var _chargeReadyTimers: Record<string, TimerHandle> = {};

function _clearChargeReady(path: string): void {
  if (!path) return;
  var h = _chargeReadyTimers[path];
  if (h === undefined) return;
  clearTimeout(h);
  delete _chargeReadyTimers[path];
}

function _clearAllChargeReady(): void {
  Object.keys(_chargeReadyTimers).forEach(function (p) {
    var h = _chargeReadyTimers[p];
    if (h !== undefined) clearTimeout(h);
  });
  _chargeReadyTimers = {};
}

// One-shot per charge: at charge_end, emit node_ready so the UI flips to
// collectable without a reload.
//
// The node_ready payload is built from the charge `entry` the caller already
// holds — NOT re-derived from global state. Under canonical-async webxdc the
// chargePerp echo may not have been applied when this fires (messenger lag,
// app backgrounded, ~0 ms charge_time); reading nodes_charging back here would
// see it absent and strand the perp "charging" until a reload replayed the
// log. Tying the emit to the originating intent removes that whole class of
// stuck-action. materialize()+setState still advances time-based state
// (AP regen, and the charge→collect promotion once the echo lands) — a near
// no-op while the echo is in flight; collectPerp re-materializes on collect
// regardless. One timer per path (cleared+rearmed via _chargeReadyTimers)
// guarantees a single emit per charge cycle, so no stale-state dedup probe
// is needed.
function _scheduleChargeReady(entry: ChargingEntry): void {
  if (typeof setTimeout !== 'function') return;
  var path = entry.path;
  _clearChargeReady(path);
  var msUntil = Math.max(0, entry.charge_end - clockNow());
  var handle = setTimeout(function () {
    if (path) delete _chargeReadyTimers[path];
    var s = getState();
    if (!s) return;
    var mat = materialize(s, clockNow());
    setState(mat.state);
    _emit('node_ready', {
      id: entry.game_id,
      type: entry.game_type,
      path: entry.path,
      result: entry.result,
    });
  }, msUntil);
  if (path) _chargeReadyTimers[path] = handle;
}

// ---------------------------------------------------------------------------
// PRNG — Mulberry32, seeded for deterministic tests.
// Call setPrngSeed(n) before any handler invocation that uses RNG.
// ---------------------------------------------------------------------------
var _prngSeed = 0xdeadbeef;

/**
 * Seed the deterministic PRNG used for charge-amount jitter.
 * Call in tests before any chargePerp invocation to get repeatable results.
 */
export function setPrngSeed(seed: number): void {
  _prngSeed = seed >>> 0;
}

function _rng(): number {
  _prngSeed = (_prngSeed + 0x6d2b79f5) | 0;
  var t = Math.imul(_prngSeed ^ (_prngSeed >>> 15), 1 | _prngSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function _generateId(): string {
  // Timestamp base + two RNG words → collision-resistant string without deps.
  return (
    Date.now().toString(36) +
    Math.floor(_rng() * 0xffffff).toString(36) +
    Math.floor(_rng() * 0xffffff).toString(36)
  );
}

interface KarmaIncident {
  gestalt: string;
  karma_delta: number;
}

// Returns { gestalt, karma_delta } if a karma incident fires, else null.
// factor = sqrt((-karma)/100) + 0.05  (dd_app views.py:483 WeightedRandomizer)
function _handleKarmaIncident(gv: GameValues, ruleset: Ruleset): KarmaIncident | null {
  var karma = (gv && gv.karma_value) || 0;
  if (karma >= 0) return null;

  var factor = (-karma / 100) ** 0.5 + 0.05;
  if (_rng() >= factor) return null;

  var level = (gv && gv.xp_level) || 1;
  var eligible = (ruleset.karmalizers || []).filter(function (k) {
    return level >= ((k.type_data && k.type_data.required_level) || 1);
  });
  if (!eligible.length) return null;

  var k = eligible[Math.floor(_rng() * eligible.length)];
  if (!k) return null;
  return {
    gestalt: (k.type_data && k.type_data.gestalt) || '',
    karma_delta: (k.type_data && k.type_data.karma_points) || -1,
  };
}

// ---------------------------------------------------------------------------
// collectPerp — #17
// ---------------------------------------------------------------------------

/**
 * collectPerp(gperpPath) → Promise<{result}>
 *
 * Materialize first (moves ready charges → nodes_collect).  Branch on perp
 * game_type to build the typed result payload.  $pull from nodes_collect,
 * $inc xp_value (from ruleset type_data.xp_inc, NOT from the charge result).
 * Optionally fire karma incident.  For ContactPerp/ProjectPerp: $push
 * db_queue entry for integrateCollected.
 *
 * nodes_collect[i].result schema (written by chargePerp, Thread S PR #72):
 *   { amount: number } — varied collect_amount from _getVariatedAmount.
 *
 * Error codes match dd_app:
 *   1 — path not in nodes_collect (not ready / hasn't charged)
 *   2 — node not found in state.nodes
 *   3 — unknown game_type
 *   4 — insufficient AP (parity with chargePerp / integrateCollected)
 */
interface DbEntry {
  origin: string;
  collect_id: string;
  profile_set: { profiles_value: number; tokens_map: Record<string, { amount: number }> };
  collect_dt?: number;
}
interface TokenUpdate {
  path: string;
  amount: number;
}

export function collectPerp(
  gperpPath: string
): Promise<{ result: { error: number } | Record<string, unknown> }> {
  var state = getState();
  var now = clockNow();
  var ruleset = _getRuleset();

  // Materialise time-based progression before testing readiness. Reading
  // ap_snapshot after materialize ensures AP regen ticks accumulated since
  // the last handler call are visible — without this the engine could refuse
  // a collect that the UI's APTicker shows as affordable.
  var mat = materialize(state, now);
  var ms = mat.state;

  // Each collect costs 1 AP (parity with chargePerp / integrateCollected).
  // The UI pre-checks ap_value < 1 in {Client,Contact,Project,Token}Perp.collect
  // and shows FXNoAP; the engine still guards as defence-in-depth.
  var apSnap = (ms.game_values && ms.game_values.ap_snapshot) || 0;
  if (apSnap < 1) {
    return Promise.resolve({ result: { error: 4, ap_snapshot: apSnap } });
  }

  var collectEntry: { path: string; result?: { amount?: number } } | null = null;
  for (var i = 0; i < ms.nodes_collect.length; i++) {
    var ne = ms.nodes_collect[i];
    if (ne && ne.path === gperpPath) {
      collectEntry = ne;
      break;
    }
  }
  if (!collectEntry) {
    return Promise.resolve({ result: { error: 1 } });
  }

  var node: GameNode | null = null;
  for (var j = 0; j < ms.nodes.length; j++) {
    var nn = ms.nodes[j];
    if (nn && nn.full_path === gperpPath) {
      node = nn;
      break;
    }
  }
  if (!node) {
    return Promise.resolve({ result: { error: 2 } });
  }

  var gestalt = node.gestalt || _gestaltFrom(node.full_type) || '';
  var perpDef: PerpDef | undefined = gestalt
    ? ruleset.perps[gestalt] || ruleset.tokens[gestalt]
    : undefined;
  var typeData: PerpTypeData | undefined = perpDef ? perpDef.type_data : undefined;

  var cr = collectEntry.result || {};
  var xpGain = typeData && typeof typeData.xp_inc === 'number' ? typeData.xp_inc : 1;
  var gameType = node.game_type;

  var newCollect = ms.nodes_collect.filter(function (e) {
    return e.path !== gperpPath;
  });
  var newGv: GameValues = Object.assign({}, ms.game_values, {
    xp_value: (ms.game_values.xp_value || 0) + xpGain,
    ap_snapshot: Math.max(0, (ms.game_values.ap_snapshot || 0) - 1),
  });

  var innerResult: Record<string, unknown>;
  var newNodes: GameNode[] = ms.nodes;
  var newQueue = ms.db_queue || [];
  var dbEntry: DbEntry | null = null;
  var tokenUpdate: TokenUpdate | null = null;

  if (gameType === 'ContactPerp' || gameType === 'ProjectPerp') {
    var collectId = _generateId();
    // ContactPerps store yielded token-types under `tokens`; TokenPerps
    // (super-token decomposition) under `contained_tokens` — accept either.
    var tokensMap: Record<string, { amount: number }> = {};
    var contained: TokenSpec[] = (typeData && (typeData.tokens || typeData.contained_tokens)) || [];
    for (var ct = 0; ct < contained.length; ct++) {
      var ctEntry = contained[ct];
      if (ctEntry && ctEntry.gestalt) {
        tokensMap[ctEntry.gestalt] = { amount: ctEntry.amount || 0 };
      }
    }
    var profileSet = { profiles_value: cr.amount || 0, tokens_map: tokensMap };
    dbEntry = {
      origin: gperpPath,
      collect_id: collectId,
      profile_set: profileSet,
      collect_dt: now,
    };
    newQueue = newQueue.concat([dbEntry]);
    innerResult = { profile_set: profileSet, origin: gperpPath, collect_id: collectId };
  } else if (gameType === 'ClientPerp') {
    var cashGain = cr.amount || 0;
    newGv = Object.assign({}, newGv, {
      cash_value: (ms.game_values.cash_value || 0) + cashGain,
    });
    innerResult = { cash: cashGain };
  } else if (gameType === 'TokenPerp') {
    var tpIdata: NodeInstanceData = node.instance_data || {};
    var prevAmount = typeof tpIdata.amount === 'number' ? tpIdata.amount : 0;
    var newAmount = prevAmount + (cr.amount || 0);
    tokenUpdate = { path: gperpPath, amount: newAmount };
    newNodes = ms.nodes.map(function (n) {
      if (n.full_path !== gperpPath) return n;
      return Object.assign({}, n, {
        instance_data: Object.assign({}, n.instance_data, { amount: newAmount }),
      });
    });
    innerResult = { token_upgraded_amount: newAmount };
  } else {
    return Promise.resolve({ result: { error: 3 } });
  }

  var incident = _handleKarmaIncident(newGv, ruleset);
  if (incident) {
    newGv = Object.assign({}, newGv, {
      karma_value: Math.max(-100, Math.min(100, (newGv.karma_value || 0) + incident.karma_delta)),
    });
  }

  var oldLevel = (ms.game_values && ms.game_values.xp_level) || 1;
  var newLevel = _getLevelByXP(newGv.xp_value || 0);
  var levelup = newLevel > oldLevel;
  if (levelup) newGv = _applyLevelUp(newGv, newLevel);

  var preMissionState = Object.assign({}, ms, {
    nodes: newNodes,
    nodes_collect: newCollect,
    db_queue: newQueue,
    game_values: newGv,
    last_seen_ts: Math.max(now, ms.last_seen_ts || 0),
  });

  // biome-ignore lint/suspicious/noImplicitAnyLet: typed on first assignment below
  var collectMissionResult;
  if (gameType === 'ContactPerp') {
    collectMissionResult = _advanceCollectProfilesMissions(
      preMissionState,
      gestalt,
      cr.amount || 0
    );
  } else if (gameType === 'ClientPerp') {
    collectMissionResult = _advanceCollectCashMissions(preMissionState, gestalt, cr.amount || 0);
  } else if (gameType === 'TokenPerp') {
    collectMissionResult = _advanceUpgradeTokenMissions(preMissionState, gestalt);
  } else {
    collectMissionResult = {
      missions: null,
      mission_goals: preMissionState.mission_goals,
      active_missions: preMissionState.active_missions,
    };
  }
  newGv = _applyRewardsToGv(newGv, collectMissionResult.rewards);
  var newState = Object.assign({}, preMissionState, {
    game_values: newGv,
    mission_goals: collectMissionResult.mission_goals,
    active_missions: collectMissionResult.active_missions,
  });

  var deltaResult: {
    game_values: GameValues;
    path: string;
    missions: MissionUpdate | null;
    db_entry?: DbEntry;
    token_update?: TokenUpdate;
  } = { game_values: newGv, path: gperpPath, missions: collectMissionResult.missions };
  if (dbEntry) deltaResult.db_entry = dbEntry;
  if (tokenUpdate) deltaResult.token_update = tokenUpdate;
  _persistDelta(_mkDelta(state.addr, 'collectPerp', [gperpPath], deltaResult));

  var response = Object.assign(
    {
      result: innerResult,
      game_values: newGv,
      levelup: levelup,
      missions: collectMissionResult.missions || { complete_missions: [], updated_missions: [] },
    },
    incident ? { karma_incident: incident.gestalt } : {}
  );

  // Achievements
  var _clpDisplayName = state.display_name || state.addr;
  if (levelup) {
    triggerAchievement('levelup', _t('achievement_levelup', _clpDisplayName, String(newLevel)));
  }
  var _clpCompletedMissions =
    (collectMissionResult.missions && collectMissionResult.missions.complete_missions) || [];
  for (var _clpMi = 0; _clpMi < _clpCompletedMissions.length; _clpMi++) {
    var clpG = _clpCompletedMissions[_clpMi];
    if (typeof clpG !== 'string') continue;
    var _clpMDef = _findMissionDef(_getRuleset(), clpG);
    var _clpMTitle = (_clpMDef && _clpMDef.type_data && _clpMDef.type_data.title) || clpG;
    triggerAchievement(
      'mission_done',
      _t('achievement_mission_done', _clpDisplayName, _clpMTitle),
      { mission: clpG }
    );
  }
  var _clpOldKarma = (ms.game_values && ms.game_values.karma_value) || 0;
  var _clpNewKarma = newGv.karma_value || 0;
  if (incident) {
    if (_clpOldKarma !== -100 && _clpNewKarma === -100) {
      triggerAchievement('karma_devil', _t('achievement_karma_devil', _clpDisplayName));
    }
  }

  // Emit materializer events + optional levelup new_items after the caller's
  // microtask resolves (mirrors dd_app's deferred Celery notifyLevelupItems).
  var matEvents = mat.events;
  var emitLevel = levelup ? newLevel : 0;
  queueMicrotask(function () {
    for (var ei = 0; ei < matEvents.length; ei++) {
      var ev = matEvents[ei];
      if (ev) _emit(ev.ev, ev.pl);
    }
    if (emitLevel) {
      _emit('new_items', { perps: [], powerups: {}, trigger: 'levelup', level: emitLevel });
    }
  });

  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// integrateCollected — #17
// ---------------------------------------------------------------------------

/**
 * integrateCollected(collectId) → Promise<{result}>
 *
 * $pull the db_queue entry by collect_id.  Apply integration rewards:
 * $inc profiles_value (dup-safe), xp_value, karma_value.  Update token
 * node amounts from profile_set.tokens_map.  Persists a delta carrying
 * full game_values and the touched nodes so the reducer can replay it
 * on cold start.
 *
 * Error codes:
 *   0 — collect_id not in db_queue (already integrated or never collected)
 *   1 — insufficient AP (parity with chargePerp)
 */
/**
 * The persisted shape of state.db_queue[i].profile_set as written by
 * collectPerp / buyPerp.  state.ts:DbQueueEntry types `profile_set: any`
 * to keep the reducer free of cross-module schema knowledge; this view
 * narrows it locally for the integrate path.
 */
interface ProfileSetView {
  profiles_value?: number;
  tokens_map?: Record<string, { amount?: number }>;
  xp_gain?: number;
  karma_gain?: number;
}

export function integrateCollected(
  collectId: string
): Promise<{ result: { error: number } | Record<string, unknown> }> {
  var rawState = getState();
  var now = clockNow();
  var state = materialize(rawState, now).state;

  var apSnap = (state.game_values && state.game_values.ap_snapshot) || 0;
  if (apSnap < 1) {
    return Promise.resolve({ result: { error: 1, ap_snapshot: apSnap } });
  }

  var queue = state.db_queue || [];
  var entry = queue.find(function (q) {
    return q.collect_id === collectId;
  });
  if (!entry) {
    return Promise.resolve({ result: { error: 0 } });
  }
  var newQueue = queue.filter(function (q) {
    return q.collect_id !== collectId;
  });

  var ps: ProfileSetView = (entry.profile_set as ProfileSetView) || {};
  var profilesIncrement = ps.profiles_value || 0;

  var integratedIds = state.integrated_ids || {};
  var dup = integratedIds[collectId] ? profilesIncrement : 0;
  var increment = integratedIds[collectId] ? 0 : profilesIncrement;
  var newIntegratedIds = Object.assign({}, integratedIds, { [collectId]: true });

  var xpGain = ps.xp_gain || 0;
  var karmaGain = ps.karma_gain || 0;
  var newGv: GameValues = Object.assign({}, state.game_values, {
    xp_value: (state.game_values.xp_value || 0) + xpGain,
    karma_value: Math.max(-100, Math.min(100, (state.game_values.karma_value || 0) + karmaGain)),
    profiles_value: (state.game_values.profiles_value || 0) + increment,
    ap_snapshot: Math.max(0, (state.game_values.ap_snapshot || 0) - 1),
  });

  var ruleset = _getRuleset();
  var tokensMap: Record<string, { amount?: number }> = ps.tokens_map || {};
  var updatedNodes: GameNode[] = [];
  var seenGestalts: Record<string, true> = {};

  // Weighted-average share merge — upstream dd_app/dd_calc.py
  // `Database.merge` computes:
  //   new_share = min(100, (db_share * M + ps_share * N) / (M + N))
  // for every TokenPerp the new profileset touches, and dilutes
  // un-touched tokens by:
  //   new_share = (db_share * M) / (M + N)
  // `M` is `profiles_value` *before* this integration; `N` is the new
  // profileset's `profiles_value` (== `increment`, so 0 on a duplicate
  // collect_id replay → no share change). This preserves the absolute
  // count `profiles_value * share / 100`, so mission_goals' monotonic
  // current_amount keeps advancing. See docs/ui-meters.md.
  var M = Math.max(0, (state.game_values && state.game_values.profiles_value) || 0);
  var N = Math.max(0, increment);
  var denom = M + N;
  // denom === 0 only happens on a replay against an empty DB — every
  // share would round-trip to oldShare and no new tokens can be seeded
  // (seedShare = 0). Bail before the per-node arithmetic.
  var skipMerge = denom === 0;

  var newNodes: GameNode[] = (state.nodes || []).map(function (n) {
    if (skipMerge) return n;
    if (n.game_type !== 'TokenPerp' || !n.gestalt) return n;
    var npIdata: NodeInstanceData = n.instance_data || {};
    var oldShare = typeof npIdata.amount === 'number' ? npIdata.amount : 0;
    var tok = tokensMap[n.gestalt];
    if (tok) seenGestalts[n.gestalt] = true;
    var psContrib = tok ? (tok.amount || 0) * N : 0;
    var newShare = Math.min(100, (oldShare * M + psContrib) / denom);
    if (Math.abs(newShare - oldShare) < 1e-9) return n;
    var updated: GameNode = Object.assign({}, n, {
      instance_data: Object.assign({}, n.instance_data, { amount: newShare }),
    });
    updatedNodes.push(updated);
    return updated;
  });

  // First-time integration of a token type: append a new TokenPerp node
  // under Database.<gestalt>. Without this, DBTokens stays empty, the
  // Database tab stays blank, and integrate_profiles missions never tick.
  // Seed without x/y so the UI's setRandomPosition (Render.js:2393) places
  // the new tile with collision avoidance around (1024,800), then
  // saveCoordsQueue persists the resolved position. Pre-seeding x/y
  // bypassed that and made every new token stack at a single hashed point.
  // Initial share = ps_share * N / (M + N) (= ps_share when M = 0).
  if (!skipMerge)
    Object.keys(tokensMap).forEach(function (gestalt) {
      if (seenGestalts[gestalt]) return;
      if (!ruleset.tokens || !ruleset.tokens[gestalt]) return;
      var tok = tokensMap[gestalt];
      if (!tok) return;
      var seedShare = Math.min(100, ((tok.amount || 0) * N) / denom);
      var newNode: GameNode = {
        game_id: gestalt,
        gestalt: gestalt,
        game_type: 'TokenPerp',
        full_type: 'TokenPerp:' + gestalt,
        full_path: 'Database.' + gestalt,
        instance_data: { amount: seedShare },
      };
      newNodes.push(newNode);
      updatedNodes.push(newNode);
    });

  var oldLevel = (state.game_values && state.game_values.xp_level) || 1;
  var newLevel = _getLevelByXP(newGv.xp_value || 0);
  var levelup = newLevel > oldLevel;
  if (levelup) newGv = _applyLevelUp(newGv, newLevel);

  var preMissionState = Object.assign({}, state, {
    db_queue: newQueue,
    nodes: newNodes,
    game_values: newGv,
    integrated_ids: newIntegratedIds,
    last_seen_ts: Math.max(now, state.last_seen_ts || 0),
  });

  // Advance integrate_profiles goals against the new TokenPerp amounts.
  var missionResult = _advanceIntegrateProfilesMissions(
    preMissionState,
    newGv.profiles_value || 0,
    newNodes
  );
  newGv = _applyRewardsToGv(newGv, missionResult.rewards);
  var newState = Object.assign({}, preMissionState, {
    game_values: newGv,
    mission_goals: missionResult.mission_goals,
    active_missions: missionResult.active_missions,
  });

  // Persist delta for webxdc replay; result carries full state for the reducer.
  _persistDelta(
    _mkDelta(state.addr, 'integrateCollected', [collectId], {
      increment: increment,
      dup: dup,
      game_values: newGv,
      nodes: updatedNodes,
      missions: missionResult.missions,
    })
  );

  var response = {
    result: { nodes: updatedNodes, increment: increment, dup: dup },
    game_values: newGv,
    levelup: levelup,
    missions: missionResult.missions || { complete_missions: [], updated_missions: [] },
  };

  if (levelup) {
    queueMicrotask(function () {
      _emit('new_items', { perps: [], powerups: {}, trigger: 'levelup', level: newLevel });
    });
  }

  // Achievements
  var _icDisplayName = state.display_name || state.addr;
  if (levelup) {
    triggerAchievement('levelup', _t('achievement_levelup', _icDisplayName, String(newLevel)));
  }
  var _icCompletedMissions =
    (missionResult.missions && missionResult.missions.complete_missions) || [];
  for (var _icMi = 0; _icMi < _icCompletedMissions.length; _icMi++) {
    var icG = _icCompletedMissions[_icMi];
    if (typeof icG !== 'string') continue;
    var _icMDef = _findMissionDef(_getRuleset(), icG);
    var _icMTitle = (_icMDef && _icMDef.type_data && _icMDef.type_data.title) || icG;
    triggerAchievement('mission_done', _t('achievement_mission_done', _icDisplayName, _icMTitle), {
      mission: icG,
    });
  }
  var _icOldProfiles = (state.game_values && state.game_values.profiles_value) || 0;
  var _icNewProfiles = newGv.profiles_value || 0;
  if (_icOldProfiles < 1000000 && _icNewProfiles >= 1000000) {
    triggerAchievement(
      'profiles_milestone',
      _t('achievement_profiles_milestone', _icDisplayName, '1000000'),
      { threshold: 1000000 }
    );
  }
  var _icOldKarma = (state.game_values && state.game_values.karma_value) || 0;
  var _icNewKarma = newGv.karma_value || 0;
  if (_icOldKarma !== 100 && _icNewKarma === 100) {
    triggerAchievement('karma_saint', _t('achievement_karma_saint', _icDisplayName));
  }
  if (_icOldKarma !== -100 && _icNewKarma === -100) {
    triggerAchievement('karma_devil', _t('achievement_karma_devil', _icDisplayName));
  }

  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// dismissMissionBriefing(gestalt) — record that the player has closed
// the briefing popup for a given mission so we don't re-open it on reload.
// ---------------------------------------------------------------------------

export function markTokenSeen(gestalt: unknown): Promise<{ result: { error: 0 } | { ok: true } }> {
  if (typeof gestalt !== 'string' || !gestalt) {
    return Promise.resolve({ result: { error: 0 } });
  }
  var state = getState();
  var seen = state.tokens_seen || {};
  if (seen[gestalt]) {
    return Promise.resolve({ result: { ok: true } });
  }
  _persistDelta(_mkDelta(state.addr, 'markTokenSeen', [gestalt], { gestalt: gestalt }));
  return Promise.resolve({ result: { ok: true } });
}

export function dismissMissionBriefing(
  gestalt: unknown
): Promise<{ result: { error: 0 } | { ok: true } }> {
  if (typeof gestalt !== 'string' || !gestalt) {
    return Promise.resolve({ result: { error: 0 } });
  }
  var state = getState();
  var seen = state.mission_briefings_seen || {};
  if (seen[gestalt]) {
    return Promise.resolve({ result: { ok: true } });
  }
  _persistDelta(_mkDelta(state.addr, 'dismissMissionBriefing', [gestalt], { gestalt: gestalt }));
  return Promise.resolve({ result: { ok: true } });
}

// On-demand counterpart of the loadGame repair. Called when the player
// opens the Missions tab. Returns { repaired: false } when nothing was
// stuck so the caller can skip rerendering.
export function recheckMissions(): Promise<{
  result:
    | { repaired: false }
    | { repaired: true; missions: MissionUpdate; game_values: GameValues; levelup: boolean };
}> {
  var state = getState();
  var repair = _repairStuckMissionGoals(state);
  if (!repair || !repair.missions) {
    return Promise.resolve({ result: { repaired: false } });
  }
  // Reward XP may push the player into a new level — _applyRepairRewards
  // applies the energy refill if so.
  var rewardResult = _applyRepairRewards(state.game_values || {}, repair.rewards);
  var newGv = rewardResult.game_values;
  var rewardLevelup = rewardResult.levelup > 0;
  // `levelup` is intentionally not included in the persisted delta payload:
  // game_values (which already carries the updated ap_max/ap_snapshot/xp_level)
  // is the authoritative source for replay. Callers that need to show a
  // level-up notification should read it from the returned result, not replay.
  _persistDelta(
    _mkDelta(state.addr, 'recheckMissions', [], {
      game_values: newGv,
      missions: repair.missions,
    })
  );
  return Promise.resolve({
    result: {
      repaired: true,
      missions: repair.missions,
      game_values: newGv,
      levelup: rewardLevelup,
    },
  });
}

// ---------------------------------------------------------------------------
// Stub handlers — Wave 4+ issues fill these in.
// ---------------------------------------------------------------------------
var _STUBS = ['checkUsername'] as const;

type StubName = (typeof _STUBS)[number];
var _stubHandlers: Record<string, () => Promise<never>> = {};
_STUBS.forEach(function (name: StubName) {
  _stubHandlers[name] = function () {
    return Promise.reject('NotImplemented: ' + name);
  };
});

// ---------------------------------------------------------------------------
// Default export — object consumed by app.js via require('LocalEngine').
// Includes setEmitter so app.js can wire the DOM event bus after jQuery loads.
//
// Handler signature contract (all async handlers):
//   (args...) => Promise<{ result: HandlerResult } | { result: { error: number } }>
//
// HandlerResult shapes are documented in docs/response-shapes.md.
// ---------------------------------------------------------------------------
var LocalEngine = Object.assign(
  {
    getToken: getToken,
    ping: ping,
    getSessionLocale: getSessionLocale,
    setLocale: setLocale,
    exportSave: exportSave,
    importSave: importSave,
    loadGame: loadGame,
    getRanking: getRanking,
    setDisplayName: setDisplayName,
    setPerpCoordinates: setPerpCoordinates,
    getProvidedPerps: getProvidedPerps,
    getPowerups: getPowerups,
    buyKarma: buyKarma,
    buyPowerup: buyPowerup,
    sellPowerup: sellPowerup,
    buySlots: buySlots,
    buyPerp: buyPerp,
    chargePerp: chargePerp,
    collectPerp: collectPerp,
    integrateCollected: integrateCollected,
    dismissMissionBriefing: dismissMissionBriefing,
    markTokenSeen: markTokenSeen,
    recheckMissions: recheckMissions,
    setEmitter: setEmitter,
    setSendAchievement: setSendAchievement,
    setPrngSeed: setPrngSeed,
  },
  _stubHandlers
);

export default LocalEngine;
