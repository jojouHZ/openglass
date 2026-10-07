# Security Policy

OpenGlass is a self-hosted secure messenger. We take vulnerability
reports seriously — especially anything touching authentication,
authorization, the realtime relay, or (once shipped) the private
layer's cryptography.

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
- **Private-layer cryptography is not yet shipped** — see
  `docs/architecture/02-private-layer.md`; reports about the designed
  scheme are welcome as issues, not vulnerabilities.
- **Out of scope:** attacks requiring physical access to the server,
  self-inflicted misconfiguration (e.g. disabling TLS on your own
  deployment), and social engineering.

## Supported versions

The project is pre-1.0: only `main` and the latest tagged release
receive fixes.

## Hardening notes for operators

- Terminate TLS at a reverse proxy; never expose :8081 publicly
  without it.
- `OPENGLASS_DEV_MODE` emits OTP codes to logs — never enable it on a
  real deployment.
- Rotate the JWT secret on any suspected compromise; active sessions
  invalidate on restart.
