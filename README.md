# OpenGlass

Self-hosted secure messenger with two privacy layers: a server-trusted public
layer and an ephemeral, zero-persistence private layer.

## Features

- Email + one-time-code registration (invite-only, closed-circle hosting)
- Contacts by nickname/ID
- Public layer: 1-1 and group chats (party/raid model), attachments,
  edit/delete, read receipts, typing indicators, web push
- Private layer: ephemeral live E2EE sessions — blind relay, zero server
  storage, burnable chats with configurable lifetime
- PWA shell (MVP); iOS/Android/Desktop shells planned

## Tech Stack

- **Backend:** Go monolith (HTTP API + WebSocket relay)
- **Frontend:** Vue 3 + Vite micro-frontend core + per-platform shells
- **Data:** PostgreSQL (public layer), Redis (presence/rate-limit only)
- **Infra:** Docker Compose deployment, managed hosting ≤100 users/instance

## Documentation

- [Architecture](docs/architecture/00-overview.md) — full system docs
- [Threat model](docs/architecture/05-threat-model.md)
- [AGENTS.md](AGENTS.md) — agent system
- [Project checkup](docs/PROJECT_CHECKUP.md)

## Agent System

OpenGlass is built by a hierarchical agent team (orchestrator → specialist
agents) with human review gates. See [AGENTS.md](AGENTS.md).

## License

[AGPLv3](LICENSE) — network use requires source disclosure (closes the SaaS
loophole) and enables dual licensing for commercial clients.
