# Security Policy

OpenGlass is a self-hosted secure messenger. We take vulnerability
reports seriously — especially anything touching authentication,
authorization, the realtime relay, or the private layer's cryptography.

## Reporting a vulnerability

**Do not open a public issue for security reports.**

Report via GitHub's private
[security advisory](https://github.com/jojouHZ/openglass/security/advisories/new)
form — include a description, affected version/commit, and
reproduction steps. A dedicated security mailbox lands with the public
release; until then advisories are the channel.

We aim to acknowledge within 72 hours and give a severity assessment
within a week. If the report is confirmed we will coordinate a fix and
a disclosure timeline with you; credit is given in the release notes
unless you prefer to stay anonymous.

## Scope

- **In scope:** auth/session handling (JWT, refresh rotation, revocation),
  contact & group authorization, message delivery/visibility rules,
  WebSocket relay (auth gates, replay/resync, presence privacy),
  attachment handling (member gating, MIME sniffing, existence privacy),
  dependency supply chain, deployment defaults.
- **Private layer ships in the dev host** (`VITE_PRIVATE_MODULE=1` +
  live API mode) and is gated out of the production PWA bundle. It is
  dev-tier — ephemeral per-session ECDH keys held in memory, no
  hardware keystore yet; see `docs/architecture/02-private-layer.md`.
  Findings on its crypto, relay framing, or teardown are in scope.
- **Out of scope:** attacks requiring physical access to the server,
  self-inflicted misconfiguration (e.g. disabling TLS on your own
  deployment), and social engineering.

## Supported versions

The project is pre-1.0: only `main` and the latest tagged release
receive fixes.

## Dependency policy

- Dependabot proposes updates weekly and waits 7 days after a release
  before proposing it (`cooldown` in `.github/dependabot.yml`). Security
  updates ignore the cooldown.
- GitHub Actions are pinned to full commit SHAs; Docker base images are
  pinned to digests.
- When a vulnerable package arrives only through a transitive dependency
  that its parent has not released a fix for, it is forced to a fixed
  version through `overrides` in `pnpm-workspace.yaml`, choosing the newest
  version that is at least 7 days old.
- Advisories that affect only test or CI tooling (not the production
  bundle or the server binary) are still fixed, but are triaged below
  advisories that reach the shipped artifacts.

## Hardening notes for operators

- Terminate TLS at a reverse proxy; never expose :8081 publicly
  without it.
- `OPENGLASS_DEV_MODE` emits OTP codes to logs — never enable it on a
  real deployment.
- Rotate the JWT secret on any suspected compromise; active sessions
  invalidate on restart.
