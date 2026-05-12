// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// GameNode.remove must recursively unregister descendant GameNodes from
// the module-level `_instances` / `_ids` registries. Pre-fix the
// implementation only orphaned children by deleting their parentNode
// pointer (line 342-344) — leaving stale entries pinned in the
// registries, where they continued to surface through getById/get/
// getByGestalt and prevented GC of the entire subtree.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeJq } from './_jq.js';

installFakeJq();

// GameNode.ts → Render.js → app.ts → Game.js → game/Database.ts → game/ProfileSet.ts
// is a circular import chain (ProfileSet.ts extends GameNode but the class
// is not yet bound when the chain re-enters GameNode.ts mid-load).  Stub
// out Render so the chain terminates here.
vi.mock('../../scripts/Render.js', () => ({
  getRender: () => ({}),
}));

const gnMod = await import('../../scripts/game/GameNode.ts');
const { GameNode, _instances, _ids, getById, clear } = gnMod;

describe('GameNode.remove — child cleanup', () => {
  beforeEach(() => {
    // Clear the instance registry between tests so _id counters reset.
    clear();
    _instances.length = 0;
    for (const k of Object.keys(_ids)) delete _ids[k];
  });

  it('recursively unregisters child and grandchild GameNodes from _instances/_ids', () => {
    const root = new GameNode({ id: 'root' });
    const child = new GameNode({ id: 'child' });
    const grand = new GameNode({ id: 'grand' });
    root.children.add(child);
    child.parentNode = root;
    child.children.add(grand);
    grand.parentNode = child;

    // Pre-condition: all three resolvable.
    expect(getById('root')).toBe(root);
    expect(getById('child')).toBe(child);
    expect(getById('grand')).toBe(grand);

    root.remove();

    expect(getById('root')).toBeUndefined();
    expect(getById('child')).toBeUndefined();
    expect(getById('grand')).toBeUndefined();
  });

  it('does not leave dangling entries in _instances for removed children', () => {
    const root = new GameNode({ id: 'root2' });
    const c1 = new GameNode({ id: 'c1' });
    const c2 = new GameNode({ id: 'c2' });
    root.children.add(c1);
    c1.parentNode = root;
    root.children.add(c2);
    c2.parentNode = root;

    const c1Id = c1._id;
    const c2Id = c2._id;

    root.remove();

    expect(_instances[c1Id]).toBeUndefined();
    expect(_instances[c2Id]).toBeUndefined();
  });
});
