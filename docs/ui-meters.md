# UI meter bindings

Investigation of two UI meters whose port-time semantics drifted from the
original game (issue #98). Both bind to fields that the LocalEngine port
fills with the wrong arithmetic — the *bindings* are correct, the *values*
are wrong.

This file is a sibling of `handler-map.md` / `response-shapes.md`: it
documents what each on-screen meter is supposed to mean, where the original
game computed it, and what the port currently does instead.

---

## A. Database tab — per-TokenPerp progress bar

### Where it renders

`views/token.html:30` and `views/token_consumed.html:25` call
`_.RenderAmount(token.database_amount)`. `RenderAmount`
(`scripts/Render.js:4955`) draws a 60-px-wide orange (`#E85E2B`) bar whose
fill width is `(amount/100) * 60`px. The same decorator is attached to each
TokenPerp tile on the Database ViewMap via
`TokenPerp.prototype.extendRender` → `DecoratorAmount`
(`scripts/Render.js:5478`, `scripts/Game.js:5466`).

`token.database_amount` is populated for every token in a profileset by
`Game.js:2247`:

```js
t.database_amount         = groot.DBTokens[token.gestalt]         || 0;
t.database_absoluteAmount = groot.DBTokensAbsolute[token.gestalt] || 0;
```

`DBTokens[gestalt]` is the per-token `instance_data.amount` of the
`TokenPerp` node persisted under `Database.<gestalt>`, written by
`TokenPerp.prototype.setAmount` (`scripts/Game.js:5410`).

### What it meant in the original game

Upstream `dd_app/dd_merger.py` `UpgradeToken` and `dd_app/dd_calc.py`
`Database.merge` make `instance_data.amount` (called `share` server-side) the
**weighted-average prevalence (0–100 %) of that token type across every
profile currently in the player's database**, i.e. how many of the player's
profiles carry that data point.

The merge formula (paraphrased from `dd_calc.py`):

```
new_share = min(100,
  (db_share * (M - dupes)
   + dupe_count * dupe_mix
   + ps_share * N)
  / (M + N))
```

where `M` = `profiles_value` *before* merge, `N` = profileset's
`profiles_value`, `db_share` is the existing prevalence and `ps_share` the
prevalence inside the new profileset (each ContactPerp/CityPerp ships
`tokens[].amount` as its per-profileset prevalence in the ruleset; today every
one is `100`). Tokens that the new profileset does *not* contain get diluted:
`new_share = db_share * M / (M + N)`.

So the bar was an honest "how saturated is this trait in your DB" indicator
that drifted up and down as new (possibly off-topic) profilesets were merged.

### What the port does instead

`scripts/LocalEngine.js:1709-1711` (round 7 of #81) clamp-sums:

```js
var newAmount = Math.min(100,
  ((n.instance_data && n.instance_data.amount) || 0) + (tok.amount || 0));
```

Combined with the ruleset where every `tokens[].amount === 100`, *one*
integration of any contact saturates every token in its `tokens` list to
100 %. The bar is full forever after.

### Where the LocalEngine port should bind / compute

The bar binding is fine (`instance_data.amount` ↔ `database_amount` ↔ bar
fill); the *computation* in `_integrateProfiles` needs to switch from
`min(100, old + new)` to the weighted-average merge above. New token nodes
seeded for first-time integration need the same formula, which collapses
correctly when `M = 0` to `new_share`.

This is **non-trivial** — see the *Why this is not a small fix* section below.

---

## B. Top status bar — orange bar + percentage label under the profiles counter

### Where it renders

`views/statusbar.html:4-7`:

```html
<div class="StatusGraph" data-status-id="Profiles" style="width:<%= D.profiles_barsize %>px;"></div>
<div class="StatusGraph" data-status-id="Profiles"
     style="top:25px;left:18px;height:6px;background:#E85E2B;
            width:<%= D.profiles_crosssum %>px;"></div>
…
<div class="StatusTextSmall" data-status-id="Profiles">
  <%= D.profiles_crosssum %>%
  <%= D.profiles_tokenslength %>/<%= D.profiles.tokenslengthmax %>
</div>
```

There are two stacked bars: a wider blue one bound to
`profiles_value / profiles_max` (`profiles_barsize`, set in
`Game.js:1920`), and a narrower orange one bound to `profiles_crosssum`
(set in `Game.js:1921`). The text under the bars echoes the same crosssum
value as a percentage and shows `tokens-in-DB / max-token-types`.

`profiles_crosssum` is computed by
`GameRoot.prototype.getDBTokensCrossSum` (`scripts/Game.js:799-808`):

```js
GameRoot.prototype.getDBTokensCrossSum = function () {
  var sum = 0, count = 1;
  _.each(this.DBTokens, function (t) { sum += t; count += 1; });
  return sum / count;
};
```

i.e. the (off-by-one) **mean of every TokenPerp's `instance_data.amount`**.

### What it meant in the original game

A roll-up of (A): "across all the token types in your database, what is the
average prevalence?" With (A) computed as a true weighted-average share, the
crosssum is a meaningful `0…100` indicator of how *uniformly* saturated your
database is. The text label restates the same number as a percentage.

The orange colour matches the per-token DecoratorAmount bar (`#E85E2B` in
both `css/Render.css:822` and `statusbar.html`) — visually announcing
"this is the database-wide aggregate of those per-token bars."

### What the port does instead

Same root cause as (A): once every `instance_data.amount` saturates at 100,
the mean is also 100 for any number of integrated tokens. The bar and label
read 100 % forever after the first couple of integrations.

### Where the LocalEngine port should bind / compute

No binding change is required: `crosssum` is already correctly derived from
`DBTokens`. Once (A) is fixed, (B) reflects the right value automatically.
The `count = 1` start in `getDBTokensCrossSum` produces a slight bias
(`mean × N/(N+1)`); upstream behaviour matches that, so leave it alone.

---

## Why this is not a small fix (deferred to follow-up)

The brief allowed an in-PR fix only if it was ≤30 LOC. Switching
`_integrateProfiles` to the upstream weighted-average merge is small
(~10 LOC in `scripts/LocalEngine.js`), but it has knock-on effects that
make the change non-trivial:

1. **Test fixtures encode the sum-and-cap semantic.** Several specs in
   `tests/handlers/collect-integrate.test.js` (e.g. `instance_data.amount`
   becomes `5` after `2 + 3`, or saturates at `100` after `90 + 50`) need
   to be re-derived from the weighted-average formula and re-asserted.
2. **Mission progression reads `DBTokensAbsolute`.** With shares no longer
   pinned at 100 %, `groot.DBTokensAbsolute[goal.target] =
   profiles_value * amount / 100` no longer races ahead of every goal.
   `mission002` (target 900 of `token008`) currently completes the moment
   you integrate any contact whose tokens list contains `token008`,
   because `amount` jumps to 100 and `profiles_value` is already ≥ 900.
   Under the corrected formula it would complete only once enough
   `token008`-bearing profiles have actually been merged. Existing
   `_advanceIntegrateProfilesMissions` tests will need new expectations,
   and the ruleset's mission targets may need rebalancing for the new
   pacing.
3. **Ruleset shape is uniformly `amount: 100`.** Every contact / city in
   `data/ruleset_3.{en,de}.json` ships `tokens[].amount = 100`, meaning
   "every profile from this source carries this token type." This makes
   the weighted average converge to a function of *which* contacts the
   player owns and how often each is collected; the resulting curve
   needs play-testing rather than a one-line code change.

For these reasons (A) and (B) are filed as a single follow-up issue
(linked from the PR that introduces this document) with the proposed
weighted-average formula. The current investigation closes #98.

---

## State / view binding summary

| Meter | View site | Render binding | State field | Computed by |
|-------|-----------|----------------|-------------|-------------|
| (A) Per-TokenPerp database bar | `views/token.html:30`, `views/token_consumed.html:25` | `_.RenderAmount(token.database_amount)` (`scripts/Render.js:4955`) | `nodes[i].instance_data.amount` for `TokenPerp:<gestalt>`, exposed as `groot.DBTokens[gestalt]` | `_integrateProfiles` in `scripts/LocalEngine.js:1705-1754`; merged into `DBTokens` on `loadGame` (`scripts/Game.js:2077-2083`) and via `TokenPerp.setAmount` (`scripts/Game.js:5410-5425`) |
| (B) Status orange bar + % label | `views/statusbar.html:4-7` | `profiles_crosssum` width-px + label | `sb.profiles.crosssum` | `GameRoot.getDBTokensCrossSum` (`scripts/Game.js:799-808`), called from `setProfiles` (`scripts/Game.js:1921`) |
| (B) Status `tokens` counter | `views/statusbar.html:7` | `tokenslength / tokenslengthmax` | `sb.profiles.tokenslength{,max}` | `GameRoot.getDBTokensLength{,Max}` (`scripts/Game.js:786-796`) |

## References to upstream sources

- `datadealer/dd_app` `dd_app/dd_merger.py` — `UpgradeToken`, `Merger`
  (per-token share aggregation; method `mapping` writes the
  `{type, amount: share}` rows that become `tokens_map` entries).
- `datadealer/dd_app` `dd_app/dd_calc.py` — `Database.merge` (the
  weighted-average share formula, share validator `share<101 and share>-1`,
  `indicator` aggregator that informs the status-bar crosssum).
- `datadealer/dd_app` `dd_app/chargecollect.py` — `CollectableToken.
  getPerpChargeData` (`token_increment = result.amount - old_amount`,
  i.e. ProfileSet shares are *deltas* against the existing DB share, not
  values to be cumulatively added).
- `datadealer/dd_demo_en` `app/scripts/statusbar.js` + `globals.js` —
  unrelated demo of an `ImageBar` "risk" meter (#cd495d, not #E85E2B);
  confirms the demo had no equivalent of the production crosssum bar
  and that the orange colour in the live game belongs to the database /
  profiles theme, not to the demo's risk colour.
