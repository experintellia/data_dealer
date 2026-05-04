// Pure data-merge helper extracted from scripts/Game.js's IIFE in the
// issue #147 / Phase 7 migration.  Used by GameNode.addType (now in
// ./GameNode.ts) and by ~30 other call sites inside Game.js for Project-
// like nodes that carry both type-level powerups/tokens and instance-
// level overrides.
//
// Behaviour preserved from the legacy helper (Game.js:155-183):
//   1. Shallow-merge type_data and instance_data; instance_data wins.
//   2. If both sides carry powerups+tokens, deep-clone the type-side
//      tokens and overwrite their `amount` from the instance side
//      (matched by gestalt).  Keeps the type-data tokens untouched.

interface TokenLike {
  gestalt?: string;
  amount?: number;
  [key: string]: unknown;
}

interface MergeableData {
  powerups?: unknown;
  tokens?: TokenLike[];
  [key: string]: unknown;
}

export function mergeData(
  type_data: MergeableData | undefined,
  instance_data: MergeableData | undefined
): MergeableData {
  const data: MergeableData = {};
  Object.assign(data, type_data || {});
  Object.assign(data, instance_data || {});

  // If the type data is Project-like (has powerups and tokens) merge token amounts.
  if (
    instance_data &&
    type_data &&
    Object.prototype.hasOwnProperty.call(instance_data, 'powerups') &&
    Object.prototype.hasOwnProperty.call(type_data, 'tokens') &&
    Object.prototype.hasOwnProperty.call(instance_data, 'tokens')
  ) {
    // Deep clone the type-side tokens so we don't mutate type_data.
    const tokens: TokenLike[] = (type_data.tokens || []).map((t) => ({ ...t }));
    const instokens = instance_data.tokens || [];
    tokens.forEach((t) => {
      const overwrite = instokens.find((it) => it.gestalt === t.gestalt);
      if (overwrite && overwrite.amount) {
        t.amount = overwrite.amount;
      }
    });
    data.tokens = tokens;
  }
  return data;
}
