// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Look at the host messenger's selfName and report whether it differs from the
// stored display_name. Display name is owned by the messenger — the game has
// no UI to rename — so this runs once per boot and only fires the dispatch
// path on a real messenger-side rename (or first boot).
//
// Returns the new selfName when it differs from the stored name, or null when
// they already match (or no user). Does NOT mutate the passed-in user object;
// callers must route the new name through the proper delta dispatch (e.g.
// setDisplayName) so the change flows through state and observers cleanly.

export function getMessengerDisplayNameChange(user) {
  if (!user) {
    return null;
  }
  var selfName = globalThis.webxdc.selfName;
  if (user.display_name === selfName) {
    return null;
  }
  return selfName;
}

// Default export is the namespace object consumed by AMD callers via the bridge.
export default { getMessengerDisplayNameChange };
