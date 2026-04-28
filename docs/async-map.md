# dd_app Celery → idle-progression audit

Closes part of #3. Inventory of every Celery task in
[`datadealer/dd_app`](https://github.com/datadealer/dd_app) with its
scheduling sites, state I/O, socket emissions, wall-clock semantics, and a
porting verdict for the in-browser webxdc runtime (no timers; progress must
materialize lazily as a pure function of `(state, now)`).

Source revision: `master` (last commit on dd_app, 2018-12-17). All paths below
are relative to the dd_app repo.

## TL;DR

| Task | File:line | Verdict |
| --- | --- | --- |
| `chargePerpReady` | `dd_app/tasks/tasks.py:70` | ✅ trivially-pure |
| `notifyLevelupItems` | `dd_app/tasks/tasks.py:90` | ✅ trivially-pure |
| `notifyBuyperpItems` | `dd_app/tasks/tasks.py:104` | ✅ trivially-pure |
| `logAction` | `dd_app/tasks/tasks.py:117` | ❌ needs design (analytics sink) |
| `test` | `dd_app/tasks/tasks.py:65` | n/a — debug stub, drop |

There are **no recurring/periodic tasks** (no `celerybeat`, no `crontab`
schedule, no self-rescheduling tasks). Every task is one-shot, dispatched
inline from a JSON-RPC handler in `dd_app/views.py`. Only one task uses a
duration derived from rules data (`chargePerpReady`); the two `notify*` tasks
use a fixed 2 s cosmetic delay; `logAction` is fire-and-forget with no delay.

The wall-clock surface is therefore tiny: a single rules-driven duration
(`charge_time`) plus AP regeneration. AP regen is **not** a Celery task — it
is already computed on read in `dd_app/helpers.py::calculateAP` from
`(ap_snapshot, ap_update, levelinfo, now)`, which is exactly the idle-game
shape we want and is a useful template for the port.

---

## 1. `chargePerpReady`

**Defined**: `dd_app/tasks/tasks.py:70-88`.

### Scheduling
- **Site**: `dd_app/views.py:831-839`, inside the `chargePerp` JSON-RPC
  handler (the player presses "charge" on a perp node).
- **Trigger condition**: the `find_and_modify` that adds the path to
  `game.nodes_charging` succeeded (i.e. enough cash/AP, perp not already
  charging or collectable, lock check passed).
- **Wall-clock**: `apply_async(..., eta=eta)` where
  ```python
  dt_base  = utcnow()
  duration = node_type_data['charge_time'] / self.debug_charge_accel  # ms
  eta      = dt_base + timedelta(milliseconds=duration)
  ```
  `charge_time` is a static field on the perp's rules entry;
  `debug_charge_accel` is a per-session dev knob (1 in production).
  → **fixed delay derived from rules data, one-shot, never recurs**.

### Inputs (state read)
- `user_oid`, `auth_uid` — identifies the user/game.
- `node` — full node dict snapshot (`full_path`, `game_type`, `game_id`).
  Comment in source notes "safe to pass outdated data".
- `start` — `dt_base` (charge start timestamp).
- `result` — pre-computed reward payload from `chargecollect.py`
  (deterministic given pre-charge game state + rules).

### Outputs (state mutated)
On the user's `games` document (`dd_app/tasks/tasks.py:76-80`):
- `$pull` the `{path}` entry out of `nodes_charging`.
- `$push` `{path, result}` onto `nodes_collect`.

The corresponding write at charge-start (`views.py:776`) had stored
`{path, result, charge_start, charge_end}` on `nodes_charging`, so the
authoritative `charge_end` is **already on disk before the task runs**. The
task only flips the bucket.

### Socket emission
- Action `node_ready` (see `dd_app/messaging/messenger.py:75-83`), addressed
  to a single user (`user_send`). Payload:
  ```json
  {"id": "<game_id>", "type": "<game_type>", "path": "<full_path>", "result": <result>}
  ```
- Only fired if the bucket-flip actually matched a row (`resp.n > 0`), i.e.
  guards against double-emit if the worker retries.

### Verdict — ✅ trivially-pure
The whole task is `(start_ts, duration_ms) → emit at start+duration`. The
only persisted side-effect (`nodes_charging` → `nodes_collect`) is a label
change on data the client already has; collection itself is a separate
user-initiated RPC (`collectPerp`, `views.py:505`), so this task is purely
notification + bookkeeping.

**Port shape**: keep `nodes_charging[i] = {path, result, charge_start,
charge_end}` exactly as-is. On every read of game state:
1. For each entry where `now >= charge_end`, move it to `nodes_collect`.
2. If the entry transitioned _during this read_, enqueue a synthetic
   `node_ready` message for the UI.

No cap / accumulation problem: each charge is a discrete entry, the user
can already have many simultaneously, and there is no "auto-restart" — the
player must press charge again after collecting.

---

## 2. `notifyLevelupItems`

**Defined**: `dd_app/tasks/tasks.py:90-102`.

### Scheduling
- **Site**: `dd_app/views.py:106-114`, helper `_deferred_levelup`, called
  from any handler that processes a level-up (`integratePerp`,
  `collectPerp`, `chargePerp` after their `_handle_levelup` returns
  `levelup=True`).
- **Wall-clock**: `apply_async(..., countdown=2)` — flat **2-second cosmetic
  delay** so the level-up animation has time to run before the new-items
  toast appears. No rules data involved.

### Inputs (state read)
- `auth_uid`, `version`, `lang`, `level`, `current_nodes` (list of gestalts).
- Reads only **rules** (`RulesVersion.get_levelup_items(level)` and
  `get_levelup_powerups(level, current_nodes)`, see
  `dd_app/rules/__init__.py:101-113`). Both are pure functions of rules +
  args.

### Outputs
- **No DB write**.

### Socket emission
- Action `new_items` (`messenger.py:85-89`). Payload:
  ```json
  {"perps": [...], "powerups": {...}, "trigger": "levelup", "level": <int>}
  ```
- Only emitted if `perps or powerups` is non-empty.

### Verdict — ✅ trivially-pure
Pure function of `(rules, level, current_nodes)` with a cosmetic 2 s delay
that exists solely so the UI animation finishes first. In the port, run it
synchronously at the moment level-up is materialized (or `setTimeout(…, 2000)`
during a single open session — no persistence needed because the level-up
event itself is the trigger and is already persisted as the new XP/level on
game state).

---

## 3. `notifyBuyperpItems`

**Defined**: `dd_app/tasks/tasks.py:104-115`.

### Scheduling
- **Site**: `dd_app/views.py:117-127`, helper `_deferred_buyperp`, called
  from the `buyPerp` handler after a successful purchase **only** when the
  bought gestalt starts with `project` or `contact` (i.e. it's a provider
  that may unlock new consumers).
- **Wall-clock**: `apply_async(..., countdown=2)`. Same cosmetic 2 s delay.

### Inputs (state read)
- `auth_uid`, `version`, `lang`, `level`, `provider_gestalt`, `current_nodes`.
- Reads only rules: `RulesVersion.get_new_consumers_for_provider(...)`
  (`rules/__init__.py:122-125`).

### Outputs
- **No DB write**.

### Socket emission
- Action `new_items` (same channel as #2). Payload:
  ```json
  {"perps": [...consumer gestalts...],
   "trigger": "buy_provider",
   "level": <int>,
   "provider": "<provider_gestalt>"}
  ```
- Only emitted if `consumers` is non-empty.

### Verdict — ✅ trivially-pure
Same shape as `notifyLevelupItems`. Synchronous in the port; the 2 s delay
is purely UX timing.

---

## 4. `logAction`

**Defined**: `dd_app/tasks/tasks.py:117-139`.

### Scheduling
- **Sites** (all in `views.py`, all `apply_async` with no `countdown`/`eta`,
  i.e. fire-and-forget ASAP):
  - `:214` `newgame` — first-time game creation in `getGame`.
  - `:245` `loadgame` — every subsequent `getGame`.
  - `:256` `missiondone` — per completed mission, in `_log_mission_complete`.
  - `:266` `levelup` — in `_log_levelup`.
  - `:465` `integrate` — end of `integratePerp`.
  - `:490` `incident` — random "karma incident" roll in
    `_handleKarmaIncident`.
  - `:701` `collect` — end of `collectPerp`.
  - `:846` `charge` — end of `chargePerp`.
  - `:1118` `buypowerup` — end of `buyPowerup`.
  - `:1377` `buyperp` — end of `buyPerp`.

### Inputs
- `uid`, `action` (one of the 10 strings asserted at task line 123),
  `time`, plus a free-form `**kwargs` filtered against a fixed allow-list:
  `level, xp, lang, mission, active_missions, game_values, target, costs,
  gain, project, karma, origins, karmalizer`.

### Outputs
- Inserts a doc into `logdb[<action>]` (a separate analytics MongoDB,
  distinct from the gameplay `mongodb`). Ensures indexes on `uid`, `time`
  and (per action) `level` or `mission`.
- `KeyError` on missing `logdb` connector is silently swallowed → analytics
  is non-essential to gameplay correctness.

### Socket emission
- **None.** Pure server-side write to an analytics store.

### Wall-clock semantics
- No delay, no recurrence. Effectively a synchronous append from the user's
  perspective, just punted off the request thread.

### Verdict — ❌ needs design
Not a gameplay primitive — it is a **server-only analytics sink**. There is
no equivalent in a webxdc runtime: there is no shared analytics DB, the app
may be offline for days, and per-user data is the user's own. Options:

1. **Drop entirely (recommended for v1).** The gameplay code already
   tolerates `logdb` being absent (see `tasks.py:121` `except KeyError`).
   Remove all 10 call sites; nothing user-visible changes.
2. **Local ring buffer.** Append the same docs into an `action_log`
   collection in the local game state, capped (e.g. last N=500 events) for
   the player's own "history" UI. Pure, no clock dependency.
3. **Opt-in upload.** If the maintainer wants aggregate metrics, buffer
   locally and POST on a manual user action ("share stats"); never on a
   timer. Out of scope unless explicitly requested.

This is the only task where a porting decision changes user-visible
behaviour, hence the ❌ flag — but the decision is policy, not engineering
risk. There is no shared/cross-user state to reconstruct.

---

## 5. `test`

**Defined**: `dd_app/tasks/tasks.py:65-68`. Returns `x + y`. Not referenced
anywhere outside the tasks module. Drop on port.

---

## Cross-cutting notes

### What does `node_ready` actually unblock?
Looking at the `collectPerp` query (`views.py:540-548`), collect requires
the path to be present in `nodes_collect` and absent from `nodes_charging`.
The only writer that performs that move is `chargePerpReady`. So in the
current backend, **collection is gated on the Celery task having run**.
With a lazy materializer the gate becomes `now >= charge_end` instead of
"task ran" — which is strictly better (no worker backlog races) and
preserves the contract: the player still cannot collect early, and once
`charge_end` is past they can collect even if the app was closed for the
entire charge window.

### AP regeneration is already idle-game-shaped
For reference, not a Celery task: `dd_app/helpers.py::calculateAP` reads
`(ap_snapshot, ap_update, levelinfo, datenow)` and returns the current AP.
Persisted state is just a snapshot + timestamp; the regen rate
(`ap_inc_value` per `ap_inc_interval` ms, capped at `ap_max`) lives in
rules. There is even a Mongo `$where` clause at `views.py:809` that
recomputes the same formula server-side for atomic decrements. **Use this
shape for every duration-bearing mechanic in the port** — it is the
established idiom in dd_app and survives arbitrary offline gaps natively.

### What is *not* present in dd_app
- No periodic Celery beat schedule (grep confirms no `celerybeat`,
  `crontab`, `periodic_task`, or `add_periodic_task`).
- No task that re-schedules itself, no chained tasks (`chain`, `chord`,
  `group`).
- No task that reads or writes another user's game (no cross-user state).
- No task that consumes RNG seeded by server-side entropy in a way the
  client cannot reproduce: `chargePerpReady` is handed a pre-computed
  `result`; the only `random.choice` in the relevant flow
  (`_handleKarmaIncident`, `views.py:484`) runs **inside the JSON-RPC
  handler**, not inside a task.

That last bullet is the load-bearing finding for the port: nothing in the
async layer needs server-only randomness or cross-user reads. Every
verdict above is ✅ except the analytics sink, which is policy.
