# Journal 06 — Realtime: WebSocket hub, replay, resync (issue #14, B2)

**Phase:** `internal/ws/hub.go` + frontend reconnect/resync wiring.

## The core idea

Every *device session* owns a monotonic `seq` and a bounded in-memory
ring buffer of recent frames. Reconnect passes `?last_seq=N`:

- all missed frames still buffered → replay with original seqs →
  `auth.ok{resumedFromSeq}`;
- history fell out of the ring or the session was evicted →
  `resync.required{gap|evicted}` → client refetches truth via REST.

In-memory is deliberate: the zero-knowledge private relay will run
without Redis, and the same replay/resync semantics transfer unchanged.
One resync mechanism serves both layers — the client never cares where
the buffer lives.

## Security findings from the review pass (all fixed)

1. **Revoked sessions could re-attach.** The WS validator checked JWT
   signature/expiry only; REST additionally gates on `SessionActive`.
   `Hub.Revoke` closed live conns but nothing blocked a reconnect with
   the still-valid token. Now `SessionActive` is part of the hub's
   `Directory` and checked on every auth frame.
2. **Mid-connection expiry closed without a close code.** The contract
   requires `4401`; the timer cut TCP. Close codes now flow through the
   writer goroutine so the socket ends with a real close frame.
3. **No read limit** (gorilla v1.5.3 defaults to unlimited) →
   `SetReadLimit(32 KiB)`; client frames are small control JSON.

## Frontend completeness

`WsClient` already spoke the contract; the *store* lacked resilience:
added a reconnect loop (backoff 1s→15s, `last_seq` resumed
automatically), `resync.required` → drop windows + refetch,
`session.revoked` → local logout, and refresh-token rotation when a
reconnect hits `auth.fail`. A 401 from `/auth/refresh` means the whole
session is dead → stop retrying, log out.

## Test craft

- 15 integration tests dial a real gorilla client: auth timeout (4408),
  bad token (4401), replay, gap/evicted resync, fan-out scoping,
  typing throttle, receipt persistence, revocation + re-attach denial,
  presence privacy (mutual-only), multi-conn duplication, read limit.
- Gotcha worth remembering: the gorilla *client* marks a connection
  corrupt after any read timeout — tests that poll must read in a
  background goroutine feeding a channel, not loop deadlines.
