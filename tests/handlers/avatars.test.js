// @ts-nocheck — mirrors the strict-TS quarantine on sibling handler tests.
/**
 * Tests for webxdc avatar plumbing (PR: highscore avatars).
 *
 *   - getAvatarUrl returns the expected `__webxdc__/avatar/<addr>.jpg` shape
 *   - getRanking decorates every peer row with an `avatar` URL; the
 *     template emits the <img> and the .TopscoreList container only
 *     reveals the slot once one of the images fires onload, so feature
 *     detection is per-leaderboard and runs entirely in the DOM.
 *
 * The image-load gate itself is DOM-only (onload="..." inline handler in
 * views/topscore_list.html) and not unit-tested here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getRanking } from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { freshState } from '../../scripts/state.js';
import { getAvatarUrl } from '../../scripts/webxdc-avatars.js';
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

describe('getRanking — avatar URLs', () => {
  beforeEach(async () => {
    await installWebxdc();
  });
  afterEach(() => uninstallWebxdc());

  it('decorates every peer row with __webxdc__/avatar/<addr>.jpg', async () => {
    setState({
      ...freshState('self@test'),
      addr: 'self@test',
      peers: {
        'self@test': { display_name: 'Self', xp: 5 },
        'bob@test': { display_name: 'Bob', xp: 10 },
      },
    });
    const { result } = await getRanking('xp');
    const byName = Object.fromEntries(result.top.map((r) => [r.display_name, r]));
    expect(byName.Bob.avatar).toBe('__webxdc__/avatar/bob%40test.jpg');
    expect(byName.Self.avatar).toBe('__webxdc__/avatar/self%40test.jpg');
  });
});
