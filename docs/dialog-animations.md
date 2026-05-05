# Dialog animation catalogue

Reference for the Preact non-graph UI refactor (#186). Each animation pattern is
documented in enough detail to re-implement in CSS `@keyframes` + `transition` /
Web Animations API without re-reading the legacy code.

---

## Implementation index

The legacy codebase uses **four distinct animation mechanisms** across dialog UI:

| Mechanism | Files : lines | Affects |
|---|---|---|
| **TweenJS (CreateJS)** | `scripts/Render.js:1243–2115` | All canvas-sprite FX overlaid on dialogs: NoCash, NoAP, Error, LevelUp, MissionComplete, KarmaBling, BlingQueue, decorators |
| **CSS `@keyframes`** | `css/Render.css:2895–3150`, `css/dd.css:103–118` | Tutorial body enter, powerup slot enter/exit, spinner, pulsate, notification badge rotation pulse, error-text flash, jump, mission-reward pulse |
| **CSS `transition`** | `css/Render.css` (various) | Popup exit, subpop open/close, backdrop appear, tab/page slide, button active state, SubpopContainer fade |
| **jQuery `.animate()` / `.fadeIn()` / `.fadeOut()`** | `scripts/Render.js:3151–3156, 4782–4806` · `scripts/Game.js:3492, 3522` | Decorator bar width fills, database queue item moves, powerup slot background crossfade |
| **`requestAnimationFrame`** | `scripts/Render.js:4146, 4174` | Map zoom step — **not dialog-related; excluded** |
| **Web Animations API** | — | Not present anywhere in the codebase |

**TweenJS note.** The FX functions (FXNoCash, FXLevelUpBling, etc.) animate
EaselJS `Bitmap` / `Shape` sprites on the game canvas, not DOM elements. The
Preact refactor must either keep the canvas layer intact (simplest) or recreate
them as DOM overlays using CSS keyframes / WAAPI. The per-pattern entries below
give both the canvas implementation and a suggested DOM translation.

**jQuery easing.** None of the jQuery calls rely on the jQuery default 400 ms
duration. All pass an explicit millisecond value. The easing is always the jQuery
default `"swing"` (≈ `ease-in-out`) unless otherwise noted; no separate easing
plugin is loaded.

---

## Pattern catalogue

### Pattern: dialog backdrop appear

**Used by:** every dialog and notification (all items in inventory #186).

**Legacy implementation:**
- `css/Render.css` — selector `.PopupContainer.lockOn`:
  `transition: background 0.15s linear, visibility 0.15s linear, box-shadow 0.15s linear`
- The `lockOn` class is added to the pre-existing `.PopupContainer` div when
  `Popup` is instantiated (`scripts/Render.js:4840`).

**Two variants — duration depends on popup type:**

| Variant | Duration | Easing | Selector |
|---|---|---|---|
| Standard popups (CityPerp, ProjectPerp, UserData, etc.) | **instant** (`transition: none`) | — | `.PopupContainer.lockOn` |
| Notification variants (Alert, Tutorial, NewItems, Mission, LevelUp) | **150 ms** | linear | `.PopupContainer.lockOn.Alert` etc. (`css/Render.css:654–662`) |

**Properties animated (notification variants only):** `background`, `visibility`, `box-shadow`  
**Direction:** enter; the same transition fires in reverse on exit when `.lockOn` is removed (standard popups disappear instantly on exit too).

**CSS translation (notification variant):**
```css
.backdrop {
  visibility: hidden;
  background: transparent;
}
/* standard popups — no transition on backdrop */
.backdrop.is-open {
  visibility: visible;
  transition: none;
  background: transparent;
  box-shadow: 0px 0px 256px #000 inset;
}
/* notification variants — short fade */
.backdrop.is-open.is-alert    { background: rgba(255, 0, 0, 0.4); }
.backdrop.is-open.is-levelup  { background: rgba(255, 255, 255, 0.2); }
.backdrop.is-open.is-alert,
.backdrop.is-open.is-mission,
.backdrop.is-open.is-tutorial,
.backdrop.is-open.is-new-items,
.backdrop.is-open.is-levelup {
  transition: background 150ms linear, visibility 150ms linear, box-shadow 150ms linear;
}
```

---

### Pattern: dialog body entrance

**Used by:** all popups on first appearance.

**Legacy implementation:**  
The `.PopupBody` element has **no enter animation** (`css/Render.css:1652–1659` has no `animation` or enter `transition` rule). The body appears as-is when the container becomes visible. The only visual drama on enter comes from:
- The backdrop transition (instant or 150 ms depending on type, see above)
- For Tutorial dialogs only: `AniScaleOpacity 0.2s reverse` on `.PopupBody.TutorialBody` (see below)

> `@keyframes AniPlugIn2` is **not** applied to `.PopupBody`. It is only used for powerup sprites within popups — see [powerup slot enter](#pattern-powerup-slot-enter-aniplugin2).

---

### Pattern: tutorial dialog body enter (`AniScaleOpacity` reversed)

**Used by:** Tutorial and LevelUp dialogs (`.PopupBody.TutorialBody`) only.

**Legacy implementation:**  
CSS `@keyframes AniScaleOpacity` — `css/Render.css:2923–2941`, applied in **reverse** on `.PopupBody.TutorialBody` (`css/Render.css:2663–2665`):  
`animation: AniScaleOpacity 0.2s reverse`

Playing in reverse means the animation runs end → start: begins at `scale(2,0) opacity 0` and ends at `scale(1,1) opacity 1` — a scale-and-fade **enter** effect.

**Duration:** 200 ms  
**Easing:** browser default (`ease`)  
**Properties animated:** `transform: scale(2,0) → scale(1,1)`, `opacity: 0 → 1`  
**Direction:** enter (reverse playback of a scale-out keyframe)

**Full keyframe values (`css/Render.css:2932–2941`, played in reverse):**
```
exit definition (forward):
  0%   scale(1, 1)    opacity 1
 100%  scale(2, 0)    opacity 0

enter effect (reverse):
  0%   scale(2, 0)    opacity 0   ← start
 100%  scale(1, 1)    opacity 1   ← end
```

**CSS translation:**
```css
@keyframes tutorialBodyEnter {
  from { transform: scale(2, 0); opacity: 0; }
  to   { transform: scale(1, 1); opacity: 1; }
}
.tutorial-body {
  animation: tutorialBodyEnter 200ms ease;
}
```

---

### Pattern: dialog body exit (`.Popup.close`)

**Used by:** every popup and notification on close.

**Legacy implementation:**
- `scripts/Render.js:5287` — `popup.jdomelem.addClass('close')` is called by
  `Popup.prototype.close()`.
- CSS `css/Render.css:945–968`:
  - `.Popup.close { transition: visibility 0.2s }` (visibility hidden)
  - `.Popup.close .PopupBody { transform: scale(2, 0); transition: transform 0.2s }`
- A 250 ms JS `setTimeout` fires the removal callback (safety margin over the
  200 ms CSS duration); a second 500 ms timeout force-removes the DOM node if
  the first callback didn't fire.

**Duration:** 200 ms (CSS); JS waits 250 ms before callback, 500 ms before force-remove  
**Easing:** browser default (`ease`)  
**Properties animated:** `visibility` (hidden), `transform: scale(2, 0)` — squashes vertically while expanding horizontally then vanishes  
**Direction:** exit

**CSS translation:**
```css
.dialog.is-closing {
  visibility: hidden;
  transition: visibility 200ms;
}
.dialog.is-closing .dialog-body {
  transform: scale(2, 0);
  transition: transform 200ms;
}
```

> **Exit-animation hook note.** Preact unmounts immediately on state change.
> A `useExitAnimation` hook (see Appendix) is needed to hold the node in the
> DOM for 200–250 ms while the CSS exit plays before unmounting.

---

### Pattern: subpop open (nested detail panel)

**Used by:** ProjectPerp (Upgrades/Ads/TeamMembers tabs), CityPerp (perp detail),
AgentPerp, KarmaSelector, TokenPerp (upgrade detail).

**Legacy implementation:**
- `scripts/Render.js:5052–5081` — `.addClass('open')` on `.Subpop` and
  `.SubpopContainer`.
- CSS `css/Render.css:2058–2114`:
  - Default state: `transform: scale(0, 0)`, `transform-origin: 50% 100%`,
    `opacity: 0`, `visibility: hidden`
  - `.Subpop.open { transform: scale(1, 1); transition: transform 0.1s }`
  - `.SubpopContainer.open { opacity: 1; visibility: visible; transition: 0s }` (instant)

**Duration:** 100 ms (`.Subpop` transform); `SubpopContainer` opacity/visibility: instant on open  
**Easing:** browser default (`ease`)  
**Properties animated:** `transform: scale(0,0) → scale(1,1)`, origin at bottom-centre  
**Direction:** enter; grows upward from bottom of anchor point

> **`.SubpopContainer` opacity/visibility transition** (`css/Render.css:2020–2035`):
> Default state has `transition: opacity 0.2s linear 0.2s, visibility 0.2s` (fades in with a 200 ms delay).
> `.SubpopContainer.open` overrides to `transition: opacity 0s` (instant opacity) so that the
> container becomes visible immediately when opened. On close (removing `.open`), the 0.2s + 0.2s-delay
> fade fires, staggering the container's disappearance 200 ms after the `.Subpop` scale-out finishes.

---

### Pattern: subpop close

**Used by:** same as subpop open.

**Legacy implementation:**
- `scripts/Render.js:5100–5119` — `.removeClass('open')`.
- CSS: default (non-open) state: `transform: scale(0, 0); transition: transform 0.2s`

**Duration:** 200 ms  
**Easing:** browser default (`ease`)  
**Properties animated:** `transform: scale(1,1) → scale(0,0)`, same bottom-centre origin  
**Direction:** exit

---

### Pattern: tab / pagination slide (`PopupPageWrap`)

**Used by:** CityPerp (Agent|Pusher|Proxy tabs), ProjectPerp (4 tabs), UserData
(Settings|Debug tabs), any dialog with multi-page pagination.

**Legacy implementation:**
- `scripts/Render.js:5144` — `PopupPageWrap.animate({ left: -(index * 540) }, 0)`
  sets the final position instantly via jQuery (0 ms duration).
- CSS `css/Render.css:1012–1014`: `transition: left 0.4s ease-out` on `.PopupPageWrap`.
- The CSS transition therefore animates between the previous and new `left` values.
- Individual pages: `css/Render.css:1021–1023`:
  `transition: opacity 0.4s ease-out, transform 0.4s ease-out` on `.PopupPage`.

**Duration:** 400 ms  
**Easing:** `ease-out`  
**Properties animated:** `left` (horizontal slide), per-page `opacity` and `transform`  
**Direction:** bidirectional (prev/next)

> **CSS translation note.** Replace `left` offsets with `translate` + a scroll-snap
> container or Preact state-driven `translateX`; keep `ease-out 400ms` timing.

---

### Pattern: button active pulse (`AniPulsate`)

**Used by:** any `.Button.active` element inside a popup — charge/collect buttons
awaiting press, confirm button highlighted state.

**Legacy implementation:**  
CSS `@keyframes AniPulsate` — `css/Render.css:2944–2962`.  
Applied via `animation: AniPulsate 0.3s linear infinite alternate` on `.Button.active`
(`css/Render.css:2731, 2737`).

**Duration:** 300 ms per half-cycle (alternate = 600 ms full cycle)  
**Easing:** linear  
**Properties animated:** `transform: scale`  
**Direction:** infinite alternating

```
0%   scale(1.08, 1.08)
100% scale(1.02, 1.02)
```

---

### Pattern: button state transition (hover / press)

**Used by:** all `.Button` elements in all popups.

**Legacy implementation:**  
CSS `css/Render.css:2696–2698`:
`transition: color 0.2s linear, background 0.2s linear, border 0.2s linear, box-shadow 0.2s linear`

**Duration:** 200 ms  
**Easing:** linear  
**Properties animated:** `color`, `background`, `border`, `box-shadow`

---

### Pattern: error-text flash (`AniErrorText`)

**Used by:** `.PopupText.ErrorText` — validation errors in input fields (e.g. display
name field in UserData dialog).

**Legacy implementation:**  
CSS `@keyframes AniErrorText` — `css/Render.css:2985–3005`.  
Applied via `animation: AniErrorText 0.4s linear` on `.PopupText.ErrorText`
(`css/Render.css:1466–1468`).

**Duration:** 400 ms (plays once)  
**Easing:** linear  
**Properties animated:** `color`, `border-color`, `box-shadow`

```
0%   { color: #F00; border-color: #F00; box-shadow: 0 0 14px #f00 }
100% { color: inherit; border-color: inherit; box-shadow: none }
```

---

### Pattern: mission reward idle pulse (`AniNew`)

**Used by:** `.MissionBody.Complete .MissionReward` sprite elements — the reward
icons (cash, XP, profile sets) shown in the Mission Complete dialog.

**Legacy implementation:**  
CSS `@keyframes AniNew` — `css/Render.css:3007–3025`.  
Staggered timing: `0.30s`, `0.31s`, `0.32s`, `0.33s` for successive reward types
(`css/Render.css:1409–1426`).

**Duration:** 300–330 ms per half-cycle, `infinite alternate`  
**Easing:** linear  
**Properties animated:** `transform: scale`

```
0%   scale(1.06, 1.06)
100% scale(1.0,  1.0)
```

---

### Pattern: notification title badge pulse (`AniNewRot`)

**Used by:** `.NotificationTitle` — the "New!" badge on New Items notifications (New
Contacts!, New Clients!, New Ventures!, New Powerups!). The badge is positioned
top-left of the notification card, permanently tilted at −16°.

**Legacy implementation:**  
CSS `@keyframes AniNewRot` — `css/Render.css:2974–2983`.  
Applied via `css/Render.css:2560–2564`:  
`animation: AniNewRot 0.3s linear infinite alternate`

**Duration:** 300 ms per half-cycle, `infinite alternate`  
**Easing:** linear  
**Properties animated:** `transform: scale` (while the element's `transform: rotate(-16deg)` base is fixed)

```
0%   scale(1.08, 1.08) rotate(-16deg)
100% scale(1.02, 1.02) rotate(-16deg)
```

> Identical rhythm to `AniPulsate` (0.3 s linear infinite alternate) but applied to a tilted
> text badge rather than a button — the `rotate(-16deg)` is a static base, not animated.

---

### Pattern: loading spinner (`AniRotate`)

**Used by:** `.StatusSpinner` (dialog loading states), `.DDLoaderSpinner` (dd.css).

**Legacy implementation:**  
CSS `@keyframes AniRotate` — `css/Render.css:2895–2920`.  
`animation: AniRotate 1s linear infinite`.

```
  0%  rotate(0deg)   scale(1.0)
 50%  rotate(180deg) scale(0.6)
100%  rotate(360deg) scale(1.0)
```

**Duration:** 1 s per cycle  
**Easing:** linear  
**Properties animated:** combined `transform: rotate(...) scale(...)` (rotation with breathing scale effect)

`dd.css:103–118` defines `DDSpinnerRotate` — a simpler `from: rotate(0deg)` →
`to: rotate(360deg)` at 1.2 s linear infinite (no scale breathing).

---

### Pattern: attention jump (`AniJump`)

**Used by:** icon elements that need to attract attention (e.g. new-mission
indicator, tutorial prompt).

**Legacy implementation:**  
CSS `@keyframes AniJump` — `css/Render.css:3028–3067`.  
`animation: AniJump 6s linear infinite normal`.

**Duration:** 6 s per cycle (jumps occupy only ~8% of the cycle; 92% is at rest)  
**Easing:** linear  
**Properties animated:** `transform: translateY`

```
0%,4%,8%  translateY(0px)
2%         translateY(-10px)
6%         translateY(-7px)
```

---

### Pattern: powerup slot enter (`AniPlugIn2`)

**Used by:** `.Powerup.updating .PowerupPerp` — when a powerup appears in a slot
inside ProjectPerp or Token popup. This is the **only** CSS usage of `AniPlugIn2`.

**Legacy implementation:**  
CSS `@keyframes AniPlugIn2` — `css/Render.css:3070–3123`.  
Applied via `css/Render.css:2243–2245`:  
`animation: AniPlugIn2 0.4s linear` on `.Powerup.updating .PowerupPerp`.

**Duration:** 400 ms  
**Easing:** linear  
**Properties animated:** `transform: scale(...)`, `opacity`

**Full keyframe values (`css/Render.css:3094–3123`):**
```
  0%  scale(0.0, 0.0)  opacity 0
 60%  scale(1.2, 1.2)  opacity 1
 70%  scale(1.0, 1.0)
 80%  scale(1.1, 1.1)
 90%  scale(1.0, 1.0)
 95%  scale(1.05,1.05)
100%  scale(1.0, 1.0)  opacity 1
```

---

### Pattern: powerup slot exit (`AniPlugOut2`)

**Used by:** `.Powerup.updating.hide .PowerupPerp`.

**Legacy implementation:**  
CSS `@keyframes AniPlugOut2` — `css/Render.css:3125–3150`.  
`animation: AniPlugOut2 0.2s ease` on `.Powerup.updating.hide .PowerupPerp`
(`css/Render.css:2253–2255`).

**Duration:** 200 ms  
**Easing:** `ease`  
**Properties animated:** `transform: scale`, `opacity`

```
  0%  scale(1.0, 1.0)  opacity 1
 15%  scale(1.2, 1.2)  opacity 1   ← anticipatory pop
100%  scale(0.0, 0.0)  opacity 0
```

---

### Pattern: powerup slot background crossfade

**Used by:** `Game.js:3492, 3522` — when a powerup is bought or its slot page
changes in ProjectPerp.

**Legacy implementation:**  
jQuery `.delay(400).fadeOut(150).fadeIn(250)` on `.PowerupBackground`.

**Duration:** 400 ms delay + 150 ms fade-out + 250 ms fade-in = **800 ms total**  
**Easing:** jQuery default (`swing` ≈ `ease-in-out`)  
**Properties animated:** `opacity`

**CSS translation:**
```css
.powerup-background { transition: opacity 150ms ease-in-out; }
```
…with a 400 ms JS delay before swapping the background image and re-fading in
over 250 ms.

---

### Pattern: FXNoCash — insufficient-cash feedback

**Used by:** any purchase button when `game_values.cash_value < price`; event
`no_cash` caught at `scripts/Render.js:4889–4897`.

**Legacy implementation:**  
TweenJS canvas sprite (`scripts/Render.js:1950–1988`).  
Sprite: `no_cash` frame from `MainSprites.png`, rendered on the game canvas above
the triggering node. In parallel, the DOM button receives `.disabled.no_cash` CSS
classes (no separate CSS animation; the class changes colour/state only).

**Sequence (canvas layer):**

| Step | Duration | Properties | Easing | State |
|---|---|---|---|---|
| Setup | 0 ms | scaleX 5, scaleY 5, rotate −360°, opacity 0, y = nodeY − 400 | linear | initial |
| Wait | 200 ms | — | — | hold |
| Enter | 150 ms | scaleX 1, scaleY 1, rotate 0°, opacity 1, y = nodeY | easeOut | appear |
| Hold | 1 000 ms | — | — | display |
| Exit | 200 ms | scaleX 1.5, scaleY 1.5, opacity 0, rotate 360° | linear | disappear |

**Total canvas duration:** 1 550 ms  
**DOM side-effect:** `.Button` receives `.disabled.no_cash`; cleared after animation callback.

**CSS/WAAPI translation for DOM-only reimplementation:**
```css
@keyframes noCashEnter {
  /* NOTE: the canvas original positions the sprite at nodeY-400 (absolute canvas coord).
     In a DOM reimplementation, translateY(-400px) is relative to the element's
     natural position — adjust if the element's starting position differs from the button. */
  from { transform: scale(5) rotate(-360deg) translateY(-400px); opacity: 0; }
  to   { transform: scale(1) rotate(0deg)    translateY(0);      opacity: 1; }
}
@keyframes noCashExit {
  from { transform: scale(1);                opacity: 1; }
  to   { transform: scale(1.5) rotate(360deg); opacity: 0; }
}
```
WAAPI sequencing (200 ms delay → 150 ms enter → 1 000 ms hold → 200 ms exit):
```js
await el.animate([...], { delay: 200, duration: 150, easing: 'ease-out', fill: 'forwards' }).finished;
await new Promise(r => setTimeout(r, 1000));
await el.animate([...], { duration: 200, easing: 'linear', fill: 'forwards' }).finished;
```

---

### Pattern: FXNoAP — insufficient-AP feedback

**Used by:** any action button when action points are insufficient; event `no_AP`
at `scripts/Render.js:4899–4907`.

**Legacy implementation:**  
TweenJS canvas sprite (`scripts/Render.js:1990–2029`).  
Sprite: `no_AP` frame from `MainSprites.png`.

**Sequence:**

| Step | Duration | Properties | Easing |
|---|---|---|---|
| Setup+enter start | 100 ms | scaleX 0→1, scaleY 0→1, opacity 0→1, y stays at nodeY | linear |
| Float up | 200 ms | scaleX 1, scaleY 1, rotate 0°, opacity 1, y = nodeY − 32 | easeOut |
| Hold | 1 000 ms | — | — |
| Exit (float + scale out) | 200 ms | scaleX 1.5, scaleY 1.5, opacity 0, y = nodeY − 64 | linear |

**Total canvas duration:** 1 500 ms

---

### Pattern: FXError — generic error feedback

**Used by:** handler errors not covered by NoCash/NoAP; event `error` at
`scripts/Render.js:4909–4917`.

**Legacy implementation:**  
`scripts/Render.js:2031–2033` — calls `FXNoAP` with the `'bug'` sprite frame
instead of `'no_AP'`. The animation timing is **identical to FXNoAP** (1 500 ms
total). Only the sprite differs.

---

### Pattern: FXKarmaBling — karma-change celebration

**Used by:** karma selector dialog when karma changes; triggered at
`scripts/Render.js:1771–1822`.

**Legacy implementation:**  
TweenJS canvas sprite (karma-up icon, 96 × 96 px from `MainSprites.png`) plus
a `FXBling` text overlay.

**Icon sequence:**

| Step | Duration | Properties | Easing |
|---|---|---|---|
| Setup | 0 ms | scale 0, rotate 720°, opacity 0 | linear |
| Spiral enter | 500 ms | scale 1.2, rotate 0°, opacity 1, y = nodeY | easeOut |
| Settle bounce | 250 ms | scale 1.0 | bounceOut |
| Hold | 800 ms | — | — |
| Exit (float up) | 200 ms | scale(0, 4.5), opacity 0, y = nodeY − 200 | linear |

**Total icon duration:** 1 750 ms  
**Text overlay (`FXBling`):** `'+' + karma_amount`; wait 600 ms, display 1 300 ms,
CSS class `KarmaUpBling`.

---

### Pattern: FXLevelUpBling — level-up celebration

**Used by:** level-up overlay; triggered by
`groot.renderNode.FXLevelUpBling(levelNumber)` called from `scripts/Render.js:1824–1879`
(itself called at `scripts/Game.js` level-up handler).

**Legacy implementation:**  
TweenJS canvas sprite (level-up star, 138 × 138 px, pivot 69 × 69, `MainSprites.png`
coords x:525 y:842) plus a `FXBling` text overlay.

**Icon sequence:**

| Step | Duration | Properties | Easing |
|---|---|---|---|
| Setup | 0 ms | scale 0, rotate 720°, opacity 0 | linear |
| Spiral enter | 500 ms | scale 1.2, rotate 0°, opacity 1, y = nodeY | easeOut |
| Scale bounce | 250 ms | scale 2.0 | bounceOut |
| Hold | 1 000 ms | — | — |
| Exit (float up) | 200 ms | scale(0, 4.5), opacity 0, y = nodeY − 200 | linear |

**Total icon duration:** 1 950 ms  
**Text overlay (`FXBling`):** `'Level ' + xp_level`; wait 600 ms, display 1 800 ms,
CSS class `LevelUpBlingBig`.  
**Total visible duration (longest element):** ~2 950 ms

**WAAPI translation shape** (multi-step sequences like this are best expressed
as a `finished`-chained WAAPI call sequence — see Appendix):
```js
// icon element
icon.animate([
  { transform: 'scale(0) rotate(720deg)', opacity: 0 },
  { transform: 'scale(1.2) rotate(0deg)', opacity: 1 }
], { duration: 500, easing: 'ease-out', fill: 'forwards' });
// … then bounce to scale(2), hold 1000ms, then exit
```

---

### Pattern: FXMissionComplete — mission-complete celebration

**Used by:** Mission Complete dialog; triggered at `scripts/Render.js:1881–1921`,
called at `scripts/Game.js:771` with a 1 000 ms offset after the dialog appears.

**Legacy implementation:**  
TweenJS canvas sprite (flag, 122 × 160 px, pivot 55 × 90, `MainSprites.png`
coords x:717 y:764).

**Sequence:**

| Step | Duration | Properties | Easing |
|---|---|---|---|
| Setup | 0 ms | scale 0, rotate 0°, opacity 0 | linear |
| Enter | 250 ms | scale 1.2, opacity 1, y = nodeY | easeOut |
| Settle | 250 ms | scale 1.0 | bounceOut |
| Hold | 1 000 ms | — | — |
| Exit | 200 ms | scale(0, 4.5), opacity 0, y = nodeY − 200 | linear |

**Total duration:** 1 700 ms  
**Appears:** 1 000 ms after Mission Complete dialog is shown (scripted offset in
`Game.js:771`).

---

### Pattern: FXMissionGoalComplete — goal-checkpoint mark

**Used by:** mission goal items on the map/mission view when a goal is ticked off;
`scripts/Render.js:1923–1948`.

**Legacy implementation:**  
TweenJS canvas sprite (same flag as FXMissionComplete), positioned at
`(nodePos.x − 40, nodePos.y + 50)` (top-right of the mission node).

**Sequence:**

| Step | Duration | Properties | Easing |
|---|---|---|---|
| Wait | 100 ms | — | — |
| Bounce in | 250 ms | scaleX 0→0.5, scaleY 0→0.5, opacity 1 | bounceOut |
| Hold | 1 000 ms | — | — |
| Exit | 200 ms | scaleX 0, scaleY 4.5, opacity 0 | linear |

**Total duration:** 1 550 ms

---

### Pattern: FXBling — floating text overlay

**Used by:** any game event that needs a text pop (gain amounts, level text,
karma text). Configured per call-site.

**Legacy implementation:**  
TweenJS text node (`scripts/Render.js:2071–2100`).

**Parameters:**

| Parameter | Default | Meaning |
|---|---|---|
| `wait` | 0 ms | Pre-display delay |
| `dur` | 1 000 ms | Time visible before fade |
| `text` | — | Text content |
| `extendClass` | `''` | Extra CSS class (e.g. `LevelUpBlingBig`, `KarmaUpBling`) |
| `renderOn` | parent node | Override for parent container |

**Sequence:** wait → snap to `scale(0.5)` → simultaneously scale to `scale(1.0)` while fading out (`opacity: 0`) over `dur` ms (easeOut). Text appears small, grows, and fades out in a single motion.  
Start position: `nodePos.x, nodePos.y − 50`.

---

### Pattern: FXBlingQueue — database queue notifications

> **Scope note:** FXBlingQueue renders at the status bar's top-left corner
> (`renderStatusbar.getTopLeftPosition()`), which is an always-visible HUD element.
> It is listed here for completeness but is **out of scope** for the dialog/overlay
> Preact refactor. Address with the HUD refactor instead.

**Used by:** profile sync and database queue updates; `scripts/Render.js:2035–2069`.

**Legacy implementation:**  
TweenJS text nodes, staggered when multiple notifications fire simultaneously.

**Sequence per notification:**

| Step | Duration | Easing |
|---|---|---|
| Wait (configurable, staggered 200–500 ms) | — | — |
| Scale-in (`backOut` bounce) | 200 ms | backOut |
| Hold | 2 000 ms | — |
| Scale+fade out | 250 ms | easeOut |

**Total per notification:** ~2 450 ms  
**Stacking:** subsequent blings offset `y` position downward to stack visually.  
**CSS classes:** `ProfileBlingNew`, `ProfileBlingUpdated`.

---

### Pattern: database queue item move (jQuery)

**Used by:** merge operation on the database queue view;
`scripts/Render.js:4762–4806`.

**Legacy implementation:**  
jQuery `.animate()` calls on DOM queue items.

**Sequence:**
1. 2 000 ms delay (merge UI visible first)
2. Target item: `.animate({ top: '102' }, 250)` — floats upward
3. Sibling items: `.animate({ left: '-=100' }, 250)` + staggered 50 ms per item
   — shift left to fill the gap

**Duration:** 250 ms per element (after delay)  
**Easing:** jQuery default `swing` (≈ `ease-in-out`)  
**Properties:** `top`, `left` (CSS position)

---

### Pattern: decorator amount-bar fill

**Used by:** perp decorator bars (charge level, resource level) on node hover;
`scripts/Render.js:3151–3156`.

**Legacy implementation:**  
jQuery `.animate({ width: targetPx }, 600)` on `.DecoratorAmountValue`.

**Duration:** 600 ms  
**Easing:** jQuery default `swing` (≈ `ease-in-out`)  
**Properties:** `width` (0–60 px range)

---

## Per-dialog override table

The table lists any deviation from the universal default pattern:
**no body enter animation · exit via `.Popup.close` 200 ms · backdrop instant** (`transition: none` on standard `.PopupContainer.lockOn`).

| Dialog | Additional / overriding animations | Notes |
|---|---|---|
| **CityPerp** | Tab slide (400 ms ease-out) · Subpop open/close (100–200 ms) · Powerup slot enter/exit | Multi-tab + pagination |
| **AgentPerp** | None beyond default | — |
| **ContactPerp** | None beyond default | — |
| **PusherPerp** | None beyond default | — |
| **ClientPerp** | None beyond default | — |
| **ProxyPerp** | None beyond default | — |
| **ProjectPerp** | Tab slide · Subpop open/close · Powerup slot enter (AniPlugIn2) / exit (AniPlugOut2) · Powerup bg crossfade (jQuery 800 ms) | Most complex; 4 tabs |
| **TokenPerp** | Subpop open/close (TokenUpgrade height 167 px variant) | — |
| **Karma selector** | FXKarmaBling canvas (1 750 ms icon + 1 300 ms text) fires on karma change | Canvas layer stays |
| **Profile-set import** | None beyond default | — |
| **Buy slots sub-form** | None beyond default (inside ProjectPerp Subpop) | — |
| **LevelUp overlay** | Backdrop 150 ms fade (LevelUp variant) · TutorialBody enter: AniScaleOpacity 0.2s reverse · FXLevelUpBling canvas (1 950 ms icon + 1 800 ms text) fires on appearance | Longest animation in UI |
| **Mission Complete** | Backdrop 150 ms (Mission variant) · FXMissionComplete canvas (1 700 ms) fires 1 000 ms after dialog appears · AniNew (0.3–0.33 s) on reward sprites | Reward pulse is infinite; stops on close |
| **Mission Briefing** | Backdrop 150 ms (Mission variant) · AniJump (6 s) on attention icons · FXMissionGoalComplete (1 550 ms) on goal ticks | AniJump loops until closed |
| **New Items notification** | Backdrop 150 ms (NewItems variant) · AniNew (0.3 s) on item thumbnails · AniNewRot (0.3 s) on `.NotificationTitle` badge | Badge pulses while tilted −16° |
| **Karma Incident notification** | Backdrop 150 ms (Alert variant) | — |
| **Tutorial sequence** | Backdrop 150 ms (Tutorial variant) · TutorialBody enter: AniScaleOpacity 0.2s reverse | Event-handler detach on close |
| **User data / settings** | Tab slide (400 ms ease-out) | 2-tab variant |
| **FXNoCash** | TweenJS canvas 1 550 ms · DOM button `.disabled.no_cash` | No CSS anim on DOM side |
| **FXNoAP** | TweenJS canvas 1 500 ms · DOM button `.disabled.no_AP` | — |
| **FXError** | Identical timing to FXNoAP, `bug` sprite | — |
| **Database queue** | jQuery move (250 ms after 2 000 ms delay) · FXBlingQueue text (2 450 ms) | — |
| **Powerup slots** | AniPlugIn2 / AniPlugOut2 · jQuery bg crossfade 800 ms | — |
| **Status info popups (A.1–A.4)** | Default only | Trivial; no extras |

---

## Summary: recommended Preact-refactor translation strategy

**~95% of patterns are pure CSS.** The universal dialog enter/exit, all sub-popup
open/close, tab slides, button states, spinners, and pulse animations are already
in CSS `@keyframes` or `transition`; they port by preserving the class-toggle
trigger and the CSS rule, requiring no JS animation code.

Specific recommendations:

- **Default modal enter/exit.** Use native `<dialog>` element + `::backdrop` for
  the backdrop. Apply `AniPlugIn2` keyframes on `dialog::backdrop` appear and
  the `.is-closing` class approach for exit. The `<dialog>` spec handles
  `showModal()` / `close()` — no JS needed for show; the exit hook (see Appendix)
  handles the 200 ms exit delay before `close()`.

- **Subpop open/close.** `transform: scale(0,0) → scale(1,1)` on a
  `transform-origin: 50% 100%` container. Pure CSS `transition` on a `.is-open`
  class toggle.

- **Tab/page slide.** `translateX` on a flex/grid track with `transition: transform
  400ms ease-out`. Replaces the jQuery `left` trick.

- **Error-shake feedback (NoCash, NoAP, Error).** The canvas FX run on the canvas
  layer and **do not need to change** — keep the existing TweenJS sprite for each.
  Only the DOM button class (`.disabled.no_cash` / `.no_AP` / `.ERROR`) is Preact's
  concern; drive it from component state and style via CSS Modules.

- **Procedural celebration sequences (LevelUp, MissionComplete, KarmaBling).**
  These also run on the canvas layer via TweenJS and **can remain untouched** for
  the Preact refactor. If a future phase moves them to DOM, use Web Animations API
  (`element.animate([...], opts).finished` promises) to sequence the multi-step
  timing faithfully (see the pattern entries above for exact durations + easings).

- **No new animation library** — the existing animation budget does not justify
  Framer Motion, GSAP, or any other library. CSS transitions + `@keyframes` +
  WAAPI (for multi-step sequences if ever needed) cover the full set.

- **Exit-animation hook.** Preact unmounts immediately; a small
  `useExitAnimation(open, durationMs)` hook (see Appendix) is the only shared
  animation utility needed.

---

## Appendix: `useExitAnimation` sketch

The dialog exit CSS plays for 200 ms. Without a hook, Preact removes the DOM node
before the transition finishes. This ~20-line hook delays unmount.

```ts
// useExitAnimation.ts  — pseudocode, not production
import { useState, useEffect, useRef } from 'preact/hooks';

/**
 * Returns `{ visible, closing }`.
 * - `visible`  — mount the dialog DOM node when true
 * - `closing`  — add the `.is-closing` CSS class when true
 *
 * Usage:
 *   const { visible, closing } = useExitAnimation(isOpen, 250);
 *   if (!visible) return null;
 *   return <div class={closing ? styles.closing : ''}>…</div>;
 */
export function useExitAnimation(open: boolean, durationMs = 250) {
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (open) {
      clearTimeout(timer.current);
      setClosing(false);
      setVisible(true);
    } else if (visible) {
      setClosing(true);
      timer.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, durationMs);
    }
    return () => clearTimeout(timer.current);
  }, [open, visible]);

  return { visible, closing };
}
```

`durationMs` should match the longest CSS exit transition in the dialog — 200 ms
for the standard `.Popup.close` transition, with 50 ms safety margin → pass `250`.
For the tab slide (400 ms) set `durationMs = 450`.
