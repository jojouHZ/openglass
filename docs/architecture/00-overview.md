# OpenGlass — Architecture Overview

## Vision

OpenGlass is a **self-hosted secure messenger with two privacy layers**, designed
for closed communities and private deployments.

- **Public layer** — a full-featured messenger with server-side history.
  The server is trusted; security is honest about it.
- **Private layer** — ephemeral live E2EE sessions. The server is a blind
  relay that stores nothing. Native platforms only.

The product is delivered as a **managed service**: we host an instance for a
closed circle of users (target ≤ 100 users per instance, invite-only).
Self-hosted deployment for clients is supported via a separate host repository
— the codebase itself is never forked.

## Maturity Matrix

Every component is labeled honestly: **implemented** means code shipped and
tested on `main`, **designed** means the contract/thinking is written down,
**stubbed** means the API answers `501 not_implemented`.

| Component | Status |
|-----------|--------|
| Public REST API (auth, contacts, chats, messages, attachments) | **Implemented** |
| WebSocket hub (delivery, presence, typing, receipts, replay/resync) | **Implemented** |
| PWA shell (installable, offline states) | **Implemented** |
| Shared frontend core (`packages/core`) | **Implemented** |
| Private layer (relay, E2EE, SAS verify, burnable chats) | **Designed, implementation starting** — contract: `docs/api/relay-events.md`; UI exists only in the internal `pwa-dev` build |
| Push notifications | **Stubbed** (501) |
| Abuse reports | **Stubbed** (501) |
| iOS / Android / Desktop shells | **Designed** |
| Redis usage (presence, rate-limit) | **Provisioned** — wired into `/healthz` only; presence currently lives in the hub |
| Qdrant + TEI knowledge base | **Implemented** — dev infrastructure, not in the message path |

## System Map

```
                        Clients (MFE shells)
   ┌─────────────┬──────────────┬───────────────┬────────────────┐
   │  PWA shell  │  iOS shell   │ Android shell │ Desktop shell  │
   │  (Vue3+Vite)│ (Capacitor)  │ (Capacitor)   │  (Electron)    │
   │   shipped   │   designed   │   designed    │   designed     │
   └──────┬──────┴──────┬───────┴───────┬───────┴────────┬───────┘
          │             │               │                │
          │      shared frontend core (Vue3 + Vite MFE)  │
          │             │               │                │
          │  public remote module   private remote module│
          │  (all shells)           (native + pwa-dev)   │
          └─────────────┴───────┬───────┴────────────────┘
                                │  HTTPS + WSS
                    ┌───────────▼────────────┐
                    │      Go backend        │
                    │  (monolith, remote)    │
                    ├────────────────────────┤
                    │ Public API             │── PostgreSQL (public data)
                    │  auth/contacts/chats   │
                    │ WS hub                 │── in-memory seq rings + buffers
                    │  delivery/replay       │
                    │ Relay API              │── (designed — private layer)
                    │  ephemeral sessions    │
                    └────────────────────────┘

   Dev infra (not in the message path): Qdrant + TEI for the docs
   knowledge base; Redis provisioned for future presence/rate-limit.
```

## The Two Layers

| | Public layer | Private layer (designed) |
|---|---|---|
| Storage | Server-side history | Zero persistence (RAM-only transit) |
| Crypto | TLS in transit | E2EE, per-chat session keys + SAS verify |
| Platforms | All shells incl. PWA | Native shells only (+ internal pwa-dev) |
| Lifetime | Persistent | Dies on timer / disconnect / manual burn |
| Trust model | Server is trusted | Server is cryptographically blind |

The private layer is architecturally an **add-on built on the public layer**:
contacts and the invite handshake live in the public layer; the private session
itself is a separate channel that never touches message storage.

## Development Stages

| Stage | Deliverable | Status |
|-------|-------------|--------|
| **MVP** | Go backend (public API) + PWA shell. Private module built but gated out of the production bundle. | ~complete |
| **Alpha** | iOS shell (Capacitor) — private layer activates. | designed |
| **Beta** | Android + Desktop shells, polish. | designed |
| **v1.0** | Production-ready for first private clients. | designed |

## Development Infrastructure

- **Workflow**: work is tracked in GitHub Issues + a kanban Project board
  (`proceed → done → approved → next`) with human review gates.
- **Knowledge base**: documentation, success cases, bad cases and rollbacks
  are vectorized into Qdrant (`openglass_docs`, 1024-dim BGE-large embeddings)
  for semantic search over project history.
- **Code graph**: a continuously-updated symbol/import/call graph of the
  repo, rebuilt by git hooks after every commit.

## Scaling Model

Growth means **more instances, not a bigger instance**. One instance serves a
closed community (≤100 users by product design; technically up to ~1–5k
concurrent connections). Horizontal multi-node scale-out is out of scope for v1.

## License

AGPLv3 — chosen to close the SaaS loophole (network use = must disclose source)
and to enable a dual-licensing model for commercial clients. See `LICENSE`.
