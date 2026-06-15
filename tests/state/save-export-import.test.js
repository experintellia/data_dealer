// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Tests for the game-save export/import primitives (issue #127).
//
// Export must contain ONLY the current player's progress — never other
// players' aggregated leaderboard stats (state.peers) or the player's webxdc
// address (state.addr).  Import must replace the player's own progress while
// keeping their identity and peer table, and survive cold-start replay.
import { describe, expect, it } from 'vitest';
import {
  SAVE_FORMAT,
  SAVE_VERSION,
  SCHEMA_VERSION,
  applyDelta,
  buildSaveFile,
  buildSaveState,
  freshState,
  parseSaveFile,
} from '../../scripts/state.js';

const ADDR = 'alice@example.com';

function progressedState() {
  // A fresh state with some divergence from defaults plus a peer entry, so we
  // can assert the peer never leaks into an export.
  const s = freshState(ADDR);
  s.display_name = 'Alice';
  s.game_values = { ...s.game_values, cash_value: 9999, xp_value: 4242, xp_level: 7 };
  s.node_counter = 12;
  s.locale = 'en';
  s.peers = {
    'bob@example.com': { cash: 5, xp: 6, display_name: 'Bob' },
  };
  return s;
}

describe('buildSaveState — current user only', () => {
  it('omits addr and peers', () => {
    const snap = buildSaveState(progressedState());
    expect('addr' in snap).toBe(false);
    expect('peers' in snap).toBe(false);
  });

  it('carries the player progress fields', () => {
    const snap = buildSaveState(progressedState());
    expect(snap.display_name).toBe('Alice');
    expect(snap.game_values.cash_value).toBe(9999);
    expect(snap.node_counter).toBe(12);
    expect(snap.locale).toBe('en');
  });

  it('omits locale entirely when unset', () => {
    const s = freshState(ADDR); // no locale
    const snap = buildSaveState(s);
    expect('locale' in snap).toBe(false);
  });
});

describe('buildSaveFile / parseSaveFile round-trip', () => {
  it('stamps format + version metadata', () => {
    const file = buildSaveFile(progressedState(), 1234);
    expect(file.format).toBe(SAVE_FORMAT);
    expect(file.save_version).toBe(SAVE_VERSION);
    expect(file.schema_version).toBe(SCHEMA_VERSION);
    expect(file.exported_at).toBe(1234);
  });

  it('parses its own exported JSON', () => {
    const json = JSON.stringify(buildSaveFile(progressedState()));
    const parsed = parseSaveFile(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.save.state.game_values.cash_value).toBe(9999);
  });

  it('rejects non-JSON as malformed', () => {
    expect(parseSaveFile('not json {')).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects JSON without the format marker', () => {
    expect(parseSaveFile(JSON.stringify({ state: { game_values: {} } }))).toEqual({
      ok: false,
      error: 'malformed',
    });
  });

  it('rejects a save body with no game_values', () => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION,
      state: {},
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects a newer save_version', () => {
    const future = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION + 1,
      state: { game_values: {} },
    });
    expect(parseSaveFile(future)).toEqual({ ok: false, error: 'version' });
  });

  it('accepts an older save_version (forward-migration)', () => {
    const old = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION - 1,
      state: { game_values: { cash_value: 1 } },
    });
    const parsed = parseSaveFile(old);
    expect(parsed.ok).toBe(true);
  });

  it('treats a non-numeric save_version as malformed, not version', () => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: 'one',
      state: { game_values: {} },
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects a null state body', () => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION,
      state: null,
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects game_values that is not an object', () => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION,
      state: { game_values: 42 },
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects a JSON array (typeof object but not a save)', () => {
    expect(parseSaveFile('[1,2,3]')).toEqual({ ok: false, error: 'malformed' });
  });

  it('rejects the JSON literal null', () => {
    expect(parseSaveFile('null')).toEqual({ ok: false, error: 'malformed' });
  });
});

function importDelta(addr, snapshot, ts) {
  return {
    kind: 'delta',
    addr,
    op: 'importSave',
    args: [],
    result: { state: snapshot, game_values: snapshot.game_values },
    ts: ts || Date.now(),
  };
}

