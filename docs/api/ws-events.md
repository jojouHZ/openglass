# WebSocket Event Catalog — Public Layer

Realtime channel for the public layer. Part of the API contract
(`docs/dev/frontend-first-development.md`) — the mock replays these events
as scripted fixtures; the Go hub implements them for real.

## Endpoint

```
WSS /api/v1/ws
WSS /api/v1/ws?last_seq=<N>   (reconnect with replay cursor)
```

- **Auth is the first frame, not the URL.** Tokens in query strings leak
  into proxy/server logs — connect without credentials, then the client
  must send an `auth` frame within 5 s:

  ```json
  { "type": "auth", "data": { "accessToken": "<jwt>" } }
  ```

  Server replies `auth.ok` (or `auth.fail` + close `4401`). No other
  client frame is accepted before `auth.ok`. Expired token
  mid-connection → close `4401`; client refreshes and reconnects.
  No `auth` frame within 5 s → close `4408` (auth timeout) — distinct
  from `4401` so clients can tell "bad token" from "never sent auth".
- **Reconnect**: repeat the URL with `?last_seq=<last received frame seq>`.
  The server replays missed buffered events, else sends `resync.required`.
- One connection per device session. A second connect on the same session
  is allowed (multi-tab PWA) — events are duplicated per connection.

## Framing

All frames are JSON text frames:

```json
{ "type": "<event>", "seq": 123, "ts": "2026-09-24T15:00:00Z", "data": { ... } }
```

- `type` — event name (catalog below)
- `seq` — **per-session** monotonic sequence assigned by the server. It is
  scoped to the device session and **survives reconnects** — a new socket
  for the same session continues numbering where the previous one ended.
  This is what makes `?last_seq=<N>` replay meaningful. The sequence
  resets only when the device session itself is created anew (re-login).
- `ts` — server timestamp (informational; ordering is by `seq`, not `ts`)

`seq` and `ts` exist **only on server→client frames**. Client→server
frames carry just `{ "type", "data" }` — the `auth` frame included.

## Client → Server

| type | data | notes |
|------|------|-------|
| `auth` | `{ "accessToken": jwt }` | **mandatory first frame** within 5 s of connect |
| `typing.start` | `{ "chatId": uuid }` | throttled server-side to 1/3s per chat |
| `typing.stop` | `{ "chatId": uuid }` | |
| `receipt.read` | `{ "chatId": uuid, "upToSeq": int }` | same semantics as `POST /chats/{id}/read` |
| `ping` | `{}` | app-level heartbeat; server replies `pong`. Client pings every 30 s; server drops idle sockets at 90 s |

## Server → Client

### Messaging

| type | data | trigger |
|------|------|---------|
| `message.new` | `Message` (OpenAPI schema) | a message was sent to a chat the user is in. `seq` field inside the message is the **per-chat** sequence — distinct from the frame-level `seq` |
| `message.edited` | `Message` | message edited |
| `message.deleted` | `{ "chatId": uuid, "messageId": uuid, "seq": int }` | message deleted (tombstone; client removes or strikes through) |
| `message.pinned` / `message.unpinned` | `{ "chatId": uuid, "messageId": uuid }` | pin change (group right `pin_messages`) |

### Activity

| type | data | notes |
|------|------|-------|
| `presence.snapshot` | `{ "onlineUserIds": [uuid] }` | **first event after `auth.ok`** — who is online right now, so the client can paint presence without waiting for deltas. Mutual contacts only |
| `typing` | `{ "chatId": uuid, "userId": uuid, "until": ts }` | show indicator until `until` (~5 s); no explicit stop event required |
| `receipt.read` | `{ "chatId": uuid, "userId": uuid, "upToSeq": int }` | read cursor — emitted to **all sessions of both parties**: peers see ✓✓, the reader's own other devices sync unread state |
| `presence` | `{ "userId": uuid, "status": "online" \| "offline" }` | only for mutual contacts; offline is emitted after the disconnect grace window |

### Contacts / profile changes

| type | data | notes |
|------|------|-------|
| `contact.added` | `{ "user": User }` | someone added you — relationship becomes `contact_incoming` until you add back (mutual) |
| `contact.removed` | `{ "userId": uuid }` | someone removed you — mutual degrades to `contact_outgoing` on your side |
| `user.updated` | `{ "user": User }` | a mutual contact's profile changed (displayName, avatar) — refresh caches |
| `chat.updated` | `{ "chat": Chat }` | group info changed (title, members, rights) for a chat you're in |
| `chat.new` | `{ "chat": Chat }` | a chat appeared that you're now in: someone opened a direct chat with you or added you to a group. Emitted **before** that chat's first `message.new` (session `seq` order guarantees it) |

### Session / infra

| type | data | notes |
|------|------|-------|
| `pong` | `{}` | reply to `ping` |
| `auth.ok` | `{ "resumedFromSeq": int \| null }` | auth accepted; `resumedFromSeq` = replayed up to this frame seq when `last_seq` was honored, else null |
| `auth.fail` | `{ "code": "unauthorized" }` | bad/expired token — server then closes `4401` |
| `resync.required` | `{ "reason": "gap" \| "evicted" }` | client must refetch via REST (chat list + affected histories) |
| `session.revoked` | `{ "sessionId": uuid }` | this device session was revoked — client logs out |

## Ordering guarantees (contract, not mock behavior)

- Frames on one connection arrive in `seq` order — gaps mean a lost event → `resync.required`.
- `message.new` for one chat is totally ordered by the message's per-chat `seq`.
- Cross-chat ordering is **not** guaranteed.
- The server buffers undelivered events for a short window (~60 s grace,
  Redis-backed); beyond that → `resync.required` on reconnect.

## Explicitly out of scope

- Private-layer envelopes (`relay.*`) — a separate catalog lands with the
  private module; this channel never carries opaque blobs.
- Presence for non-contacts, read receipts with timestamps beyond
  `upToSeq`, delivery receipts (`message.delivered`) — deferred post-MVP.
