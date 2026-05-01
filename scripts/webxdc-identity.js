// Sync user.display_name with the webxdc messenger identity on every boot.
// Returns true when the name was changed (first boot or messenger name updated),
// false when it already matched.

export function applyWebxdcIdentity(user) {
  if (!user) { return false; }
  var selfName = globalThis.webxdc.selfName;
  if (user.display_name === selfName) { return false; }
  user.display_name = selfName;
  return true;
}

// Default export is the namespace object consumed by AMD callers via the bridge.
export default { applyWebxdcIdentity };
