# dd_app JSON-RPC handler inventory

Closes #2. Inventory of every JSON-RPC handler registered in
`dd_js/scripts/app.js:140-159`, mapped to its implementation in
[`datadealer/dd_app`](https://github.com/datadealer/dd_app) (Pyramid +
MongoDB + Redis + Celery, Artistic 2.0). Pure documentation pass — no code
ported.

Source revision: `master` (last commit on dd_app, 2018-12-17). All paths are
relative to the dd_app repo unless otherwise noted.

## TL;DR — handler table

> **Storage used by dd_app**: MongoDB (gameplay), Redis (session store). There
> is no Postgres in this repo — dd_app never opens a Postgres connection.
> Postgres lives in the separate `dd_auth` Django service that handles user
> accounts and mints `auth_uid`. The "DB reads/writes" columns below therefore
> only ever show Mongo or Redis.

| Method | File:line | Signature | DB reads | DB writes | Returns | Side effects |
| --- | --- | --- | --- | --- | --- | --- |
| `getToken` | `views.py:144` | `()` | Redis: Django session via cookie | — | session-cookie token string, or `HTTPForbidden` | none. **Not auth-gated** |
| `getSessionLocale` | `views.py:181` | `()` | Redis: Django session | — | locale string (`en`/`de`/…) | none. **Not auth-gated** |
| `ping` | `views.py:1479` | `()` | — | — | `"pong"` | none. **Not auth-gated** |
| `loadGame` | `views.py:194` | `(token, extra_types=True)` | Mongo: `users` (by `_id`), `games` (full doc; `mongo.get_game` upserts new) | Mongo: `games` (insert on first call) | full game doc + `type_registry` + `levels` + `karmalauters` + `karmalizers` + `missions` + `is_new_game`; `game_values.ap_initial` & `ap_offset` recomputed | Celery: `logAction('newgame'\|'loadgame')` |
| ~~`resetGame`~~ | _not ported_ | — | — | — | — | In webxdc each shared `.xdc` instance has independent state; reset = re-share the file. The handler UI was never wired in the post-strip codebase. |
| `setPerpCoordinates` | `views.py:278` | `(token, updates)` where `updates=[[path,{x,y}], …]` | — (writes only) | Mongo: `games.update` per entry, `$set nodes.$.instance_data.{x,y}` matched by `nodes.full_path` + `game_query_base` | int (count of updated docs) | none |
| `integrateCollected` | `views.py:320` | `(token, collect_id)` | Mongo: `games` (`db_queue.$`, `nodes`, `version`, `nodes_lock`, `game_values`, `mission_goals`, `active_missions`) | Mongo: `games.find_and_modify` ($pull `db_queue` by `collect_id`; $inc `xp_value`/`cash_value`/`karma_value`/`nodes_lock`; $set `nodes`, `profiles_value`, missions, ap snapshot; $push profile_sets) | `{result:{nodes,increment,dup}, game_values, [missions], [levelup]}` or `{error: 0\|1\|2}` | Celery: `logAction('integrate')`, optional `notifyLevelupItems` (countdown 2s), `logAction('missiondone'\|'levelup')` |
| `collectPerp` | `views.py:505` | `(token, path)` | Mongo: `games` (`nodes.$`, `version`, `game_values`, `nodes_collect`, `nodes_lock`, `mission_goals`, `active_missions`) | Mongo: `games.find_and_modify` ($pull `nodes_collect`; $inc `xp_value`/`karma_value`/`cash_value`/`nodes_lock`/`nodes.$.instance_data.amount`; $set ap snapshot, missions; $push `db_queue`) | `{result, game_values, [missions], [levelup], [karma_incident]}` or `{error: 1\|2\|3}` | Celery: `logAction('collect')`, optional `notifyLevelupItems`, `logAction('missiondone'\|'levelup'\|'incident')`. RNG: `_handleKarmaIncident` (see below) |
| `chargePerp` | `views.py:714` | `(token, path)` | Mongo: `games` (`nodes`, `version`, `nodes_lock`, `game_values`, `mission_goals`, `active_missions` — via `get_typedata_by_path` w/ `include_nodes=True`) | Mongo: `games.find_and_modify` ($set `nodes.$.instance_data.charge_start`/`last_upgrade_values`; $addToSet `nodes_charging`={path,result,charge_start,charge_end}; $inc `xp_value`/`cash_value`/`cash_spent`/`nodes_lock`; $set ap snapshot, missions) | `{game_values, duration, [missions], [levelup]}` or `{error: 1\|2}` | Celery: **`chargePerpReady` (eta=now+charge_time/debug_charge_accel)** writes the bucket-flip + emits `node_ready`; `logAction('charge')`; optional `notifyLevelupItems`, `logAction('missiondone'\|'levelup')`. RNG: `getVariatedAmount` (±5%) bakes into `charge_result` |
| `buySlots` | `views.py:860` | `(token, perp_full_path, slot_type, slots)` | Mongo: `games` (`nodes.$`, `version`, `nodes_lock`, `game_values`, `active_missions`) | Mongo: `games.find_and_modify` ($set `nodes.$.instance_data.<slot_type>_slots`; $inc `cash_value`/`cash_spent`/`nodes_lock`/`xp_value`) | `{node, game_values, [levelup]}` or `{error: 0\|1\|2\|3\|4}` | Celery: optional `notifyLevelupItems`, `logAction('levelup')` |
| `buyKarma` | `views.py:939` | `(token, karmalauter)` | Mongo: `games` (`version`, `nodes_lock`, `game_values`, `active_missions`) | Mongo: `games.find_and_modify` ($inc `xp_value`/`karma_value`/`cash_value`/`cash_spent`/`nodes_lock`) | `{game_values, [levelup]}` or `{error: 1\|2\|3\|4}` | Celery: optional `logAction('levelup')`. Note: no per-action `logAction` is emitted (unlike `buyPerp`/`buyPowerup`) |
| `buyPerp` | `views.py:1001` | `(token, parent_path, perp_gestalt)` | Mongo: `games` (`nodes`, `version`, `nodes_lock`, `game_values`, `mission_goals`, `active_missions`) | Mongo: `games.find_and_modify` ($push `nodes`/`db_queue`; $inc `xp_value`/`cash_value`/`cash_spent`/`karma_value`/`nodes_lock`/`profiles_max`; $set missions) | `{node, game_values, [missions], [levelup], [profile_set]}` or `{error: 1\|2\|3\|4}` | Celery: `logAction('buyperp')`, optional `notifyBuyperpItems` (countdown 2s, only for `project*`/`contact*`), `notifyLevelupItems`, `logAction('missiondone'\|'levelup')` |
| `getProvidedPerps` | `views.py:1130` | `(token, perp_full_path)` | Mongo: `games` (`nodes`, `version`, `game_values`) | — | `{buyable: [gestalt, …]}` or `{error: 0}` | none |
| `sellPowerup` | `views.py:1157` | `(token, perp_full_path, slot, powerup)` | Mongo: `games` (`nodes.$`, `version`, `nodes_lock`, `game_values`, `active_missions`) | Mongo: `games.find_and_modify` ($set `nodes.$.instance_data.{charge_cost,collect_amount,collect_risk,tokens,powerups}`; $inc `cash_value` (sell at 0.75×)/`xp_value`/`nodes_lock`) | `{node, game_values, [levelup]}` or `{error: 0..4}` | Celery: optional `notifyLevelupItems`, `logAction('levelup')` |
| `buyPowerup` | `views.py:1250` | `(token, perp_full_path, slot, powerup)` | Mongo: `games` (`nodes.$`, `version`, `nodes_lock`, `game_values`, `mission_goals`, `active_missions`) | Mongo: `games.find_and_modify` ($push `nodes.$.instance_data.powerups`; $set `nodes.$.instance_data.{charge_cost,collect_amount,collect_risk,tokens}`/missions; $inc `xp_value`/`cash_value`/`cash_spent`/`karma_value`/`nodes_lock`; $push `db_queue`) | `{node, game_values, [missions], [levelup]}` or `{error: 0..4}` | Celery: `logAction('buypowerup')`, optional `notifyLevelupItems`, `logAction('missiondone'\|'levelup')` |
| `getPowerups` | `views.py:1390` | `(token, project_type, version)` | rules only (in-memory `RulesVersion`) | — | list of powerup defs for the project type | none |
| `setDisplayName` | `views.py:1420` | `(token, display_name)` | — | Mongo: `users` ($set `display_name`, after `helpers.validateDisplayName`) | `True` or `{error: 0\|1}` | none |
| `getRanking` | `views.py:1443` | `(token, val_type)` where `val_type ∈ {xp, cash, profiles, spent}` | Mongo: `games` (top values, rank), `users` (display names map) | — | `{top:[{display_name,value,self}], user_rank}` or `{error: 0}` | none. **Cross-user read** (only handler that does this) |
| `checkUsername` | **NOT IN dd_app** | `(username)` | — | — | (separate auth service) | Lives in the separate `dd_auth` Django service; the JS client points at `setup.jsonRpcAuthUrl` for this call. Out of scope for the dd_app port. |

