# Testing guide

## Injectable clock

All game-logic modules obtain the current time from `scripts/clock.js` rather
than calling `Date.now()` directly.  This lets unit and Playwright tests advance
time by hours or days in **O(1)** without `setTimeout` or fake-timer libraries.

### API

```js
import { now, setOverride, clearOverride, advance } from './scripts/clock.js';
```

| Function | Description |
|---|---|
| `now()` | Current epoch-ms. Returns the override if one is set, else `Date.now()`. |
| `setOverride(t)` | Pin the clock to epoch-ms value `t`. |
| `clearOverride()` | Remove the override; `now()` reverts to `Date.now()`. |
| `advance(deltaMs)` | Advance the clock by `deltaMs` ms relative to the current `now()`. |

### Using the clock in vitest unit tests

Always restore the real clock in `afterEach` so tests don't bleed into each
other:

```js
import { afterEach } from 'vitest';
import { now, setOverride, clearOverride, advance } from '../../scripts/clock.js';

afterEach(() => clearOverride());

it('charges complete after 1 day', () => {
  setOverride(0);                  // pin to epoch 0
  advance(86_400_000);             // jump forward 1 day in O(1)
  const r = materialize(state, now());
  expect(r.state.nodes_collect).toHaveLength(1);
});
```

### Clock-skew guard

`scripts/state.js` applies `Math.max(clockNow(), state.last_seen_ts)` before
every reducer call.  This means:

- Setting the override **forward** in time works as expected — charges fire,
  AP accumulates.
- Setting the override **behind** the highest previously-recorded `last_seen_ts`
  does **not** rewind stored progress; the guard clamps to the recorded floor.

This mirrors the production clock-skew guard that protects against devices with
misconfigured system clocks.

### Using the clock from a browser devtools session

When the app URL contains `?devtools=1`, the page exposes `window.__dd`:

```js
window.__dd.setNow(Date.now() + 86_400_000);   // jump 1 day
window.__dd.advanceNow(3_600_000);              // advance 1 hour
window.__dd.clearNowOverride();                 // revert to wall clock
```

**Production builds do not set `?devtools=1`**, so `window.__dd` is `undefined`
and there is no debug surface exposed to end users.

### Using the clock from Playwright e2e tests

In Playwright, evaluate the `window.__dd` helpers after navigating to the app
with the devtools flag:

```js
await page.goto('http://localhost:5173/?devtools=1');
await page.evaluate(() => window.__dd.advanceNow(86_400_000));
// now trigger UI actions that depend on charged nodes being ready …
```

Alternatively, import `clock.js` directly in the Node-side test if you prefer
to avoid browser-side evaluation:

```js
import { setOverride, clearOverride } from '../scripts/clock.js';
// (works because clock.js has no DOM globals)
```

## Stable selectors for UI testing

All load-bearing UI elements used by Playwright tests carry `data-testid` attributes
for stable selection. These selectors use kebab-case with the `dd-` prefix.

### Testid registry

| Testid | Element | Usage |
|---|---|---|
| `dd-cash-counter` | Cash status bar value | Select to check cash amount |
| `dd-profile-counter` | Profile status bar value | Select to check profile score |
| `dd-karma-counter` | Karma status bar indicator | Select to check karma state |
| `dd-collect-ready` | Decorator ready indicator on nodes | Select to check if a node is ready to collect |
| `dd-collect-button` | Collect button on client/contact/token popups | Click to trigger collect action |
| `dd-charge-button` | Charge button on client/contact/token popups | Click to trigger charge action |
| `dd-display-name-input` | Display name input field | Interact with to set user display name |
| `dd-display-name-save-button` | Display name save button | Click to save user display name |
| `dd-perp-buy-{gestalt}` | Buy button for perpetual in popup | Click to purchase a perpetual (gestalt identifies the perp type) |
| `dd-leaderboard-row-{addr}` | Leaderboard entry row | Select to check scores for a player (addr is their address) |