describe('applyDelta — importSave reducer', () => {
  it('replaces own progress with the imported snapshot', () => {
    const snapshot = buildSaveState(progressedState());
    const out = applyDelta(freshState(ADDR), importDelta(ADDR, snapshot));
    expect(out.display_name).toBe('Alice');
    expect(out.game_values.cash_value).toBe(9999);
    expect(out.node_counter).toBe(12);
  });

  it('keeps the local addr and existing peer rows', () => {
    const snapshot = buildSaveState(progressedState());
    let s = freshState(ADDR);
    // Local player has their own peer table that must survive the import.
    s = { ...s, peers: { 'carol@example.com': { cash: 1 } } };
    const out = applyDelta(s, importDelta(ADDR, snapshot));
    expect(out.addr).toBe(ADDR);
    // Existing foreign peers are preserved (the snapshot's peers never leak in;
    // the importer's own row is refreshed by the peer aggregator).
    expect(out.peers['carol@example.com']).toEqual({ cash: 1 });
    expect('bob@example.com' in out.peers).toBe(false);
  });

  it('ignores a foreign player importSave delta (no self-mutation)', () => {
    const snapshot = buildSaveState(progressedState());
    const s = freshState(ADDR);
    const out = applyDelta(s, importDelta('mallory@example.com', snapshot));
    expect(out.display_name).toBe('');
    expect(out.game_values.cash_value).toBe(s.game_values.cash_value);
  });

  it('forces schema_version to current even if the snapshot disagrees', () => {
    const snapshot = { ...buildSaveState(progressedState()), schema_version: 999 };
    const out = applyDelta(freshState(ADDR), importDelta(ADDR, snapshot));
    expect(out.schema_version).toBe(SCHEMA_VERSION);
  });

  it('survives cold-start replay (delta is the source of truth)', () => {
    const snapshot = buildSaveState(progressedState());
    const delta = importDelta(ADDR, snapshot, 1000);
    const direct = applyDelta(freshState(ADDR), delta);
    const replayed = [delta].reduce((acc, d) => applyDelta(acc, d), freshState(ADDR));
    expect(replayed.game_values.cash_value).toBe(direct.game_values.cash_value);
    expect(replayed.display_name).toBe(direct.display_name);
    expect(replayed.node_counter).toBe(direct.node_counter);
  });

  it('refreshes the importing player peer row from the snapshot game_values', () => {
    const snapshot = buildSaveState(progressedState());
    const out = applyDelta(freshState(ADDR), importDelta(ADDR, snapshot, 5000));
    expect(out.peers[ADDR].cash).toBe(9999);
    expect(out.peers[ADDR].xp).toBe(4242);
  });

  it('leaves progress untouched when the delta carries no state body', () => {
    const s = freshState(ADDR);
    const noState = { kind: 'delta', addr: ADDR, op: 'importSave', args: [], result: {}, ts: 1000 };
    const out = applyDelta(s, noState);
    expect(out.display_name).toBe('');
    expect(out.game_values.cash_value).toBe(s.game_values.cash_value);
    expect(out.node_counter).toBe(s.node_counter);
  });

  it('leaves progress untouched when state is null', () => {
    const s = freshState(ADDR);
    const nullState = {
      kind: 'delta',
      addr: ADDR,
      op: 'importSave',
      args: [],
      result: { state: null },
      ts: 1000,
    };
    const out = applyDelta(s, nullState);
    expect(out.game_values.cash_value).toBe(s.game_values.cash_value);
  });

  it('fills absent snapshot fields from freshState defaults (partial save)', () => {
    // A minimal/old save that only carries game_values must still produce a
    // structurally complete state — seeded nodes, empty collections, etc.
    const partial = { game_values: { cash_value: 7 } };
    const out = applyDelta(freshState(ADDR), importDelta(ADDR, partial));
    expect(out.game_values.cash_value).toBe(7);
    expect(Array.isArray(out.nodes)).toBe(true);
    expect(out.nodes.length).toBeGreaterThan(0); // seeded trunk-mission nodes
    expect(out.nodes_charging).toEqual([]);
    expect(out.db_queue).toEqual([]);
    expect(out.integrated_ids).toEqual({});
  });

  it('does not let a stale imported last_seen_ts rewind the monotonic clock', () => {
    // Local state is already at a far-future timestamp; importing a save whose
    // last_seen_ts is in the past must not roll the clock backwards (the guard
    // that protects progress from clock-skew).
    const future = Date.now() + 1_000_000_000;
    let s = freshState(ADDR);
    s = { ...s, last_seen_ts: future };
    const snapshot = { ...buildSaveState(progressedState()), last_seen_ts: 1 };
    const out = applyDelta(s, importDelta(ADDR, snapshot));
    expect(out.last_seen_ts).toBeGreaterThanOrEqual(future);
  });
});
