// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Tiny shared installer that stamps a no-op jQuery shim onto the global
// scope.  GameNode._$ resolves `jQuery ?? globalThis.$` at instance
// construction; the unit tests that exercise GameNode-derived classes
// don't need a real DOM, so this returns a handler object with the
// methods the constructor / initEventHandlers touch.
//
// Lives in tests/game/ rather than tests/handlers/_fixtures.js because
// every consumer is in tests/game/ and the handler suites have no jQuery
// dependency.

const fakeJqFactory = function (_node) {
  return {
    on: function () {},
    trigger: function () {},
    off: function () {},
  };
};

export function installFakeJq() {
  // Bracket-indexed write so neither tsc nor biome flag the assignment
  // (tsc would otherwise widen the global $ type from the inferred shape
  // of fakeJqFactory; biome's useLiteralKeys complains on direct
  // `globalThis['$']`).  Going through `Reflect.set` sidesteps both.
  Reflect.set(globalThis, '$', fakeJqFactory);
  Reflect.set(globalThis, 'jQuery', fakeJqFactory);
}
