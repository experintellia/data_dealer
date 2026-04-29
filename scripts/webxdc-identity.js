// Seed user.display_name from the webxdc messenger identity on first boot.
// Returns true when the name was seeded, false when an existing value was preserved.
// Wave 3 #13 implements the setDisplayName persistence handler; Game.js calls
// that RPC after applyWebxdcIdentity returns true so the two compose cleanly.

export function applyWebxdcIdentity(user) {
  if (!user || user.display_name) { return false; }
  user.display_name = globalThis.webxdc.selfName;
  return true;
}

// Default export is the namespace object consumed by AMD callers via the bridge.
export default { applyWebxdcIdentity };
