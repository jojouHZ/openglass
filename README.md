# OpenGlass

Self-hosted secure messenger with two privacy layers, designed for closed
communities and private deployments.

- **Public layer** — a full messenger with server-side history. Server-trusted
  by design (see [Security model](#security-model)).
- **Private layer** — ephemeral E2EE sessions where the server is a blind
  relay. **Designed, not yet shipped** — see
  [docs/architecture/02-private-layer.md](docs/architecture/02-private-layer.md).

## Status

**Shipped (public layer):**

- Email + one-time-code registration (invite-only, closed-circle hosting)
- Contacts by tag, mutual-contact model
- 1-1, group, and saved-messages chats; owner/member roles with per-member
  rights
- Messages: send/edit/delete, replies, pins, read receipts, typing
  indicators, presence (mutual contacts only)
- Attachments: staged upload, photo preview / file download, member-gated
  access (25 MiB limit)
- Realtime delivery over WebSocket with per-session sequencing, replay and
  resync
- Sessions: per-device list and revoke (per-session + logout)
- PWA shell: installable, offline connectivity states

**Designed, not shipped:** private layer (E2EE, SAS verification,
burnable chats).

**Stubbed (501 `not_implemented`):** push notifications, abuse reports.

## Tech Stack

- **Backend:** Go monolith — REST + WebSocket hub (`cmd/server`,
  `internal/`)
- **Frontend:** Vue 3 + Vite micro-frontend core (`packages/core`) +
  per-platform shells; PWA is the MVP shell (`apps/pwa`)
- **Data:** PostgreSQL (public layer); Redis provisioned for future
  presence/rate-limit roles (health-checked only today)
- **Dev infra:** Qdrant + TEI for the docs knowledge base — not in the
  message path
- **Infra:** Docker Compose; managed hosting ≤100 users/instance

## Getting started

Backend + database:

```bash
git clone https://github.com/jojouHZ/openglass.git
cd openglass
docker compose up -d postgres redis
OPENGLASS_DEV_MODE=1 go run ./cmd/server   # listens on :8081
```

PWA shell:

```bash
cd apps/pwa && pnpm install && pnpm dev
```

Two API modes (`apps/pwa/.env.example`):

- `VITE_API_MODE=live` — proxies `/api` to the real backend above
- `VITE_API_MODE=mock` — MSW + typed fixtures, no backend needed
  (frontend-first development)

`OPENGLASS_DEV_MODE=1` enables a dev-only JWT secret — **never use it
deployed**; set `OPENGLASS_JWT_SECRET` instead.

## Security model

The public layer is **server-trusted**: messages are stored and readable
by the host (TLS in transit, access control server-side). That is a
deliberate MVP trade-off, documented in
[docs/architecture/05-threat-model.md](docs/architecture/05-threat-model.md).
The confidentiality guarantee lives in the private layer — which is not
shipped yet, so treat every current conversation as host-readable.

## Documentation

- [Architecture](docs/architecture/00-overview.md) — full system docs
- [Private layer design](docs/architecture/02-private-layer.md)
- [Threat model](docs/architecture/05-threat-model.md)
- [API contract](docs/api/public-api.openapi.yaml) ·
  [WS events](docs/api/ws-events.md) · [Errors](docs/api/errors.md) ·
  [Relay events](docs/api/relay-events.md) *(design)*
- [UI Kit](docs/ux/ui-kit.md) · [Components](docs/ux/components.md) ·
  [Design tokens](docs/ux/design-tokens.md)
- [AI workflow](docs/ai-workflow.md) — RAG knowledge pipeline and
  human-gated, AI-assisted development process

## Feedback and contributing

- Bug reports and enhancement requests:
  [GitHub Issues](https://github.com/jojouHZ/openglass/issues)
- Security reports: see [SECURITY.md](SECURITY.md) — please use GitHub
  private vulnerability reporting.
- Contributions go through pull requests; requirements are in
  [CONTRIBUTING.md](CONTRIBUTING.md).

## AI-Driven Development

This project is built with an AI-assisted workflow backed by a persistent
project knowledge base: documentation, success cases, and post-mortems are
vectorized (BGE-large → Qdrant) and searchable. Tasks run through a
human-gated review cycle — every change is reviewed before approval. See
[docs/ai-workflow.md](docs/ai-workflow.md).

## License

[AGPLv3](LICENSE) — network use requires source disclosure (closes the SaaS
loophole) and enables dual licensing for commercial clients.
