// Avatar URLs for the experimental webxdc avatar API proposed in
// chatmail/core#6429 + deltachat-desktop#4481.
//
// Avatars live in a virtual directory served by the messenger:
//   __webxdc__/avatar/<addr>.jpg   (404 when the contact has no picture)
//
// Per the PR, the user_id is "basically the (self)addr" — so we use
// `webxdc.selfAddr` for self and `delta.addr` for peers without any
// extra plumbing. The API is experimental and absent in most clients;
// we probe support once at boot by fetching our own avatar, and the
// leaderboard skips the <img> slot entirely when the probe fails so the
// row layout never shifts on a delayed 404.

const AVATAR_DIR = '__webxdc__/avatar/';

type SupportState = 'unknown' | 'supported' | 'unsupported';
let _support: SupportState = 'unknown';
let _probePromise: Promise<boolean> | null = null;

export function getAvatarUrl(addr: string | undefined | null): string | null {
  if (typeof addr !== 'string' || addr.length === 0) return null;
  return AVATAR_DIR + encodeURIComponent(addr) + '.jpg';
}

// Returns false until probeAvatarSupport() has resolved successfully, so
// renderers default to the no-avatar layout and never reflow when the
// probe completes mid-frame.
export function isAvatarSupported(): boolean {
  return _support === 'supported';
}

/**
 * Fire a GET for the local user's avatar and remember whether it
 * returned a real image. Cached; safe to call multiple times.
 *
 * GET rather than HEAD because the avatar is served locally by the
 * messenger (no network) and some webxdc implementations don't honour
 * HEAD. The body is discarded.
 */
export function probeAvatarSupport(selfAddr?: string): Promise<boolean> {
  if (_support !== 'unknown') return Promise.resolve(_support === 'supported');
  if (_probePromise) return _probePromise;

  const addr = selfAddr || globalThis.webxdc?.selfAddr || '';
  const url = getAvatarUrl(addr);
  if (!url || typeof fetch !== 'function') {
    _support = 'unsupported';
    return Promise.resolve(false);
  }

  _probePromise = fetch(url)
    .then(function (resp) {
      _support = resp && resp.ok ? 'supported' : 'unsupported';
      return _support === 'supported';
    })
    .catch(function () {
      _support = 'unsupported';
      return false;
    });
  return _probePromise;
}

export function __resetAvatarsForTest(): void {
  _support = 'unknown';
  _probePromise = null;
}

export function __setAvatarSupportForTest(supported: boolean): void {
  _support = supported ? 'supported' : 'unsupported';
  _probePromise = null;
}
