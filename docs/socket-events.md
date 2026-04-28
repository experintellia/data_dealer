# SockJS Event Audit

Inventory of every server-pushed SockJS event the dd_js client consumes, cross-referenced with its emit site in [datadealer/dd_app](https://github.com/datadealer/dd_app). Source for this audit:

- Client: `scripts/Socket.js`, `scripts/app.js:211-276`, `scripts/Game.js`.
- Server: `dd_app/socket/sessions.py`, `dd_app/messaging/messenger.py`, `dd_app/tasks/tasks.py`.

## Wire envelope

Both ends speak the same envelope (`scripts/Socket.js:40-44`, `dd_app/socket/sessions.py:16-30`):

```json
{ "ev": "<event-name>", "pl": <payload> }
```

`Socket.onmessage` dispatches via `self.trigger(event.data.ev, event.data.pl)`, so handlers receive the unwrapped payload as their single argument. Two channels feed the client:

1. **Direct emits** from the SockJS session (`session.emit(ev, pl)` in `dd_app/socket/sessions.py`).
2. **Fanout messages** from the Redis-backed `Messenger`. `dd_app/socket/sessions.py:78-86` re-emits every fanout `Message` as `(m.action, m.data)`. So a `Messenger.user_send` of `Message(action='X', data=Y)` reaches the browser as `{ev: 'X', pl: Y}`.

## Queue

`scripts/Socket.js:60-86` lets a handler opt into queuing via `Socket.NEEDS_QUEUE`. Queued handlers do not run when the message arrives; they are pushed onto `app.socket.queue` (`$.jqmq`, `paused: true, delay: -1`) and only drained after `app.socket.queue.start()` is called once the game finishes loading (`scripts/Game.js:2063`). This guarantees no `node_ready` / `new_items` mutates the in-memory game tree before `loadGame` has built it.

## Connection lifecycle (client-synthesised)

These three are produced inside `scripts/Socket.js`, not on the wire — `SockJS.onopen` / `onclose` map directly to `connect` / `disconnect` (`scripts/Socket.js:34-50`). Listed here because `app.js` registers handlers for them.

### `connect`
- **Source:** SockJS `onopen` → `self.trigger('connect')` (`scripts/Socket.js:34-38`).
- **Client handler:** `scripts/app.js:234-238`. Sends the auth token back via `socket.emit("client_connected", {token: token})`.
- **Payload:** none.
- **Lifecycle:** TCP/WS handshake complete, before server-side authentication.
- **NEEDS_QUEUE:** no.

### `disconnect`
- **Source:** SockJS `onclose` → `self.trigger('disconnect')` (`scripts/Socket.js:46-50`).
- **Client handler:** `scripts/app.js:248-256`. Calls `app.game.lostSocket()` (`scripts/Game.js:863`) which renders a "lost socket" notification and asks the user to reload.
- **Payload:** none.
- **Lifecycle:** any time after open. Also fires server-side after a `kick` (see below).
- **NEEDS_QUEUE:** no.

### `debug` *(server-pushed, optional)*
- **Server emit:** `dd_app/messaging/messenger.py:63-73` — `Messenger.debug(msg, token, extra_data, uid)` builds `Message(action='debug', data={'message': msg, ...extra_data})`. No production call sites in dd_app; intended for ad-hoc broadcast or per-user debug.
- **Client handler:** `scripts/app.js:259-263`. Logs `data.message` to the console only if `setup.debug` is true.
- **Payload:** `{ "message": <string>, ...extra }`.
  ```json
  { "message": "tick processed", "uid": "abc123" }
  ```
- **Lifecycle:** any time after the SockJS session is up.
- **NEEDS_QUEUE:** no.

## Authentication / handshake

### `established`
- **Server emit:** `dd_app/socket/sessions.py:77` — `self.emit('established', {})`. Sent from the per-user `listener` greenlet, immediately after the Redis `Messenger` has been attached (post-`onevent_client_connected`).
- **Client handler:** `scripts/app.js:241-245`. Resolves `handshake` deferred, which gates `loadGame` (`scripts/app.js:178`).
- **Payload:** empty object `{}`.
- **Lifecycle:** exactly once per session, after the client sends `client_connected` and the server has subscribed to the user's Redis channel. Nothing can flow on `node_ready` / `new_items` before this.
- **NEEDS_QUEUE:** no.

## Gameplay events (queued)

### `node_ready`
- **Server emit:** `dd_app/messaging/messenger.py:75-83` (`Messenger.node_ready`). Only call site: `dd_app/tasks/tasks.py:71-88` — the `chargePerpReady` Celery task, fired when a perp's charging timer elapses and the DB row is moved from `nodes_charging` to `nodes_collect`.
- **Client handler chain:**
  - `scripts/app.js:266-268` — `socket.on("node_ready", …, Socket.NEEDS_QUEUE)` looks up the node by id and re-fires the event on it: `app.game.getById(data.id).trigger('node_ready', [data.result])`.
  - Per-perp listeners on the `GameNode`: `scripts/Game.js:4158-4164` (ContactPerp), `scripts/Game.js:4484-4486` (ClientPerp), `scripts/Game.js:4730-4732` (ProjectPerp). All call `gnode.markReady()`. The `result` arg is currently ignored (see `FIXME` at `Game.js:4160`).
- **Payload:** `{ id, type, path, result }`, where `result` is whatever the charging task returned (currency / xp deltas; opaque to the client).
  ```json
  {
    "id": "537abc...",
    "type": "ContactPerp",
    "path": "Imperium/City/contact_001",
    "result": { "value": 12, "duration": 3600 }
  }
  ```
- **Lifecycle:** at the moment a charging cycle completes server-side. After-handshake only. May be backlogged in Redis if the user was offline when the task ran — those are delivered at the head of the listener loop and queued client-side until `app.socket.queue.start()`.
- **NEEDS_QUEUE:** **yes** (`scripts/app.js:268`). LocalEngine must respect this: emit synchronously after the originating handler returns, OR synthesise during materialisation in `loadGame` for cycles that completed while the app was closed.

### `new_items`
- **Server emit:** `dd_app/messaging/messenger.py:85-89` (`Messenger.notify_available`). Two call sites in `dd_app/tasks/tasks.py`:
  - `tasks.py:90-102` — `notifyLevelupItems`, after a `levelup`. Payload includes newly-unlocked perps and powerups for the new level.
  - `tasks.py:104-115` — `notifyBuyperpItems`, after the player buys a provider perp that unlocks new consumer perps.
- **Client handler chain:**
  - `scripts/app.js:271-273` — `socket.on("new_items", …, Socket.NEEDS_QUEUE)` forwards as `app.game.trigger('new_items', [data])`.
  - `scripts/Game.js:1072-1075` — `GameRoot` listener calls `groot.makeNotifications(data)`. `makeNotifications` (`Game.js:1109+`) is a giant switch on payload keys: `error`, `mission_complete`, `mission_active`, `levelup`, `story` / `storyPerp`, `simplemessage`, `perps`, `powerups`, etc. (see also direct in-process calls at `Game.js:865`, `1775`, `2638`, `2787`, `3647`, `3675`, `3693`, `4242`, `4524`, `5220` — those bypass the socket and call `makeNotifications` directly when a local action triggers the same UI.)
- **Payload:** an open-shaped notification envelope. The two server-side shapes are:
  ```json
  {
    "trigger": "levelup",
    "level": 7,
    "perps": ["consumer_a", "consumer_b"],
    "powerups": ["pwr_x"]
  }
  ```
  ```json
  {
    "trigger": "buy_provider",
    "level": 7,
    "provider": "gestalt_xyz",
    "perps": ["consumer_c"]
  }
  ```
  Other keys consumed by `makeNotifications` (`error`, `mission_complete`, `mission_active`, `simplemessage`, `levelup` as a number, `story`/`storyPerp`, raw notification objects) are produced by local code paths, not by the server's `new_items` channel — but the same handler tolerates them, so LocalEngine may use any subset.
- **Lifecycle:** after-handshake. Triggered by Celery side-effects of an RPC (levelup detection, buyPerp). Like `node_ready`, can be backlogged for offline users.
- **NEEDS_QUEUE:** **yes** (`scripts/app.js:273`).

## Server-emitted, no client handler

### `kick`
- **Server emit:** `dd_app/socket/sessions.py:63` (`self.dd_msg.kick_user_sessions(...)`). Sent by a *new* session to all *prior* sessions of the same uid; the prior session's listener (`sessions.py:79-84`) re-emits `kick` to the doomed browser tab and then closes the SockJS connection.
- **Client handler:** none registered on `app.socket`. The browser observes the close as a `disconnect` (see above) and shows the lost-socket modal.
- **Payload:** `{ "sender": "<listener_uuid>" }`.
- **Lifecycle:** when the same user opens a second tab / re-authenticates.
- **NEEDS_QUEUE:** n/a.

LocalEngine has no analogue here — there is no second client to evict in the local/offline mode.

## DOM passthroughs (informational)

`scripts/Socket.js:34-50` also fires jQuery document events alongside every socket lifecycle / message: `socketBeforeOpen` / `socketAfterOpen`, `socketBeforeMessage` / `socketAfterMessage`, `socketBeforeClose` / `socketAfterClose`. **No code in `scripts/` or `views/` listens for any of them today** (`grep socketAfterMessage` returns only the trigger sites). They exist as extension points; LocalEngine does not need to reproduce them.

## Summary table

| Event              | Direction | Queued | Carries payload | Synthesise locally? |
|--------------------|-----------|:------:|-----------------|---------------------|
| `connect`          | client wrapper | no | – | yes (on engine "open") |
| `established`      | server → client | no | `{}` | yes, once after `loadGame` returns |
| `disconnect`       | client wrapper | no | – | only on engine teardown |
| `debug`            | server → client | no | `{message, …}` | optional |
| `node_ready`       | server → client | **yes** | `{id, type, path, result}` | **yes** — synchronous after charge-complete handler, plus replay during materialisation for cycles that finished while offline |
| `new_items`        | server → client | **yes** | open-shaped notification | **yes** — after levelup/buyPerp side-effects, plus replay during materialisation |
| `kick`             | server → client | no | `{sender}` | no (single-client) |

Two events (`node_ready`, `new_items`) cover everything Phase 3's LocalEngine needs to synthesise. Both must be emitted under the same `Socket.NEEDS_QUEUE` discipline: do not deliver them until after the originating handler / `loadGame` materialisation has finished mutating game state.
