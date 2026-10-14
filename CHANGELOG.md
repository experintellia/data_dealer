# Changelog

What changed for players in each release. For the full technical history, see
`git log`.

## [0.5.0] - 2026-10-14

### Added

- Try the game in your browser at
  [experintellia.github.io/data_dealer](https://experintellia.github.io/data_dealer/),
  with no messenger needed.

### Changed

- "Highscore" is now called "Leaderboard" ("Bestenliste" in German).

### Fixed

- Fixed a security hole: a chat member with a specially crafted display name
  could run code in other players' games when they opened the leaderboard.
- Malformed or tampered game updates from other chat members are now ignored
  instead of corrupting or freezing the game.
- Karma incidents can no longer be dodged by closing and reopening the app.
- Buying karma levels and power-ups now follows the same rules as the rest of
  the game.
- Some popups and messages showed up twice.
- Requirement lists now also show tokens you have none of yet, and the
  "Requires either… or…" text no longer lists the wrong options.
- Fixed layout problems on phones: the conveyor belt scale on Firefox and
  Android, the new-contact and new-items cards overflowing, the squashed
  empty buy popup, and overlong names on the leaderboard.

## [0.4.0] - 2026-06-18

### Fixed

- Karma works again: collecting from a perp can cost karma, so karma can go
  negative and karma incidents happen as in the original game.
- Dialog buttons no longer get cut off on iPhone and iPad messengers.
- App text is no longer accidentally selected while playing; descriptions and
  input fields stay selectable.

## [0.3.0] - 2026-06-16

- First release.
