// Avatar support via the experimental webxdc API proposed in
// chatmail/core#6429 + deltachat-desktop#4481.
//
// The API exposes two pieces:
//   - `webxdc.getMemberList()` returns `[user_id, display_name][]`
//   - Avatars are served at `__webxdc__/avatar/<user_id>.jpg` (404 if none)
//
// `user_id` is derived from a contact's public-key fingerprint, so it is
// stable across messages but is NOT the same as `webxdc.selfAddr` (which
// is the email address). To map peers to avatars we therefore need to
// learn each peer's user_id — currently done by attaching it to every
// delta we send. Self's user_id is resolved at boot time by matching
// `webxdc.selfName` against the member list.
//
// Both pieces of the API are experimental and currently unavailable in
// any released client. All entry points here degrade silently when the
// API is missing.

type MemberListEntry = [string, string];

interface MemberListWebxdc {
  getMemberList?: () => MemberListEntry[] | Promise<MemberListEntry[]>;
  selfName?: string;
}

const AVATAR_DIR = '__webxdc__/avatar/';

let _selfUserId: string | undefined;
let _memberListCache: MemberListEntry[] | undefined;
let _resolveAttempted = false;

function _webxdc(): MemberListWebxdc | undefined {
  return typeof webxdc !== 'undefined' && webxdc ? (webxdc as MemberListWebxdc) : undefined;
}

// Best-effort synchronous fetch of the member list. The experimental API
// might be async (Promise<...>); we only use the cached value if the call
// returned synchronously. resolveSelfUserId() handles the Promise case.
function _readMemberListSync(): MemberListEntry[] | undefined {
  if (_memberListCache) return _memberListCache;
  const w = _webxdc();
  if (!w || typeof w.getMemberList !== 'function') return undefined;
  try {
    const result = w.getMemberList();
    if (Array.isArray(result)) {
      _memberListCache = result;
      return result;
    }
  } catch (_) {
    /* API missing or threw — fall through */
  }
  return undefined;
}

/**
 * Resolve self's user_id once the messenger has a member list available.
 * Safe to call multiple times: caches the first non-empty result and is
 * a no-op afterwards. Matches by `webxdc.selfName`; collisions on
 * display-name fall to the first hit (best-effort — there is no public
 * `selfUserId` in the proposed API).
 *
 * Returns the resolved id or undefined if the API/member entry is missing.
 */
export async function resolveSelfUserId(): Promise<string | undefined> {
  if (_selfUserId) return _selfUserId;
  const w = _webxdc();
  if (!w || typeof w.getMemberList !== 'function') {
    _resolveAttempted = true;
    return undefined;
  }
  let list: MemberListEntry[] | undefined;
  try {
    const result = w.getMemberList();
    list = await Promise.resolve(result);
  } catch (_) {
    _resolveAttempted = true;
    return undefined;
  }
  if (!Array.isArray(list)) {
    _resolveAttempted = true;
    return undefined;
  }
  _memberListCache = list;
  _resolveAttempted = true;
  const selfName = w.selfName;
  if (typeof selfName !== 'string' || selfName.length === 0) return undefined;
  for (const entry of list) {
    if (Array.isArray(entry) && entry[1] === selfName) {
      _selfUserId = entry[0];
      return _selfUserId;
    }
  }
  return undefined;
}

/**
 * Synchronous accessor for self's user_id. Returns the cached value if
 * resolveSelfUserId() has already run, or attempts a synchronous resolve
 * if the proposed API returns a plain array. Returns undefined when the
 * API isn't available or self isn't in the member list.
 */
export function getSelfUserId(): string | undefined {
  if (_selfUserId) return _selfUserId;
  const list = _readMemberListSync();
  if (!list) return undefined;
  const w = _webxdc();
  const selfName = w?.selfName;
  if (typeof selfName !== 'string' || selfName.length === 0) return undefined;
  for (const entry of list) {
    if (Array.isArray(entry) && entry[1] === selfName) {
      _selfUserId = entry[0];
      return _selfUserId;
    }
  }
  return undefined;
}

/** Returns the avatar URL for a user_id, or null when the id is missing. */
export function getAvatarUrl(userId: string | undefined | null): string | null {
  if (typeof userId !== 'string' || userId.length === 0) return null;
  return AVATAR_DIR + encodeURIComponent(userId) + '.jpg';
}

/** Test-only: reset the cached self user_id and member list. */
export function __resetAvatarsForTest(): void {
  _selfUserId = undefined;
  _memberListCache = undefined;
  _resolveAttempted = false;
}

/** Test-only: seed a fixed self user_id (bypasses the member-list lookup). */
export function __setSelfUserIdForTest(id: string | undefined): void {
  _selfUserId = id;
  _resolveAttempted = true;
}
