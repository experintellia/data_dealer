// Look at the host messenger's selfName and report whether it differs from the
// stored display_name. Display name is owned by the messenger — the game has
// no UI to rename — so this runs once per boot and only fires the dispatch
// path on a real messenger-side rename (or first boot).
//
// Returns the new selfName when it differs from the stored name, or null when
// they already match (or no user). Does NOT mutate the passed-in user object;
// callers must route the new name through the proper delta dispatch (e.g.
// setDisplayName) so the change flows through state and observers cleanly.
//
// File converted from webxdc-identity.js to webxdc-identity.ts in PR 26 of
// issue #147; `@ts-nocheck` quarantine dropped.

interface UserLike {
  display_name?: string;
}

export function getMessengerDisplayNameChange(user?: UserLike | null): string | null {
  if (!user) return null;
  const selfName = globalThis.webxdc?.selfName;
  if (user.display_name === selfName) return null;
  return selfName ?? null;
}

// Default export is the namespace object consumed by AMD callers via the bridge.
export default { getMessengerDisplayNameChange };
