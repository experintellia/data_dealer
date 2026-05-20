// Avatar URLs for the experimental webxdc avatar API proposed in
// chatmail/core#6429 + deltachat-desktop#4481.
//
// Avatars live in a virtual directory served by the messenger:
//   __webxdc__/avatar/<addr>.jpg   (404 when the contact has no picture)
//
// Per the PR, the user_id is "basically the (self)addr" — so we use
// `webxdc.selfAddr` for self and `delta.addr` for peers without any
// extra plumbing. We never feature-detect: every row gets an <img>
// pointing at this URL, the avatar slot stays collapsed until the
// image's own onload fires, and 404s leave the row's layout unchanged.

const AVATAR_DIR = '__webxdc__/avatar/';

export function getAvatarUrl(addr: string | undefined | null): string | null {
  if (typeof addr !== 'string' || addr.length === 0) return null;
  return AVATAR_DIR + encodeURIComponent(addr) + '.jpg';
}
