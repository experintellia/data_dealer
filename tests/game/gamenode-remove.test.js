// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Regression guard for the GameNode.remove recursive-cleanup fix.
// Pre-fix `remove()` only orphaned children (`delete child.parentNode`)
// — leaving stale ids in `_instances` / `_ids` resolvable via
// getById/getByGestalt and pinning whole subtrees against GC.
//
// Source-text assertions match the bootstrap PR's approach: the import
// chain (GameNode.ts → Render.js → vendor globals) is brittle under
// vitest + v8 coverage in CI. The actual recursive-remove behaviour is
// exercised end-to-end by the existing handler tests once handlers
// route deltas that delete subtrees.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../../scripts/game/GameNode.ts'), 'utf8');

describe('GameNode.remove — recursive child cleanup', () => {
  it('iterates a snapshot of this.children.set and removes each child', () => {
    // Snapshot before iteration so child.remove() (which mutates the
    // parent's children set) doesn't skip siblings.
    expect(SRC).toMatch(/this\.children\.set\.slice\(\)/);
    expect(SRC).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+\w+\s*\)\s*\{\s*\w+\.remove\(\)/);
  });

  it('does not retain the legacy "delete child.parentNode" no-op cleanup', () => {
    // Pre-fix loop body. If this reappears, the recursive fix has been
    // reverted.
    expect(SRC).not.toMatch(/delete\s+\w+\.parentNode\s*;?\s*\}/);
  });
});
