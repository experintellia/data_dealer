# RPC Response Shapes (Game.js consumer audit)

Phase-1 research output for issue #4. For each `app.remote.X(...)` call in
`scripts/Game.js`, `scripts/app.js`, and `scripts/bootstrap.js`, this document
records exactly which fields of the resolved `data` value are read by the
`.done(...)` / `.then(...)` callback. The LocalEngine port (Phase 3) MUST
return responses that satisfy at least these field accesses; anything not
listed here is currently dead weight.

Conventions:

- The transport is JSON-RPC. Unless noted, every response is wrapped as
  `{ result: <payload>, error?: { code, message }, ... }`. Fields below are
  named relative to the wrapped payload at `data.result` (with the exception of
  `data.error` for failure paths).
- `error !== undefined` inside `data.result` is the app-level "soft" error
  (e.g. "no cash"), distinct from the JSON-RPC `data.error` envelope.
- Call sites use `app.token` as the first arg in every method except
  `getToken`, `getSessionLocale`, `checkInvitationToken`, `checkUsername`,
  `logout`, and `ping`.
- `game_values` / `levelup` / `missions` triples returned by mutation handlers
  are consumed via `GameRoot.updateGameValues` (scripts/Game.js:1744). Their
  shapes are documented once in the **Common payloads** section and referenced
  from each method.

