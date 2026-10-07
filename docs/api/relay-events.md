# Relay Event Catalog — Private Layer

**Status: DESIGN — contract for parallel backend/frontend work. Nothing on
this page is implemented.** This file is the single source of truth for the
relay channel, in the same role `ws-events.md` played for the public layer:
backend and client are both built against it, and drift is a bug.

Private-layer semantics: `docs/architecture/02-private-layer.md`.
Trust model: `docs/architecture/05-threat-model.md` — the server is a blind
relay; the E2EE guarantee applies only after SAS verification.

## Endpoint

```
WSS /api/v1/relay
```

A **separate socket** from `/api/v1/ws` — deliberate isolation: the relay has
its own protocol, its own close codes, and touches no persistent storage.
The public WS channel keeps carrying public-layer events; the relay carries
opaque envelopes and private-session control.

## Zero-persistence invariants (binding on the implementation)

1. Envelope `blob` payloads are opaque to the server — never parsed, never
   logged, never stored beyond the in-process delivery buffer.
2. Session metadata lives only in the relay's in-process registry — no DB
   writes, no Redis, no logs tying user pairs to session ids.
3. `sessionId` values are server-minted opaque UUIDs; neither participant's
   identity appears in them.
4. On `relay.closed` the session's buffer and registry entry are destroyed —
   not archived, not flushed.
5. Server logs may record session create/close **counts**; never user pairs,
   never blob sizes per user.

## Auth

Same pattern as `/api/v1/ws`: connect without credentials, then the client
must send an `auth` frame within 5 s:

```json
{ "type": "auth", "data": { "accessToken": "<jwt>" } }
```

- Bad token or non-auth first frame → `auth.fail` + close `4401`.
- No auth frame in 5 s → close `4408`.
- Access token expiring mid-connection → close `4401` (refresh + reconnect;
  sessions in the disconnect grace window accept `relay.resume`).
