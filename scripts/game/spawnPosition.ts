export interface Vec2 {
  x: number;
  y: number;
}

export interface ComputeBuyPerpSpawnPosArgs {
  explicitPos?: Vec2 | null | undefined;
  parentPos: Vec2;
  grandparentPos?: Vec2 | null | undefined;
}

export interface BuyPerpSpawnPos {
  pos: Vec2;
  parentRadius: number;
}

const GOLDEN_RATIO = 0.61803398875;
const PARENT_RADIUS = 320;
// Mirrors DatabasePerp's offset style; keeps the venture inside
// PARENT_RADIUS so the engine's circular clamp never moves it.
const FALLBACK_OFFSET: Vec2 = { x: -250, y: 50 };

export function computeBuyPerpSpawnPos(args: ComputeBuyPerpSpawnPosArgs): BuyPerpSpawnPos {
  const { explicitPos, parentPos, grandparentPos } = args;

  if (explicitPos) {
    return { pos: { x: explicitPos.x, y: explicitPos.y }, parentRadius: PARENT_RADIUS };
  }

  if (grandparentPos) {
    const vx = parentPos.x - grandparentPos.x;
    const vy = parentPos.y - grandparentPos.y;
    return {
      pos: {
        x: parentPos.x + vx * GOLDEN_RATIO,
        y: parentPos.y + vy * GOLDEN_RATIO,
      },
      parentRadius: PARENT_RADIUS,
    };
  }

  return {
    pos: {
      x: parentPos.x + FALLBACK_OFFSET.x,
      y: parentPos.y + FALLBACK_OFFSET.y,
    },
    parentRadius: PARENT_RADIUS,
  };
}
