// Tests for computeBuyPerpSpawnPos — pure helper that picks a spawn
// position for a newly bought perp ("venture") relative to its parent
// ("company") node.
//
// Pre-existing bug (issue: venture spawns far from Bogus Company):
//   In scripts/game/GamePerp.ts the spawn-position calc only worked
//   when the parent had a grandparent.  Top-level companies like the
//   Bogus Company (proxy001) sit directly under Imperium, so no
//   grandparent vector existed — the helper fell back to a hard-coded
//   canvas-center (1024, 800) inside RenderPerp.setRandomPosition.
//   Additionally, `placeParentRadius` was force-overwritten to 0 right
//   after being set to 320, disabling the engine's "stay near parent"
//   clamp during collision-avoidance jitter.

import { describe, expect, it } from 'vitest';
import { computeBuyPerpSpawnPos } from '../../scripts/game/spawnPosition.ts';

const PHI = 0.61803398875;

describe('computeBuyPerpSpawnPos', () => {
  it('returns the explicit position when one is provided (mission/tutorial wins)', () => {
    const result = computeBuyPerpSpawnPos({
      explicitPos: { x: 123, y: 456 },
      parentPos: { x: 500, y: 500 },
      grandparentPos: { x: 300, y: 300 },
    });
    expect(result.pos).toEqual({ x: 123, y: 456 });
  });

  it('extends the grandparent→parent vector by the golden ratio when a grandparent exists', () => {
    // Preserve the legacy math: companyPos + φ * (companyPos - grandparentPos)
    const result = computeBuyPerpSpawnPos({
      parentPos: { x: 500, y: 500 },
      grandparentPos: { x: 300, y: 300 },
    });
    expect(result.pos.x).toBeCloseTo(500 + PHI * 200);
    expect(result.pos.y).toBeCloseTo(500 + PHI * 200);
  });

  it('falls back to a position near the parent when no grandparent exists (top-level company like Bogus Co.)', () => {
    // This is the bug: previously placePos stayed undefined, and the
    // render layer used the hard-coded canvas centre (1024, 800).
    const parentPos = { x: 500, y: 500 };
    const result = computeBuyPerpSpawnPos({ parentPos });

    // Must NOT be the legacy hard-coded canvas centre.
    expect(result.pos).not.toEqual({ x: 1024, y: 800 });

    // Must land inside the parent-radius clamp around the company.
    const dx = result.pos.x - parentPos.x;
    const dy = result.pos.y - parentPos.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    expect(distance).toBeLessThanOrEqual(result.parentRadius);
    expect(distance).toBeGreaterThan(0);
  });

  it('returns a non-zero parentRadius so the engine clamps collision-jitter near the parent', () => {
    // Regression guard for the stray `placeParentRadius = 0` overwrite
    // that disabled RenderPerp.setRandomPosition's circular clamp.
    const result = computeBuyPerpSpawnPos({
      parentPos: { x: 500, y: 500 },
      grandparentPos: { x: 300, y: 300 },
    });
    expect(result.parentRadius).toBeGreaterThan(0);

    const fallback = computeBuyPerpSpawnPos({ parentPos: { x: 500, y: 500 } });
    expect(fallback.parentRadius).toBeGreaterThan(0);
  });

  it('is deterministic given identical inputs (no Math.random in the helper)', () => {
    const args = { parentPos: { x: 500, y: 500 } };
    const a = computeBuyPerpSpawnPos(args);
    const b = computeBuyPerpSpawnPos(args);
    expect(a).toEqual(b);
  });
});