- Session revoked server-side → close `4401` (preceded by `relay.closed`
  for each of that session's live private sessions).

## Framing

```json
{ "type": "<event>", "ts": "2026-09-24T15:00:00Z", "data": { ... } }
```

Client→server frames carry `{ "type", "data" }` only. There is **no `seq`**:
envelope ordering inside a session is the `msgSeq` field on `relay.msg`
itself; control events are idempotent and carry no ordering guarantee across
sessions. (A global seq would mean the server tracks per-session ordering
state — more surface for zero benefit: gaps are handled by the clients'
encrypted-channel semantics.)

## Client → Server

| type | data | notes |
|------|------|-------|
| `auth` | `{ "accessToken": jwt }` | mandatory first frame, ≤5 s |
| `relay.invite` | `{ "toUserId": uuid, "ttlSeconds": int, "burnOnRead": bool, "strict": bool }` | create + invite; inviter only; `toUserId` must be a **mutual contact**. `ttlSeconds` ∈ [60, 86400], client default 600. `strict` = die instantly on any disconnect (no grace) |
| `relay.accept` | `{ "sessionId": uuid }` | invitee accepts |
| `relay.decline` | `{ "sessionId": uuid }` | invitee declines → session dies unborn |
| `relay.send` | `{ "sessionId": uuid, "blob": base64 }` | opaque envelope. First envelopes after `relay.established` carry key-exchange material **by convention**; the relay treats all blobs identically |
| `relay.resume` | `{ "sessionId": uuid, "resumeToken": string }` | reattach within the grace window; required for buffer takeover so a reconnect can't hijack a peer's queue |
| `relay.burn` | `{ "sessionId": uuid }` | manual kill — either participant, any time |
| `ping` | `{}` | heartbeat; server replies `pong`. Client pings every 30 s; server drops idle conns at 90 s |

## Server → Client

### Lifecycle

| type | data | notes |
|------|------|-------|
| `auth.ok` | `{}` | auth accepted |
| `auth.fail` | `{ "code": "unauthorized" }` | then close `4401` |
| `relay.invite` | `{ "sessionId": uuid, "from": User, "ttlSeconds": int, "burnOnRead": bool, "strict": bool }` | delivered to the invitee; expires with the invite TTL (60 s) if unanswered → `relay.closed{reason:"expired"}` to the inviter |
| `relay.established` | `{ "sessionId": uuid, "peer": User, "resumeToken": string, "ttlEndsAt": ts }` | sent to **both** sides on accept; each side gets its own `resumeToken`. Clients immediately begin key exchange via `relay.send`. Also **re-emitted after every auth** for each live session the user belongs to — reconnects rejoin their sessions; the event is idempotent (clients dedup by `sessionId`) |
| `relay.declined` | `{ "sessionId": uuid }` | invitee declined |
| `relay.peer-offline` | `{ "sessionId": uuid, "graceEndsAt": ts }` | peer lost its conn; session survives until `graceEndsAt` (~60 s). Skipped in `strict` sessions — they die on first disconnect |
| `relay.closed` | `{ "sessionId": uuid, "reason": "timer" \| "burned" \| "expired" \| "peer-gone" \| "revoked" }` | terminal for the session; buffers destroyed |

### Envelopes

| type | data | notes |
|------|------|-------|
| `relay.msg` | `{ "sessionId": uuid, "msgSeq": int, "blob": base64 }` | routed to the **other** participant only (never echoed to sender). `msgSeq` is per-session, monotonic from 1 — ordering + dedup only |
| `relay.error` | `{ "code": "not_found" \| "not_participant" \| "quota" \| "expired" }` | non-fatal protocol error; the socket stays up |
| `pong` | `{}` | reply to `ping` |

## Buffering & delivery

- While the peer is offline inside its grace window, `relay.send` envelopes
  are buffered **in-process** (same design family as the WS hub's replay
  rings — map + timers, never Redis/disk), bounded per session
  (**256 envelopes or 1 MiB, whichever first**; overflow → `relay.error
  {code:"quota"}` to the sender).
- On `relay.resume` with a valid `resumeToken`, buffered envelopes flush in
  `msgSeq` order. A wrong token is a miss — no error detail beyond
  `relay.error{code:"not_found"}` (tokens are not oracle-able).
- Invite (pre-accept) buffers nothing: blobs sent before `relay.established`
  are rejected `relay.error{code:"not_found"}`.

## Death triggers (recap of `02-private-layer.md`)

| Trigger | Behavior |
|---------|----------|
| `ttlEndsAt` reached | `relay.closed{reason:"timer"}` to both |
| Disconnect, grace expired | `relay.closed{reason:"peer-gone"}` |
| Disconnect in `strict` session | immediate `relay.closed{reason:"peer-gone"}` |
| `relay.burn` from either side | `relay.closed{reason:"burned"}` to both |
| Invite unanswered (60 s) | `relay.closed{reason:"expired"}` to inviter |
| Device session revoked / logout | `relay.closed{reason:"revoked"}` |

## Key exchange & SAS (client-side contract)

The relay is blind to all of this — documented here because it defines what
the first envelopes mean:

1. After `relay.established`, each client generates an ephemeral ECDH P-256
   pair and `relay.send`s its public key (raw or SPKI, base64).
2. Each client derives `AES-GCM-256` via `deriveKey`.
3. Each client computes the **SAS fingerprint** from `(ownPub, peerPub)` in a
   canonical order and displays it (S11b emoji grid).
4. **Until the user confirms the SAS match, the session is MITM-able** —
   the UI must show it as *unverified*, never "encrypted". The E2EE
   guarantee exists only after out-of-band SAS confirmation.
5. Session keys live in RAM only; they die with the tab/session/burn.

## What the server legitimately sees (honest accounting)

User pair per session, session timing/duration, envelope count, envelope
sizes in aggregate. Not contents, not keys. This residual metadata risk is
declared in `05-threat-model.md`.

## Client zero-trace discipline (binding on the client)

The private layer leaves **no traces** on the device/browser after any
session end (burn, timer, disconnect-death, unload):

- Private messages, keys, session state: JS memory only — never
  `localStorage`, `sessionStorage`, cookies, service-worker caches, or any
  persistence path except the single exception below.
- **Dev-tier exception (pwa-dev only):** non-extractable identity
  `CryptoKey` objects may live in a dedicated IndexedDB database
  (`openglass-private`) — documented as dev-tier because IndexedDB is the
  only browser persistence that can hold non-extractable keys. Native
  shells use platform keystores instead.
- **Full teardown must delete the IndexedDB itself**
  (`indexedDB.deleteDatabase`) — including object stores/folders allocated
  for planned-but-uncreated data. No empty shells, no leftover schema.
- On session end: message buffers nulled, session key references dropped,
  private-store state destroyed; `beforeunload`/burn/death paths all run
  the same teardown.
- No `console.log`/error reporting of envelope contents, session ids, or
  peer pairing from the private module.

## Explicitly out of scope

- Group private sessions, multi-device private, Double Ratchet —
  post-v1 design space.
- `relay.*` frames on the public `/api/v1/ws` socket — never; the channels
  are separate by design.