Cross-check note: `docs/handler-map.md` (issue #2) has landed. All five open
questions from the original audit are resolved; see the §Open questions section
for the full reconciliation. The `buyKarma` missions discrepancy called out in
handler-map.md is fixed in this document.

---

## Common payloads

### `game_values` (consumed in GameRoot.updateGameValues, Game.js:1744)

```text
{
  profiles_max?: number,
  profiles_value?: number,
  cash_value?: number,
  ap_increment?: number,
  ap_snapshot?: number,        // synced into the visible AP whenever it
                               //   differs from the local ap_value (so the
                               //   bar tracks engine state after every
                               //   AP-consuming handler, not only on levelup)
  karma_value?: number,
  xp_value?: number
}
```

All fields are optional; `updateGameValues` skips any that are `undefined`.

### `levelup` (consumed in GameRoot.updateGameValues)

A boolean flag. When `=== true` AND `game_values.ap_snapshot` is set, the
client snaps AP and emits a level-up notification (uses the locally-tracked
`xp_level.number`).

### `missions` (consumed in Missions.updateMissions, Game.js:3480)

```text
{
  complete_missions?: string[],   // gestalt ids, marked complete + inactive
  updated_missions?: string[],
  mission_data?: {
    active_missions?: string[],
    mission_goals?: Array<{
      amount: number,
      current_amount: number,
      goal_id: string,
      mission: string,            // mission gestalt
      position: number,
      project: string | null,
      target: string,             // gestalt id
      workflow: string,           // e.g. "collect_profiles"
      complete?: boolean
    }>
  },
  rewards?: {
    cash_value?: number,
    karma_value?: number,
    xp_value?: number,
    profile_sets?: Array<{
      profile_set: ProfileSet,
      origin: string,             // path
      collect_id: string
    }>
  }
}
```

### `node` (returned by buyPerp / buyPowerup / sellPowerup / buySlots)

```text
{
  game_id: string,
  game_type: string,              // key into Game[node.game_type] constructor
  full_path: string,
  instance_data: object           // merged with type_data via mergeData()
}
```

`buyPerp` consumers also place the new node, so they read
`gnode.data.contained_tokens[].is_required/.gestalt` from the merged data,
but those fields come from local `type_data`, not the response.

### `profile_set` (queue payload)

Used by `Database.cue` (Game.js:2432). Each callsite passes the triple
`(profile_set, origin, collect_id)` to `cue`. Inside `ProfileSet`
(Game.js:2083):

```text
{
  profiles_value: number,
  tokens_map: { [gestalt: string]: { amount: number, ... } }
}
```

`origin` is a node path (string); `collect_id` is the queue entry id.

---

## Methods

### getToken

- Registered: scripts/bootstrap.js:29, scripts/bootstrap.js:132,
  scripts/app.js:150
- Args: `()`
- Called from:
  - scripts/bootstrap.js:103 (route `load`)
  - scripts/bootstrap.js:194 (sign_out fallback)
  - scripts/app.js:166 (initial app boot)
  - scripts/Game.js:893 (GameRoot.refresh)

Expected response shape:

```text
{
  result: string                  // opaque session token; empty/falsy ⇒ "no token"
}
```

Failure path (bootstrap.js:108): reads `data.error.code === -32403` and
`data.error.message`.

### getSessionLocale

- Registered: scripts/app.js:146
- Args: `()`
- Called from: scripts/app.js:173, scripts/Game.js:899

Expected response shape:

```text
{
  result: "de" | string           // any value other than "de" maps to "en_US"
}
```

### loadGame

- Registered: scripts/app.js:151
- Args: `(token)`
- Called from: scripts/app.js:182, scripts/Game.js:909
- Consumed at Game.js:1875 (`GameRoot.prototype.loadGame`).

Expected response shape (`data.result`, alias `gameData`):

```text
{
  version: string,                // stored on app.version (used by getPowerups args)
  _id: string,
  type_registry: { [gestalt: string]: TypeDef },
  type_data: object,              // GameRoot type_data
  user: {
    auth_username: string,
    auth_fullname?: string,
    display_name?: string,
    ...                           // pass-through to popups, see views/popup_user_data.html
  },
  Imperium: {
    game_id: string,
    full_path: string,
    instance_data: object,
    type_data: object
  },
  Database: {
    game_id: string,
    full_path: string,
    instance_data: object,
    type_data: object
  },
  nodes: Array<{
    game_id: string,
    game_type: string,
    full_path: string,
    full_type: string,
    gestalt?: string,             // computed from full_type if absent
    instance_data: object,
    type_data: object
  }>,
  nodes_charging: Array<{
    path: string                  // last-id lookup key
  }>,
  nodes_collect: Array<{
    path: string
  }>,
  db_queue: Array<{
    profile_set: ProfileSet,
    origin: string,
    collect_id: string
  }>,
  karmalauters: { [k: string]: { type_data: { gestalt: string, ... }, game_type: string, ... } },
  karmalizers:  { [k: string]: { type_data: { gestalt: string, ... }, game_type: string, ... } },
  server_time: { $date: number }, // ms since epoch (extJSON)
  is_new_game?: boolean,          // truthy ⇒ scroll Imperium to top
  active_missions?: string[],     // also consumed via missions.mission_data
  missions: Array<{
    gestalt: string,
    type_data: { gestalt: string, ... }
  }>,
  mission_goals?: Array<MissionGoal>
}
```

Notes:
- `data` itself (the `gameData`) is stashed as `raw_data` on GameRoot
  (Game.js:1906) and is consulted later for `nodes` (token lookup) and
  `server_time`.
- The "missions"/"active_missions"/"mission_goals" fields are forwarded to
  `Missions.initMissions` (Game.js:3360) — that handler also reads
  `raw_data.mission_goals` directly.

### setPerpCoordinates

- Registered: scripts/app.js:157 (queued: `Remote.NEEDS_QUEUE`-equivalent flag
  is set on the call site at Game.js:976 via `rpcQueue.addCall`).
- Args: `(token, [[path, pos], ...])`
- Called from:
  - scripts/Game.js:976 (queued, via `rpcQueue.addCall('setPerpCoordinates', ...)`)
  - scripts/Game.js:982 (fire-and-forget; result discarded)

Expected response shape:

```text
{
  result: 1 | true | any          // success indicator; the inline call discards
                                  // it, the queue callback only logs data.result
}
```

The comment at Game.js:981 calls out that the non-queued variant returns
`result: 1` even on failures; LocalEngine should still return a positive
acknowledgement to keep the queue draining.

### buyKarma

- Registered: scripts/app.js:147
- Args: `(token, bgestalt)`
- Called from: scripts/Game.js:1503 (`GameRoot.BuyKarma`)

Expected response shape:

```text
{
  result: {
    error?: number,               // present ⇒ "probably no cash"; treated as soft fail
    game_values: GameValues,
    levelup: boolean
  }
}
```

If `result` is falsy or unparsable, the client calls `gnode.Error('The
computer says NOOOO', data)`.

Note: `missions` is NOT returned by `buyKarma`. Per `handler-map.md`
(`views.py:939-1000`), `buyKarma` never instantiates `MissionHandler` and
returns only `{game_values, [levelup]}`. The earlier draft of this document
over-specified by analogy with `buyPerp`. LocalEngine MUST NOT include a
missions payload for `buyKarma`.

### buyPerp

- Registered: scripts/app.js:148
- Args: `(token, gnode.path, bgestalt)`
- Called from:
  - scripts/Game.js:2348 (`Database.BuyToken`)
  - scripts/Game.js:3093 (`GamePerp.BuyPerp`)
  - scripts/Game.js:3736 (`DatabasePerp.BuyCity`)

Expected response shape:

```text
{
  result: {
    error?: number,               // 2 ⇒ no cash; 3 (proxy) ⇒ "proxy slots full"
    game_values: GameValues,
    levelup: boolean,
    missions: MissionsPayload,
    node: NodePayload,            // see Common payloads
    profile_set?: {               // ONLY emitted by city-buy path (Game.js:3807)
      profile_set: ProfileSet,
      origin: string,
      collect_id: string
    }
  }
}
```

LocalEngine note: the city-buy path (parent gameType is `DatabasePerp`) is the
only callsite that reads `data.result.profile_set`; for the other two
callsites that field is unused and may be omitted.

### integrateCollected

- Registered: scripts/app.js:143 (queued: `Remote.NEEDS_QUEUE`)
- Args: `(token, psid)`
- Called from: scripts/Game.js:2486 (`Database.mergeCued`)

Expected response shape:

```text
{
  result: {
    error?: number,               // present (incl. 0) ⇒ "no AP"
    game_values: GameValues,      // .profiles_value, .karma_value at minimum
    result: {
      increment: number,          // profiles_increment (declared but not used downstream)
      dup: number,                // profiles_dup (declared but not used downstream)
      nodes: Array<{
        game_id: string,
        gestalt: string,
        full_path: string,
        instance_data: { amount: number, ... }
      }>
    }
  }
}
```

Note: `levelup` and `missions` are NOT read by the client (the call at
Game.js:2502 is commented out); only `setProfiles(game_values.profiles_value)`
is invoked directly. The server-side handler (`views.py:320`) DOES emit
`[missions]` and `[levelup]` when mission/level thresholds are crossed — the
client drops them on the floor. LocalEngine MUST still emit them for parity
with the real server; see handler-map.md §integrateCollected.

### resetGame

- Registered: scripts/app.js:155
- Args: `(token)`
- Called from: scripts/Game.js:2975, scripts/Game.js:3055

Expected response shape: callbacks ignore `data` entirely and run
`location.reload()`. Any 200 response with truthy result is acceptable.

```text
{
  result: any
}
```

### setDisplayName

- Registered: scripts/app.js:152
- Args: `(token, dname)`
- Called from: scripts/Game.js:2991 (`GameRoot.saveDisplayName`)

Expected response shape:

```text
{
  result: {
    error?: any                   // any defined value ⇒ failure path
  }
}
```

Success path mutates client-side `groot.data.user.display_name = dname`
locally; the response carries no payload beyond the success/error discriminator.
Failure path also reads `data` only for the console.error log.

### getRanking

- Registered: scripts/app.js:153
- Args: `(token, type)` — `type` is one of `cash | profiles | xp | spent`
  (icon map at views/topscore_list.html:4).
- Called from: scripts/Game.js:3306 (`Topscore.fetchScore`)

Expected response shape (merged into `gnode.data` via `mergeData`):

```text
{
  result: {
    error?: any,                  // defined ⇒ failure (logs only)
    top: Array<{
      self?: boolean,             // marks current user
      display_name: string,
      value: number,
      // Webxdc-port additions (#30): the LocalEngine peer aggregator
      // populates these so the row template can address peers by addr,
      // and dim rows whose last delta is older than the stale threshold.
      addr?: string,              // peer addr — used as data-testid suffix
      last_seen_ts?: number,
      stale?: boolean             // true ⇔ now - last_seen_ts > 7 days
    }>,
    user_rank: number             // 0..1, multiplied by 100 for "%"
    // type_texts, type_texts_notinranking, type_titles are NOT server-provided.
    // handler-map.md (views.py:1443) confirms the server returns only {top, user_rank}.
    // All three fields originate from local type_data; LocalEngine must NOT emit them.
  }
}
```

`user_in_top` is computed locally as `_.findWhere(top,{self:true}) !==
undefined` (Game.js:3309) — backend should NOT send it.

### getProvidedPerps

- Registered: scripts/app.js:145
- Args: `(token, gnode.path)`
- Called from: scripts/Game.js:3955 (`*.fetchProvided` — agent/proxy/etc.)

Expected response shape:

```text
{
  result: {
    buyable: Array<ProvidedPerp>  // assigned to gnode.data.buyablePerps
  }
}
```

Each `ProvidedPerp` element is consumed by the `popup_*_provided` templates as
gestalt-keyed metadata; the only field-name access at this callsite is
`data.result.buyable` itself. (Per-item shape lives in templates and
type_data; out of scope for this audit.)

Failure callback (line 3965) does not read `data`.

### chargePerp

- Registered: scripts/app.js:141
- Args: `(token, gnode.path)`
- Called from:
  - scripts/Game.js:4182 (ContactPerp.charge-equiv)
  - scripts/Game.js:4595 (ClientPerp.Charge)
  - scripts/Game.js:5160 (ProjectPerp.Charge)
  - scripts/Game.js:5447 (TokenPerp.Charge)

Expected response shape:

```text
{
  result: {
    error?: any,                  // truthy ⇒ "no cash" / "no AP" depending on caller
    game_values: GameValues,
    levelup: boolean,
    missions: MissionsPayload,
    duration: number              // ms; passed to gnode.markTimer({duration, ...})
  }
}
```

`serverTime` and `serverStartTime` are passed in to `markTimer` as `0` at all
four callsites — the backend is NOT expected to provide them on charge;
loadGame's `nodes_charging` is the path that DOES need real timestamps (via
`game.raw_data.server_time.$date` and `gnode.data.charge_start.$date`).

