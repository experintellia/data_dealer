// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Every chat member's webxdc.sendUpdate payload reaches every player
// unauthenticated and is replayed on each cold start, so update payloads (and
// imported save files) are untrusted input.  An addr-less delta must not touch
// anyone's own state, and no payload may break applyDelta's return type or
// wedge replay / loadGame.  (A forged `addr: <victim>` still reaches the
// victim's reducers: webxdc has no sender authentication.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGame } from '../../scripts/LocalEngine.js';
import { __resetBootForTest, boot, getState } from '../../scripts/boot.js';
import {
  SAVE_FORMAT,
  SAVE_VERSION,
  applyDelta,
  freshState,
  parseSaveFile,
} from '../../scripts/state.js';
import { installWebxdc, uninstallWebxdc } from '../handlers/_webxdc-harness.js';

const ADDR = 'alice@example.com';

describe('applyDelta — addr-less deltas', () => {
  it('a delta without addr (or with an empty one) never runs a reducer on own state', () => {
    const s = freshState(ADDR);
    const wipe = { kind: 'delta', op: 'importSave', result: { state: { game_values: {} } } };
    for (const d of [wipe, { ...wipe, addr: '' }]) {
      const out = applyDelta(s, d);
      expect(out.game_values).toEqual(s.game_values);
      expect(out.peers).toEqual({});
    }
  });
});

describe('applyDelta — Object.prototype op names', () => {
  it.each(['toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'op %s leaves a usable state object',
    (op) => {
      const s = freshState(ADDR);
      const out = applyDelta(s, { kind: 'delta', addr: ADDR, op, args: [], result: {}, ts: 1 });
      expect(typeof out).toBe('object');
      expect(out.addr).toBe(ADDR);
      expect(out.nodes).toBe(s.nodes);
    }
  );
});

describe('applyDelta — peer aggregator', () => {
  it('an addr of "__proto__" cannot replace the peers prototype', () => {
    const d = {
      kind: 'delta',
      addr: '__proto__',
      op: 'ping',
      result: { game_values: { cash_value: 1 } },
      ts: 1,
    };
    const out = applyDelta(freshState(ADDR), d);
    expect(Object.getPrototypeOf(out.peers)).toBe(Object.prototype);
    expect(out.peers.cash).toBeUndefined();
  });

  it('a non-string addr that coerces to "__proto__" is ignored too', () => {
    const d = { kind: 'delta', addr: ['__proto__'], op: 'ping', result: {}, ts: 1 };
    const out = applyDelta(freshState(ADDR), d);
    expect(Object.getPrototypeOf(out.peers)).toBe(Object.prototype);
    expect(out.peers).toEqual({});
  });
});

// Own-addr deltas whose reducer would store a shape loadGame / the materializer
// can't iterate.  None of these throw inside applyDelta, so the boot listener's
// try/catch alone would not catch them.
const POISONED = {
  'recheckMissions mission_goals': {
    op: 'recheckMissions',
    result: { missions: { mission_data: { mission_goals: 1 } } },
  },
  'recheckMissions active_missions': {
    op: 'recheckMissions',
    result: { missions: { mission_data: { active_missions: 1 } } },
  },
  'buyPerp game_values': {
    op: 'buyPerp',
    result: { node: { full_path: 'Imperium.x', instance_data: {} }, game_values: 1 },
  },
  'collectPerp db_entry': { op: 'collectPerp', args: ['p'], result: { db_entry: 1 } },
  'importSave nodes element': {
    op: 'importSave',
    result: { state: { game_values: {}, nodes: [null] } },
  },
};

describe('applyDelta — a reducer result with a broken shape is dropped', () => {
  it.each(Object.keys(POISONED))('%s', (name) => {
    const s = freshState(ADDR);
    const out = applyDelta(s, { kind: 'delta', addr: ADDR, args: [], ts: 1, ...POISONED[name] });
    for (const k of ['nodes', 'db_queue', 'mission_goals', 'active_missions', 'game_values']) {
      expect(out[k]).toEqual(s[k]);
    }
  });
});

describe('boot listener — poisoned updates', () => {
  beforeEach(async () => {
    await installWebxdc();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    uninstallWebxdc();
  });

  it('live delivery and cold-start replay both continue past it', async () => {
    const self = getState().addr;
    // integrateCollected's reducer calls r.nodes.forEach — a string throws.
    globalThis.webxdc.sendUpdate(
      {
        payload: {
          kind: 'delta',
          addr: self,
          op: 'integrateCollected',
          args: ['c1'],
          result: { nodes: 'x' },
          ts: 1,
        },
      },
      ''
    );
    globalThis.webxdc.sendUpdate(
      { payload: { kind: 'delta', addr: self, op: 'markTokenSeen', args: ['token008'], ts: 2 } },
      ''
    );
    expect(getState().tokens_seen).toEqual({ token008: true });
    expect(console.error).toHaveBeenCalled();

    // Cold start: replay the same history from serial 0.
    __resetBootForTest();
    await boot({ selfAddr: self });
    expect(getState().tokens_seen).toEqual({ token008: true });
  });

  it.each(Object.keys(POISONED))('loadGame still succeeds after a replayed %s', async (name) => {
    const self = getState().addr;
    globalThis.webxdc.sendUpdate(
      { payload: { kind: 'delta', addr: self, args: [], ts: 1, ...POISONED[name] } },
      ''
    );
    __resetBootForTest();
    await boot({ selfAddr: self });
    await expect(loadGame()).resolves.toHaveProperty('result');
  });
});

describe('save import — non-array collections are rejected', () => {
  const FIELDS = [
    'nodes',
    'nodes_charging',
    'nodes_collect',
    'db_queue',
    'mission_goals',
    'active_missions',
  ];

  it.each(FIELDS)('parseSaveFile rejects %s that is not an array', (field) => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION,
      state: { game_values: {}, [field]: 'x' },
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it.each(FIELDS.slice(0, -1))('parseSaveFile rejects a null element in %s', (field) => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION,
      state: { game_values: {}, [field]: [null] },
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it('parseSaveFile rejects null game_values', () => {
    const bad = JSON.stringify({
      format: SAVE_FORMAT,
      save_version: SAVE_VERSION,
      state: { game_values: null },
    });
    expect(parseSaveFile(bad)).toEqual({ ok: false, error: 'malformed' });
  });

  it.each(FIELDS)('importSave reducer ignores a snapshot whose %s is not an array', (field) => {
    const s = freshState(ADDR);
    const d = {
      kind: 'delta',
      addr: ADDR,
      op: 'importSave',
      args: [],
      result: { state: { game_values: { cash_value: 7 }, [field]: 'x' } },
      ts: 1,
    };
    const out = applyDelta(s, d);
    expect(Array.isArray(out[field])).toBe(true);
    expect(out.game_values.cash_value).toBe(s.game_values.cash_value);
  });
});
