// Generic helpers shared across the legacy Game/Render layers.
// jQuery is loaded as a global from a vendor `<script>` tag in
// index.html; read lazily off globalThis inside wait() so this
// module's top-level evaluation does not depend on $ existing yet.

import type { JQueryStatic } from '../types/env.d.ts';

/** Legacy prototype-chain extension helper.  `class C extends P {}`
 *  is the modern equivalent — kept here for the Render.js classes
 *  that still use the function-constructor + extend pattern. */
export function extend(C: { prototype: object; P?: object }, P: { prototype: object }): void {
  const F = function (this: unknown) {} as unknown as { prototype: object; new (): object };
  F.prototype = P.prototype;
  C.prototype = new F();
  (C.prototype as { constructor: unknown }).constructor = C;
  C.P = P.prototype;
}

interface DeferredLike {
  resolve(): void;
  promise(): unknown;
}

interface JQueryStaticWithDeferred extends JQueryStatic {
  Deferred: new () => DeferredLike;
}

/** Returns a jQuery Deferred promise that resolves after `delay` ms.
 *  Used by Render.js animation choreography. */
export function wait(delay: number): unknown {
  console.warn('Asynchronously waiting for %s milliseconds.', delay);
  const $ = (globalThis.jQuery || globalThis.$) as JQueryStaticWithDeferred | undefined;
  if (!$) throw new Error('util.wait: jQuery global not found');
  const deferred = new $.Deferred();
  setTimeout(() => deferred.resolve(), delay);
  return deferred.promise();
}

export default { extend, wait };