### collectPerp

- Registered: scripts/app.js:142 (queued: `Remote.NEEDS_QUEUE`)
- Args: `(token, gperp.path)`
- Called from:
  - scripts/Game.js:4232 (ContactPerp.collect)
  - scripts/Game.js:4511 (ClientPerp.collect)
  - scripts/Game.js:5210 (ProjectPerp.collect)
  - scripts/Game.js:5512 (TokenPerp.collect)

The shape is **caller-discriminated**: contact/project return profile-set
payloads, client returns cash, token returns an upgraded amount.

Expected response shape (union):

```text
{
  result: {
    error?: any,                  // truthy ⇒ "no AP" branch
    game_values: GameValues,      // .karma_value used for FXKarmaBling delta
    levelup: boolean,
    missions: MissionsPayload,
    karma_incident?: string,      // gestalt of karmalizer; absent on neutral collect
    result: {
      // ContactPerp + ProjectPerp variants:
      profile_set?: ProfileSet,   // forwarded to Database.cue
      origin?: string,
      collect_id?: string,

      // ClientPerp variant:
      cash?: number,              // displayed as "$N"

      // TokenPerp variant:
      token_upgraded_amount?: number  // assigned via gperp.setAmount(amount)
    }
  }
}
```

LocalEngine MUST branch on the calling perp's `gameType` to populate the
correct subset; cross-mixing (e.g. emitting `cash` for a TokenPerp) will
silently fall through to the `gperp.Error('NOOOO')` path because the consumer
checks `data.result.result` truthiness, then accesses one specific field.

