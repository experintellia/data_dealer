// Render-side instance registry — the `_instances` array (indexed
// by `_id`) and the `_ids` map (indexed by `id`) that every
// RenderNode subclass auto-registers itself into in
// RenderNode.init.  Lifted out of Render.js's IIFE in PR 40 of
// issue #147.
//
// Retires the `setRenderNodeRegistry()` seam from PR #216 —
// RenderNode imports these helpers directly now.

import type { RenderNode } from './RenderNode.js';

/** Public underlying array.  Held as a mutable export so the
 *  Render publisher's `_instances:` entry can read it directly,
 *  and so callers that walk the live registry (none currently)
 *  see in-flight changes without a getter call. */
export const _instances: Array<RenderNode | undefined> = [];

/** Public id → node lookup.  Same accessibility note as
 *  `_instances`. */
export const _ids: Record<string, RenderNode> = {};

/** Number of slots in `_instances` — used by RenderNode.init to
 *  allocate a fresh `_id` for a new instance. */
export function nodeCount(): number {
  return _instances.length;
}

/** Register a node in `_instances` (by `_id`) and `_ids` (by `id`). */
export function registerNode(node: RenderNode): void {
  _instances[node._id] = node;
  _ids[node.id] = node;
}

/** Drop the node from both registries by its `_id`.  Mirrors the
 *  legacy slot-undefined pattern (rather than `splice`) so existing
 *  `_id` slots stay stable for any in-flight reference. */
export function unregisterNode(id: number): void {
  const existing = _instances[id];
  if (existing) {
    delete _ids[existing.id];
  }
  _instances[id] = undefined;
}

/** Look up a node by its registry slot index. */
export function getNode(id: number): RenderNode | undefined {
  return _instances[id];
}

/** Look up a node by its string id (e.g. `"Node42"`, `"Sprite7"`). */
export function getNodeById(id: string): RenderNode | undefined {
  return _ids[id];
}

/** Clear everything that has been rendered so far — calls
 *  `node.remove()` on each live node and truncates the
 *  `_instances` array.  Used by Game.lock / reset paths. */
export function clearAllNodes(): void {
  for (let n = 0; n < _instances.length; n++) {
    const node = _instances[n];
    if (node) {
      node.remove();
    }
  }
  _instances.length = 0;
}
