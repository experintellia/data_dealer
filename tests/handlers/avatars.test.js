// @ts-nocheck — mirrors the strict-TS quarantine on sibling handler tests.
/**
 * Tests for webxdc avatar plumbing (PR: highscore avatars).
 *
 *   - getAvatarUrl returns the expected `__webxdc__/avatar/<addr>.jpg` shape
 *   - getRanking decorates rows with `avatar` only when the boot-time
 *     probe has flagged the messenger as supporting avatars (chatmail/
 *     core#6429 is experimental — most clients return 404)
 *
 * The probe itself talks to `fetch()` so its happy path isn't unit-tested
 * here; we exercise the support-flag gate via __setAvatarSupportForTest.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRanking } from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { freshState } from '../../scripts/state.js';
import {
  __resetAvatarsForTest,
  __setAvatarSupportForTest,
  getAvatarUrl,
} from '../../scripts/webxdc-avatars.js';
import { installWebxdc, uninstallWebxdc } from './_webxdc-harness.js';

describe('getAvatarUrl', () => {
  it('returns the virtual __webxdc__ path for a present addr', () => {
    expect(getAvatarUrl('alice@test')).toBe('__webxdc__/avatar/alice%40test.jpg');
  });

  it('URL-encodes addr characters', () => {
    expect(getAvatarUrl('a b/c')).toBe('__webxdc__/avatar/a%20b%2Fc.jpg');
  });

  it('returns null for missing or empty addr', () => {
    expect(getAvatarUrl(undefined)).toBeNull();
    expect(getAvatarUrl(null)).toBeNull();
    expect(getAvatarUrl('')).toBeNull();
  });
});

describe('getRanking — avatar decoration', () => {
  beforeEach(async () => {
    await installWebxdc();
    __resetAvatarsForTest();
  });
  afterEach(() => {
    __resetAvatarsForTest();
    uninstallWebxdc();
  });

  function seedThreePeers() {
    setState({
      ...freshState('self@test'),
      addr: 'self@test',
      peers: {
        'self@test': { display_name: 'Self', xp: 5 },
        'bob@test': { display_name: 'Bob', xp: 10 },
      },
    });
  }

  it('omits avatar when the probe has not flagged support', async () => {
    seedThreePeers();
    const { result } = await getRanking('xp');
    for (const row of result.top) {
      expect(row.avatar).toBeUndefined();
    }
  });

  it('sets avatar to __webxdc__/avatar/<addr>.jpg once support is flagged', async () => {
    __setAvatarSupportForTest(true);
    seedThreePeers();
    const { result } = await getRanking('xp');
    const byName = Object.fromEntries(result.top.map((r) => [r.display_name, r]));
    expect(byName.Bob.avatar).toBe('__webxdc__/avatar/bob%40test.jpg');
    expect(byName.Self.avatar).toBe('__webxdc__/avatar/self%40test.jpg');
  });
});