### getPowerups

- Registered: scripts/app.js:144
- Args: `(token, project_gestalt, app.version)`
- Called from:
  - scripts/Game.js:4750 (ProjectPerp.fetchPowerups — currently unreachable;
    see early `return` at 4746, but the literal call exists)
  - scripts/Game.js:4774 (`GameRoot.fetchProjectPowerupData`, cached path)
  - scripts/Game.js:4790 (same, uncached path)

Expected response shape:

```text
{
  result: Array<{
    game_gestalt: string,         // key under which the type is registered
    game_type: string,
    type_data: { gestalt: string, ... }
  }>
}
```

Each element is fed to `groot.addSubType(project_gestalt, v.game_gestalt, v)`
(or `gnode.addType` in the dead branch). The full element is treated as a
TypeDef; `addType` requires `game_type` and `type_data` (Game.js:702-704). The
client never inspects `result` further.

### buyPowerup

- Registered: scripts/app.js:140
- Args: `(token, gnode.path, bslot, bgestalt)`
- Called from: scripts/Game.js:4958 (`ProjectPerp.BuyPowerup`)

Expected response shape:

```text
{
  result: {
    error?: number,               // 3 ⇒ no cash; any other defined ⇒ generic "NOOOO"
    game_values: GameValues,
    levelup: boolean,
    missions: MissionsPayload,
    node: { instance_data: object, ... }   // merged into gnode.data via mergeData
  }
}
```

