# Backend Architecture

## Shape

A **single Go monolith**, remote-first. All server logic lives here: HTTP API,
WebSocket delivery, and the private-session relay. One backend serves every
client platform — no per-platform server code.

```
cmd/                 entrypoint
internal/
  knowledge/         Qdrant knowledge-base client (agent infrastructure)
  api/               public REST API (planned)
  ws/                WebSocket hub + relay (planned)
  relay/             private session relay, in-process buffers (planned)
```

## Responsibilities

| Component | Notes |
|-----------|-------|
| Public API | auth, contacts, chats, messages, attachments, search |
| WS hub | realtime delivery, presence, typing, receipts |
| Relay API | private sessions: opaque envelope routing, zero persistence |
| Redis | presence state, rate limiting, public sessions — **never private blobs** |
| PostgreSQL | public layer data, at-rest encryption |

## Private blob buffering — in-process by design

During the grace window (~60 s reconnect), undelivered private messages live in
an **in-process Go buffer** (map + timers). This was chosen over Redis
deliberately:

- Zero persistence is guaranteed **by construction**, not by configuration —
  there is no RDB/AOF, slowlog, or ACL surface to misconfigure.
- Smaller attack surface: no extra service holding ciphertext.
- Restart loses the buffer — acceptable: sessions are ephemeral by definition.

Redis is still used where persistence is harmless: presence, rate limits,
public-layer sessions.

## Deployment

- **Managed hosting** (default): we run the instance for the client,
  ≤100 users, invite-only.
- **Private hosting**: a separate host/deploy repository (compose config,
  secrets, ops scripts). Same codebase — never a fork.
- `docker compose up -d` must yield a working instance; deploy simplicity is
  part of the product.

## Scaling

- Target: **≤100 users per instance** (product decision — closed circles).
- Technical headroom: thousands of concurrent WS connections per node
  (Go + goroutines; ~20–50 KB per connection).
- Growth model: **more instances, not a bigger instance**.
- Multi-node scale-out (>5–10k concurrent, sticky sessions, shared state) is
  out of scope for v1 — revisit only if a client demands it.

## Knowledge Base (agent infrastructure)

- **Qdrant** vector DB: collection `openglass_docs`, 1024-dim vectors
  (BGE-large via TEI embedder service, port 8080).
- `internal/knowledge` connects over gRPC (port 6334); agents query project
  knowledge (success cases, bad cases, rollbacks, architecture docs).
- Python `scripts/vectorize_docs.py` indexes docs in CI — not a production
  runtime dependency.

## Capacity Notes

| Resource | Estimate |
|----------|----------|
| Concurrent WS | ~5–10k per modest VPS (4 vCPU / 8 GB) |
| Private sessions | thousands — bounded by relay buffer RAM only |
| Bottleneck | message throughput + DB writes before connection count |
