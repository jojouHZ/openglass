# WebSocket Event Catalog — Public Layer

Realtime channel for the public layer. Part of the API contract
(`docs/dev/frontend-first-development.md`) — the mock replays these events
as scripted fixtures; the Go hub implements them for real.

## Endpoint

```
WSS /api/v1/ws?access_token=<jwt>
```

- Auth: short-lived access JWT passed as `access_token` query param
  (browser WebSocket cannot set headers). Expired token mid-connection →
  server closes with code `4401`; client reconnects with a fresh token.
- One connection per device session. A second connect on the same session
  is allowed (multi-tab PWA) — events are duplicated per connection.

## Framing

All frames are JSON text frames:

```json
{ "type": "<event>", "seq": 123, "ts": "2026-09-24T15:00:00Z", "data": { ... } }
```

- `type` — event name (catalog below)
- `seq` — **per-connection** monotonic sequence assigned by the server.
  On reconnect the client sends `Last-Event-Seq`; the server replays
  missed events where still buffered, else answers `resync.required`.
- `ts` — server timestamp (informational; ordering is by `seq`, not `ts`)

## Client → Server

| type | data | notes |
|------|------|-------|
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
| `presence.snapshot` | `{ "onlineUserIds": [uuid] }` | **first event after connect** — who is online right now, so the client can paint presence without waiting for deltas. Mutual contacts only |
| `typing` | `{ "chatId": uuid, "userId": uuid, "until": ts }` | show indicator until `until` (~5 s); no explicit stop event required |
| `receipt.read` | `{ "chatId": uuid, "userId": uuid, "upToSeq": int }` | peer's read cursor — drives ✓✓ states |
| `presence` | `{ "userId": uuid, "status": "online" \| "offline" }` | only for mutual contacts; offline is emitted after the disconnect grace window |

### Session / infra

| type | data | notes |
|------|------|-------|
| `pong` | `{}` | reply to `ping` |
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
