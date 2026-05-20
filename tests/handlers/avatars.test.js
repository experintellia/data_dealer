// @ts-nocheck — mirrors the strict-TS quarantine on sibling handler tests.
/**
 * Tests for webxdc avatar plumbing (PR: highscore avatars).
 *
 *   - delta.user_id is recorded on state.peers[addr].user_id
 *   - getRanking returns user_id on rows when known
 *   - getAvatarUrl returns the expected `__webxdc__/avatar/<id>.jpg` shape
 *   - _mkDelta attaches self user_id when getMemberList() exposes it
 *
 * The avatar API itself is experimental (chatmail/core#6429); these tests
 * exercise the wiring on our side and assume the API can be feature-detected.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRanking } from '../../scripts/LocalEngine.js';
import { setDisplayName } from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { applyDelta, freshState } from '../../scripts/state.js';
import {
  __resetAvatarsForTest,
  __setSelfUserIdForTest,
  getAvatarUrl,
} from '../../scripts/webxdc-avatars.js';
import { installWebxdc, sentDeltas, uninstallWebxdc } from './_webxdc-harness.js';

describe('getAvatarUrl', () => {
  it('returns the virtual __webxdc__ path for a present user_id', () => {
    expect(getAvatarUrl('abc123')).toBe('__webxdc__/avatar/abc123.jpg');
  });

  it('URL-encodes user_id characters', () => {
    expect(getAvatarUrl('a b/c')).toBe('__webxdc__/avatar/a%20b%2Fc.jpg');
  });

  it('returns null for missing or empty user_id', () => {
    expect(getAvatarUrl(undefined)).toBeNull();
    expect(getAvatarUrl(null)).toBeNull();
    expect(getAvatarUrl('')).toBeNull();
  });
});

describe('peer aggregator records delta.user_id', () => {
  it('copies delta.user_id onto state.peers[addr].user_id', () => {
    const s = applyDelta(freshState('self@test'), {
      kind: 'delta',
      addr: 'bob@test',
      op: 'buyKarma',
      args: [],
      result: { game_values: { xp_value: 10, xp_level: 1 } },
      ts: 1000,
      user_id: 'bob-uid',
    });
    expect(s.peers['bob@test'].user_id).toBe('bob-uid');
  });

  it('ignores empty/missing user_id rather than overwriting prior value', () => {
    let s = applyDelta(freshState('self@test'), {
      kind: 'delta',
      addr: 'bob@test',
      op: 'buyKarma',
      args: [],
      result: { game_values: { xp_value: 1, xp_level: 1 } },
      ts: 1000,
      user_id: 'bob-uid',
    });
    s = applyDelta(s, {
      kind: 'delta',
      addr: 'bob@test',
      op: 'buyKarma',
      args: [],
      result: { game_values: { xp_value: 2, xp_level: 1 } },
      ts: 2000,
    });
    expect(s.peers['bob@test'].user_id).toBe('bob-uid');
  });
});

describe('getRanking surfaces user_id', () => {
  beforeEach(async () => {
    await installWebxdc();
  });
  afterEach(() => uninstallWebxdc());

  it('includes user_id on peer rows when present in state', async () => {
    setState({
      ...freshState('self@test'),
      addr: 'self@test',
      peers: {
        'self@test': { display_name: 'Self', xp: 5, user_id: 'self-uid' },
        'bob@test': { display_name: 'Bob', xp: 10, user_id: 'bob-uid' },
        'carol@test': { display_name: 'Carol', xp: 7 },
      },
    });
    const { result } = await getRanking('xp');
    const byName = Object.fromEntries(result.top.map((r) => [r.display_name, r]));
    expect(byName.Bob.user_id).toBe('bob-uid');
    expect(byName.Self.user_id).toBe('self-uid');
    expect(byName.Carol.user_id).toBeUndefined();
  });

  it('falls back to messenger member list for the self row', async () => {
    __setSelfUserIdForTest('self-from-memberlist');
    setState({
      ...freshState('self@test'),
      addr: 'self@test',
      peers: {
        'self@test': { display_name: 'Self', xp: 1 },
      },
    });
    const { result } = await getRanking('xp');
    expect(result.top[0].user_id).toBe('self-from-memberlist');
  });
});

describe('_mkDelta attaches self user_id from the member list', () => {
  beforeEach(async () => {
    // installWebxdc sets up a fake without getMemberList; we patch it
    // here to expose self under the harness's `selfName` ("Test").
    await installWebxdc();
    globalThis.webxdc.getMemberList = () => [['self-uid', 'Test']];
    __resetAvatarsForTest();
  });
  afterEach(() => uninstallWebxdc());

  it('stamps user_id onto outbound deltas', () => {
    setDisplayName('Alice');
    const deltas = sentDeltas();
    const setName = deltas.find((d) => d.op === 'setDisplayName');
    expect(setName).toBeTruthy();
    expect(setName.user_id).toBe('self-uid');
  });
});
