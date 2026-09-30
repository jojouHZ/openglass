# Journal 03 — Backend skeleton and authentication (issue #12)

**Phase:** first Go code. Monolith skeleton, config, migrations, the
full auth surface against both Mem and PostgreSQL stores.

## The auth model

- **Invite-gated registration** — `otp/request` only issues a code when
  either the email is already known or a valid `inviteCode` is passed;
  the invite is consumed only after successful OTP verify, per contract.
- **OTP** — single-use codes with TTL, resend cooldown, and bounded
  attempts (`attemptsLeft` surfaced in errors). Dev mode logs codes
  instead of sending mail (`OPENGLASS_DEV_MODE=1`, CaptureSender in
  tests).
- **Token pair** — short-lived access JWT (carries userID + sessionID +
  exp) + rotating refresh. Refresh reuse or a revoked hash marks the
  whole session dead — rotation detection instead of silent acceptance.
- **Sessions** — per-device; `GET /auth/sessions` lists only the owner's,
  `DELETE /auth/sessions/{id}` returns `not_found` for foreign ones
  (existence privacy again), logout revokes the current session.
- **Profile completion** — `needsProfile` flag bridges verify → S3;
  `displayName` + normalized `tag` (`name#0001`) with conflict handling.

## Design decisions

- **`store.Store` interface from day one** — `Mem` for contract tests,
  `PG` for production. Same behavior, two backends; the B1 chat store
  later extended the same interface instead of forking semantics.
- **Migrations as numbered SQL files** (`0001_init.sql`) applied
  idempotently at startup — no external migration tool dependency.
- **Review pass hardened it further** — auth tweaks + migration
  bookkeeping landed in a follow-up commit before the issue closed.

## War stories

- PG integration tests initially flaked on a *persistent* dev database:
  fixed refresh hashes collided with previous runs' rows (already
  revoked → wrong branch taken). Fix: per-run suffixes. Rule learned:
  on a shared database, every test fixture must carry a run-scoped
  identity.
