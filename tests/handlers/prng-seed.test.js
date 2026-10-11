// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Regression: the engine PRNG used a constant seed (0xdeadbeef) outside tests,
 * so the roll sequence restarted identically on every launch — the first
 * karma-incident roll after a launch was always the same, and players could
 * dodge incidents by reopening the app.  It must be seeded per launch from
 * crypto.getRandomValues.
 *
 * Each "launch" is a fresh module graph (vi.resetModules) with
 * crypto.getRandomValues pinned, so the assertions stay deterministic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXED_NOW, mkGv, mkNode, mkState } from './_fixtures.js';

const PATH = 'Imperium.City.Pusher0.token_karma';

async function firstIncidentAfterLaunch(cryptoSeed) {
  vi.resetModules();
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((a) => {
    a[0] = cryptoSeed;
    return a;
  });
  const { collectPerp } = await import('../../scripts/LocalEngine.js');
  vi.restoreAllMocks();
  const { setState } = await import('../../scripts/boot.js');
  const { clearOverride, setOverride } = await import('../../scripts/clock.js');
  const harness = await import('./_webxdc-harness.js');
  await harness.installWebxdc();
  setOverride(FIXED_NOW);
  try {
    // Same scenario as collect-integrate's seeded karma_incident tests.
    setState(
      mkState({
        nodes: [mkNode('TokenPerp', PATH)],
        nodes_collect: [{ path: PATH, result: { amount: 50 } }],
        game_values: mkGv({ karma_value: -80, xp_level: 5 }),
      })
    );
    const { result } = await collectPerp(PATH);
    return result.karma_incident;
  } finally {
    clearOverride();
    harness.uninstallWebxdc();
  }
}

describe('PRNG — seeded per launch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('takes its seed from crypto.getRandomValues at module load', async () => {
    // seed 42 fires karma014, seed 4 rolls no incident (collect-integrate.test.js).
    expect(await firstIncidentAfterLaunch(42)).toBe('karma014');
    expect(await firstIncidentAfterLaunch(4)).toBeUndefined();
  });
});