Method `userData` (`views.py:164`), `logout` (`views.py:1464`), and
`getTokens` (`views.py:1406`) exist server-side but are not in the issue's
list. They're real RPC endpoints; flagged here for completeness but not
detailed below.

> **`buyKarma` missions discrepancy — resolved (issue #59):**
> `views.py:939-1000` confirms `buyKarma` never instantiates `MissionHandler`
> and returns only `{game_values, [levelup]}` — no `missions` key. The earlier
> draft of `docs/response-shapes.md` over-specified this by analogy with
> `buyPerp`; that error has been corrected. LocalEngine must **not** return a
> missions payload for `buyKarma`.

---

## Auth model — what becomes `webxdc.selfAddr`?

`base_handler.BaseHandler` (`base_handler.py:14-149`) is the mixin used by
every JSON-RPC view. The relevant chain:

1. **Cookie → Redis → session dict.** `get_session_cookie()` reads
   `settings['session.cookie_id']`, looks up the value in Redis under
   `session:<cookie>`, decodes it via `session_codec` (Django session codec
   re-implementation in `django_codec.py`). Returns `(session_dec, auth_uid)`
   — the second item is the user identifier minted by the upstream
   `dd_auth` service. (`base_handler.py:68-90`)
2. **`auth_uid` is the only stable identity.** `auth_uid` is a string. It
   lives on the user document as `users.auth_uid` and is the single key by
   which `mongo.get_user_by_auth_uid` looks them up
   (`base_handler.py:94, 98-99`).
3. **`game_query_base`** (`base_handler.py:108-114`) returns
   `{'user.$id': <users._id>, 'version': <user.game_version>}`. Every
   gameplay handler scopes its Mongo reads/writes by this base (`games.user`
   is a `DBRef` to `users`). The `_id` linkage is internal — the *external*
   identity is still `auth_uid`.
4. **`@dd_protected`** (`base_handler.py:152-160`) is the gating decorator
   wrapping every handler whose first arg is `token`. It raises
   `JsonRpcUnauthorized` unless `auth_uid is not None`. The three handlers
   *without* `token` — `getToken`, `getSessionLocale`, `ping` — are the only
   ones not gated.

### Mapping to webxdc

In a webxdc port:
- **`auth_uid` ⇒ `webxdc.selfAddr`.** This is the field we key everything
  on in the local engine. Replace `users.auth_uid` and the
  `mongo.get_user_by_auth_uid` lookup with `selfAddr` directly; there is no
  longer a separate `users._id`/`games.user.$id` indirection because the
  state is single-tenant per webxdc instance.
- **Token / session machinery is dead.** `getToken`, `getSessionLocale`,
  `logout`, `userData`, the cookie roundtrip, the Redis session store, and
  the `token` first-arg on every handler can be dropped. The client already
  has `webxdc.selfAddr` synchronously at boot.
- **`@dd_protected` collapses to a no-op.** Every handler runs in the
  caller's own context; there is no cross-user reach.
- **`getRanking` is the one cross-user read.** It pulls top-N players from
  `users` + `games` collections — no equivalent exists in a webxdc runtime.
  Either drop it, or build a status-broadcast leaderboard later (out of
  scope for #2).
- **`checkUsername` is in `dd_auth`, not `dd_app`.** The JS client routes
  it to `setup.jsonRpcAuthUrl` (a separate Django service). webxdc has no
  username concept — drop this entirely; `selfAddr` is the identity.

---

## MongoDB document shapes

Two databases: `mongodb` (gameplay) and `logdb` (analytics, optional —
already documented in `docs/async-map.md` as drop-on-port).

### `users` collection
| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | internal PK; referenced by `games.user.$id` |
| `auth_uid` | string | minted by `dd_auth`; **becomes `webxdc.selfAddr`** |
| `game_version` | int \| null | rules version pin; null = use whatever the game doc says |
| `display_name` | string | settable via `setDisplayName`; surfaced in `getRanking` |

### `games` collection (the big one)
One doc per `(user, version)` pair. All fields are embedded — there are no
nested collections.

| Field | Type | Notes |
| --- | --- | --- |
| `_id` | ObjectId | |
| `user` | DBRef → `users` | scoped via `game_query_base` `{'user.$id': oid}` |
| `version` | int | rules version |
| `nodes` | array | the perp/token/contact/project tree. Each entry: `{game_type, full_type, gestalt, game_id, full_path, instance_data}` |
| `nodes_charging` | array | `{path, result, charge_start, charge_end}` — populated by `chargePerp`, drained by Celery `chargePerpReady` |
| `nodes_collect` | array | `{path, result}` — populated by `chargePerpReady`, drained by `collectPerp` |
| `db_queue` | array | profile-set queue, `{origin, collect_id, profile_set, collect_dt}` — populated by `collectPerp`/`buyPerp`, drained by `integrateCollected` |
| `game_values` | object | see below |
| `mission_goals` | array | mission progress; mutated by `MissionHandler` |
| `active_missions` | array | currently-active mission IDs |
| `nodes_lock` | int | **optimistic-concurrency counter** — every mutating handler `$inc`s it by 1 and re-asserts the prior value in `find_and_modify`'s query, so concurrent writers race-fail rather than clobber |

`nodes[i]` shape (from `chargePerp`/`buyPerp`/`integrateCollected` reads):
- `game_type ∈ {CityPerp, ContactPerp, ProjectPerp, TokenPerp, ClientPerp, AgentPerp, …}`
- `full_type` = `"<game_type>:<gestalt>"`, e.g. `"ContactPerp:Agent0"`
- `gestalt` = the rules-key suffix
- `game_id` = stringified ObjectId
- `full_path` = dot-separated ancestry, e.g. `"Imperium.CityVienna.Agent0.Contact3"`
- `instance_data` = mutable per-node bag: `x`, `y`, `amount`,
  `charge_start`, `charge_cost`, `collect_amount`, `collect_risk`, `tokens`,
  `powerups: [{slot, gestalt, full_type}]`, `<type>_slots`,
  `last_upgrade_values`, …

`game_values` shape (frequently mutated by `$inc`):
- `xp_value`, `xp_level`, `cash_value`, `cash_spent`, `karma_value`
  (clamped −100…100), `profiles_value`, `profiles_max`
- `ap_snapshot` (int) and `ap_update` (datetime) — together they encode AP
  via `helpers.calculateAP(snapshot, update, levelinfo, datenow)`. AP is
  **never persisted in real time**; it is recomputed on every read and
  every server-side write check (see anti-cheat below). `ap_initial` and
  `ap_offset` are added on read by `loadGame`/handlers; never stored.

### `logdb` (analytics)
One collection per action name (`newgame`, `loadgame`, `levelup`,
`missiondone`, `integrate`, `incident`, `collect`, `charge`, `buyperp`,
`buypowerup`). Detailed in `docs/async-map.md §4`. Verdict: drop on port —
gameplay is correct without it.

---

## RNG, anti-cheat, and rate-limiting

### Server-only RNG

| Source | Site | What it does |
| --- | --- | --- |
| `helpers.WeightedRandomizer` | `views.py:483` (`_handleKarmaIncident`) | Weighted Bernoulli on whether to fire a karma incident at all, using `factor = ((-karma)/100)^0.5` plus 0.05 padding |
| `random.choice` | `views.py:489` (`_handleKarmaIncident`) | Picks one karmalizer uniformly from `[k for k in rules.karmalizers if level >= k.required_level]` |
| `random.random` | `chargecollect.py:19-22` (`getVariatedAmount`) | ±5% jitter on collect amounts, baked into the `charge_result` written to `nodes_charging` at charge-start (so the server commits to the value before the timer runs) |

Note: there is no shared/cross-user randomness, no daily seed, no
server-only entropy that the client cannot reproduce. The randomness is
gameplay flavor, fully reproducible client-side with any PRNG.

### Anti-cheat

The dd_app server doesn't trust the client and re-checks every economy
constraint at write time:

1. **Optimistic locking via `nodes_lock`.** Every handler that mutates the
   node tree reads `nodes_lock`, then asserts the same value in the
   `find_and_modify` query while `$inc`-ing it. Concurrent mutations from
   the same user race-fail with the canonical `BUBU` error code (3 or 4
   depending on handler).
2. **Server-side AP `$where` clause.** `integrateCollected` (`views.py:443`),
   `collectPerp` (`views.py:684`), `chargePerp` (`views.py:807`) all attach a JS `$where` that
   recomputes the AP formula from `(ap_snapshot, ap_update, now, levelinfo)`
   server-side and rejects the write if AP < cost. Bypasses any
   client-supplied AP value.
3. **Cash floor in query.** `buySlots`, `buyPerp`, `buyPowerup` add
   `'game_values.cash_value': {'$gte': price}` to `query_find` so a stale
   client cash view can't trigger an over-spend.
4. **`collectPerp` two-state gate.** Requires `nodes_collect.path == path`
   AND `nodes_charging.path != path` — only the `chargePerpReady` worker
   flips the bucket, so a client cannot collect early.
5. **`game_query_base` always scopes by user.** Every handler's query
   includes `{'user.$id': self.userdata['_id']}`, so a client-supplied
   `path`/`collect_id` can only ever match the caller's own game.

### Rate limiting

**None at the handler level.** No per-IP, per-user, or per-method throttling
exists in `dd_app` (no `pyramid_ratelimit`, no Redis token bucket, no
nginx-level config in the repo). Rate-limiting is implicit via `nodes_lock`
(only one in-flight mutation per user) and the AP / cash economy itself.

### Mirror-or-skip notes for the port

Per the issue's "any RNG, anti-cheat, or rate-limiting we'll need to mirror
(or deliberately skip)" requirement, the verdicts are:

- Items 1, 2, 3 (`nodes_lock`, AP `$where`, cash-floor query): **skip** —
  they exist to defend against an untrusted concurrent writer. In a webxdc
  runtime the local engine is the only writer.
- Item 4 (`collectPerp` two-state gate): **mirror** — it's a real gameplay
  invariant (can't collect before charge finishes), not just a defense.
  Becomes a `now >= charge_end` check in the lazy materializer (see
  `docs/async-map.md §1`).
- Item 5 (`game_query_base` user scoping): **N/A** — single-tenant.
- RNG (3 sources above): **mirror** — gameplay flavor, fully reproducible
  client-side.
- Rate limiting: **N/A** — none exists server-side anyway.
- `getRanking` and `logAction`: skipped (cross-user / analytics — see
  `docs/async-map.md §4`).

---

## Cross-references

- **Celery tasks** scheduled by these handlers: `docs/async-map.md` (issue #3).
- **Socket emits** triggered downstream of these handlers: `docs/socket-events.md`.
- **Response shapes consumed by the JS client**: `docs/response-shapes.md`
  (issue #4). Each row in the table above lists the server return shape;
  thread B's response-shapes doc lists the *consumed* fields. A follow-up
  cross-check should diff the two — anything in the server return that
  isn't in response-shapes is dead weight on the wire and can be dropped
  in the port.
