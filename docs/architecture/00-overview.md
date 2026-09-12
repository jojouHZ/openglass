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

## System Map

```
                        Clients (MFE shells)
   ┌─────────────┬──────────────┬───────────────┬────────────────┐
   │  PWA shell  │  iOS shell   │ Android shell │ Desktop shell  │
   │  (Vue3+Vite)│ (Capacitor)  │ (Capacitor)   │  (Electron)    │
   └──────┬──────┴──────┬───────┴───────┬───────┴────────┬───────┘
          │             │               │                │
          │      shared frontend core (Vue3 + Vite MFE)  │
          │             │               │                │
          │  public remote module   private remote module│
          │  (all shells)           (native shells only) │
          └─────────────┴───────┬───────┴────────────────┘
                                │  HTTPS + WSS
                    ┌───────────▼────────────┐
                    │      Go backend        │
                    │  (monolith, remote)    │
                    ├────────────────────────┤
                    │ Public API             │── PostgreSQL (at-rest encrypted)
                    │  auth/contacts/chats   │
                    │ Relay API              │── in-process buffer (RAM only)
                    │  ephemeral sessions    │
                    │ Support                │── Redis (presence, rate-limit)
                    └────────────────────────┘
```

## The Two Layers

| | Public layer | Private layer |
|---|---|---|
| Storage | Server-side history | Zero persistence (RAM-only transit) |
| Crypto | TLS + at-rest encryption | E2EE, per-chat session keys |
| Platforms | All shells incl. PWA | Native shells only |
| Lifetime | Persistent | Dies on timer / disconnect / manual burn |
| Trust model | Server is trusted | Server is cryptographically blind |

The private layer is architecturally an **add-on built on the public layer**:
contacts and the invite handshake live in the public layer; the private session
itself is a separate channel that never touches message storage.

## Development Stages

| Stage | Deliverable |
|-------|-------------|
| **MVP** | Go backend (public API + dormant relay API) + PWA shell. Private module is built but not loaded by the PWA. |
| **Alpha** | iOS shell (Capacitor) — private layer activates. |
| **Beta** | Android + Desktop shells, polish. |
| **v1.0** | Production-ready for first private clients. |

## Development Infrastructure

- **Agent team**: hierarchical agent system (see `AGENTS.md`), work tracked in
  GitHub Issues + Project board (`proceed → done → approved → next`).
- **Knowledge base**: all documentation, success cases, bad cases and rollbacks
  are vectorized into Qdrant (`openglass_docs`, 1024-dim BGE-large embeddings)
  so agents can search project history. See `docs/architecture/04-backend.md`.

## Scaling Model

Growth means **more instances, not a bigger instance**. One instance serves a
closed community (≤100 users by product design; technically up to ~1–5k
concurrent connections). Horizontal multi-node scale-out is out of scope for v1.

## License

AGPLv3 — chosen to close the SaaS loophole (network use = must disclose source)
and to enable a dual-licensing model for commercial clients. See `LICENSE`.