Failure handler (line 4983) also reads `data.error.message` from the JSON-RPC
envelope.

### sellPowerup

- Registered: scripts/app.js:156
- Args: `(token, gnode.path, parseInt(bslot), bgestalt)`
- Called from: scripts/Game.js:4997 (`ProjectPerp.SellPowerup`)

Expected response shape:

```text
{
  result: {
    error?: any,                  // truthy ⇒ generic error path
    game_values: GameValues,
    levelup: boolean,
    missions: MissionsPayload,
    node: { instance_data: object, ... }   // merged with type_data, then assigned
  }
}
```

Note the merge target differs from `buyPowerup`: sell rewinds to
`mergeData(groot.getTypeData(gnode.gestalt), node.instance_data)` (line 5005),
so `instance_data` SHOULD reflect the post-sell state of the project node.

Dead-weight note: `missions` is listed above because the consumed callback
path passes through `updateGameValues`, but per `handler-map.md`
(`views.py:1157`), `sellPowerup` never invokes `MissionHandler` and never
emits `missions`. The field is always absent in real responses. LocalEngine
can omit `missions` for this method.

### buySlots

- Registered: scripts/app.js:149
- Args: `(token, gnode.path, pcat, num)` where `pcat` is one of
  `ad`/`upgrade`/`teammember` and `num` is the page count.
- Called from: scripts/Game.js:5033 (`ProjectPerp.BuySlots`)

Expected response shape:

```text
{
  result: {
    error?: any,                  // truthy ⇒ NoCash branch
    game_values: GameValues,
    levelup: boolean,
    missions: MissionsPayload,
    node: { instance_data: object, ... }   // mergeData into gnode.data
  }
}
```

Failure handler (line 5052) also reads `data.error.message`.

Dead-weight note: `missions` is listed above because the consumed callback
path passes through `updateGameValues`, but per `handler-map.md`
(`views.py:860`), `buySlots` never invokes `MissionHandler` and never emits
`missions`. The field is always absent in real responses. LocalEngine can
omit `missions` for this method.

