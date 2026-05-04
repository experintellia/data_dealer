// Ordered insertion-set used by GameRoot's child collections, the legacy
// AniTicker / APTicker listener queues, and the Database / Topscores /
// Missions queue trackers.  Predates ES `Set` and exposes a slightly
// different surface (insertion-ordered, public `set` array, mirrored
// `length` field, single `each` walker).
//
// Extracted from scripts/Game.js's IIFE in the issue #147 / Phase 7
// migration.  Game.js re-exports this as `Set` to keep the in-IIFE call
// sites unchanged while the rest of Game.js is still under `@ts-nocheck`.
//
// Behaviour preserved from the legacy class:
//   - `set` and `length` are public.  AniTicker.listeners.set is reassigned
//     via `_.shuffle(...)` at scripts/Game.js:329,348 — i.e. callers may
//     swap the underlying array out from under us.  Length tracking is
//     therefore a snapshot at the last add/prepend/remove/each call, not
//     a live mirror of `set.length`.
//   - `each(undefined)` is a no-op (legacy guard); `each` does not return
//     the result of the callback and skips nothing.

export class OrderedSet<T> {
  /**
   * Public underlying array.  Some legacy call sites mutate it directly
   * (e.g. `_.shuffle(this.set)`); see the class docstring.
   */
  set: T[];

  /**
   * Snapshot of `set.length` at the last add/prepend/remove/each call.
   * Public for compatibility with legacy reads (`children.length`).
   */
  length: number;

  constructor(initial?: T[]) {
    this.set = initial ?? [];
    this.length = this.set.length;
  }

  add(node: T): void {
    this.set.push(node);
    this.length = this.set.length;
  }

  prepend(node: T): void {
    this.set.unshift(node);
    this.length = this.set.length;
  }

  remove(node: T): void {
    const index = this.set.indexOf(node);
    if (index !== -1) {
      this.set.splice(index, 1);
    }
    this.length = this.set.length;
  }

  each(func: (node: T) => void): void {
    if (!func) return;
    for (const node of this.set) {
      func(node);
    }
    this.length = this.set.length;
  }
}
