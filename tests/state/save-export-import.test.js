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
});