---

## Auth-channel methods (bootstrap.js)

These hit `setup.jsonRpcAuthUrl` rather than the game socket and are listed
here for completeness. The handler-map cross-check should confirm they're
flagged auth-only.

### checkInvitationToken

- Registered: scripts/bootstrap.js:130
- Args: `(token, callback)` — direct positional callback, NOT `.done()`.
- Called from: scripts/bootstrap.js:221

Expected response shape:

```text
{
  result: boolean | truthy        // truthy ⇒ "valid"
}
```

The redirect uses `data ? '#sign_up' : '#access_denied'`, comparing the entire
envelope; in practice any 200 response with `result` set is treated as valid.

### logout

- Registered: scripts/bootstrap.js:131
- Args: `(token)`
- Called from: scripts/bootstrap.js:195

Response is ignored on success — callback runs `location.href = '/'`.
Failure path also ignores `data`.

### checkUsername

- Registered: scripts/app.js:159
- No callsite in the audited files.
- **Resolved:** `handler-map.md` confirms `checkUsername` is NOT in `dd_app`
  — it lives in the separate `dd_auth` Django service (the JS client routes it
  to `setup.jsonRpcAuthUrl`). Drop this method entirely from the LocalEngine
  port; `webxdc.selfAddr` is the identity, so username checking has no
  equivalent.

### ping

- Registered: scripts/app.js:154
- No `.done()` callsite in the audited files.
- **Resolved:** `handler-map.md` (`views.py:1479`) confirms `ping` is a real
  endpoint that returns `"pong"` (not auth-gated). It is used by RpcQueue as a
  keepalive, not a game-logic call. LocalEngine must implement it:

```text
{
  result: "pong"
}
```

---

## Open questions / discrepancy candidates

All five original questions are resolved via `docs/handler-map.md`.

1. **`setPerpCoordinates` — Resolved.** `handler-map.md` (`views.py:278`)
   confirms the server persists every entry via Mongo `$set` per path and
   returns an `int` count of updated docs. The Game.js:981 comment reflects an
   earlier client-side concern, not a handler bug. The current response shape
   (`result: 1 | true | any`) is correct; the client discards the value.
   LocalEngine should return `{ result: 1 }`.

2. **`integrateCollected` — Resolved.** `handler-map.md` (`views.py:320`)
   confirms the server DOES emit `[missions]` and `[levelup]` when
   mission/level thresholds are crossed. The client drops them (call at
   Game.js:2502 is commented out). LocalEngine MUST still emit them for parity
   with the real server. See updated note in the `integrateCollected` section
   above.

3. **`collectPerp` payload union — Resolved.** `handler-map.md` (`views.py:505`)
   confirms the server dispatches on the node's `game_type` (ContactPerp /
   ProjectPerp → `profile_set`; ClientPerp → `cash`; TokenPerp →
   `token_upgraded_amount`). LocalEngine must branch on the calling perp's
   `gameType`; see the `collectPerp` section above.

4. **`getRanking` `type_texts` — Resolved.** `handler-map.md` (`views.py:1443`)
   confirms the server returns only `{top:[{display_name, value, self}],
   user_rank}`. `type_texts`, `type_texts_notinranking`, and `type_titles` are
   NOT server-provided — they originate from local `type_data`. LocalEngine
   MUST NOT emit them. See updated comment in the `getRanking` section above.

5. **`checkUsername` and `ping` — Resolved.** `handler-map.md` confirms:
   `ping` (`views.py:1479`) is a real endpoint returning `"pong"` (RpcQueue
   keepalive, not auth-gated — LocalEngine must implement it). `checkUsername`
   is NOT in `dd_app`; it belongs to the separate `dd_auth` Django service and
   must be dropped from the LocalEngine port entirely. See updated sections
   above.
