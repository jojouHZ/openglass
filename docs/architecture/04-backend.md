# Backend Architecture

## Shape

A **single Go monolith**, remote-first. All server logic lives here: HTTP API
and WebSocket delivery (the private-session relay is designed, not built).
One backend serves every client platform — no per-platform server code.

```
cmd/server/          entrypoint (main.go only)
internal/
  api/               public REST API — handlers incl. attachment
                     upload/binding/download; envelope errors; OpenAPI parity
  auth/              JWT pairs (HS256 access + opaque refresh), Argon2id OTP
  config/            env config (JWT secret, TTLs, addresses; OPENGLASS_DEV_MODE)
  store/             Store interface + two implementations: Mem (tests/dev) and
                     PG (postgres) — contract-parity tested against each other
  ws/                WebSocket hub — delivery, replay/resync, presence, typing
  models/            wire types shared by api/store/ws
  vector/ + knowledge/ + codegraph/   dev knowledge infrastructure
```

## Responsibilities

| Component | Notes |
|-----------|-------|
| Public API | auth (OTP verify, refresh, sessions, logout), contacts, chats, messages, attachments, search |
| WS hub | realtime delivery, presence, typing, receipts, per-session seq + replay |
| Attachments | staged upload → message binding → member-gated download; blobs on disk under generated IDs |
| Redis | **provisioned** — `/healthz` pings it; presence/rate-limit roles are future work |
| PostgreSQL | all public-layer data |

## WS hub design

The hub (`internal/ws/hub.go`, ~560 lines) is the delivery path:

- **Per-session sequencing** — every device session owns a monotonic `seq`
  and a bounded in-memory ring (`replayCap=256`) of undelivered events.
- **Replay/resync** — reconnect with `?last_seq=N` replays what the ring
  still holds; on gap or eviction the client gets `resync.required`
  (`gap` | `evicted`) and refetches over REST.
- **Presence** — `online` count per user; mutual-contact scoping for both
  the snapshot and `presence` broadcasts; a grace window on disconnect
  suppresses flaky flapping.
- **Gates on the way in**: valid JWT (else `auth.fail` + close 4401),
  `SessionActive` check against the store (a revoked session cannot
  re-attach on a still-valid JWT), 32 KiB client-frame cap, `afterExpiry`
  drops the conn with 4401 the moment its token dies.
- **Backpressure**: a conn that can't drain its send queue is dropped —
  the session's replay buffer survives so a reconnect can catch up.

The in-memory replay ring is **deliberate** — the same replay/resync
semantics will back the private-layer relay, and neither critical path
may depend on Redis.

## Store parity contract

`store.Store` is an interface with two implementations (`Mem`, `PG`) that
must behave identically — the api test suite runs against `Mem`, and the
same suite (or a shared contract subset) runs against `PG` in CI.
The frontend mock (`packages/core/src/api/mock`, MSW) follows the same
envelope and error contract, so frontend tests exercise real contract
semantics without a backend.

## Deployment

- **Managed hosting** (default): we run the instance for the client,
  ≤100 users, invite-only.
- **Private hosting**: a separate host/deploy repository (compose config,
  secrets, ops scripts). Same codebase — never a fork.
- `docker compose up -d` must yield a working instance; deploy simplicity is
  part of the product.
- `OPENGLASS_DEV_MODE=1` substitutes a dev-only JWT secret — dev only,
  never deployed.

## Private blob buffering — in-process by design (for the future relay)

During the grace window (~60 s reconnect), undelivered private messages will
live in an **in-process Go buffer** (map + timers) — the same shape as the
existing per-session replay rings. Chosen over Redis deliberately:

- Zero persistence is guaranteed **by construction**, not by configuration —
  there is no RDB/AOF, slowlog, or ACL surface to misconfigure.
- Smaller attack surface: no extra service holding ciphertext.
- Restart loses the buffer — acceptable: sessions are ephemeral by definition.

Redis remains for roles where persistence is harmless: presence state, rate
limits, public-layer session caches.

## Scaling

- Target: **≤100 users per instance** (product decision — closed circles).
- Technical headroom: thousands of concurrent WS connections per node
  (Go + goroutines; ~20–50 KB per connection).
- Growth model: **more instances, not a bigger instance**.
- Multi-node scale-out (>5–10k concurrent, sticky sessions, shared state) is
  out of scope for v1 — revisit only if a client demands it.

## Knowledge Base (dev infrastructure)

- **Qdrant** vector DB: collection `openglass_docs`, 1024-dim vectors
  (BGE-large via TEI embedder service, port 8080).
- Clients connect over gRPC (port 6334) to query project knowledge
  (success cases, bad cases, rollbacks, architecture docs).
- Python `scripts/vectorize_docs.py` indexes docs in CI — not a production
  runtime dependency. Not in the message path.

## Capacity Notes

| Resource | Estimate |
|----------|----------|
| Concurrent WS | ~5–10k per modest VPS (4 vCPU / 8 GB) |
| Private sessions | thousands — bounded by relay buffer RAM only |
| Bottleneck | message throughput + DB writes before connection count |
