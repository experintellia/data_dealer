// Compare user.display_name with the webxdc messenger identity on every boot.
// Returns the new selfName string when it differs (first boot or messenger
// name updated), or null when the stored name already matches. Does NOT
// mutate the passed-in user object — callers must route the new name
// through the proper delta dispatch (e.g. setDisplayName) so the change
// flows through state and observers cleanly.

export function applyWebxdcIdentity(user) {
  if (!user) { return null; }
  var selfName = globalThis.webxdc.selfName;
  if (user.display_name === selfName) { return null; }
  return selfName;
}

// Default export is the namespace object consumed by AMD callers via the bridge.
export default { applyWebxdcIdentity };
