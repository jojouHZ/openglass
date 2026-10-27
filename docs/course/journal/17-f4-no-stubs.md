# 17 — F4: no stubs

**Goal.** Every route and every UI element either works or does not
exist. After F4 nothing in the server answers `501`, no document says
"stubbed", and the operator can act on what users send.

## What changed
- **Push left the contract** (4 routes, schema, client, mock, docs). A
  pretend `501` is worse than an honest 404: web-push returns post-MVP as
  one complete feature.
- **Reports became real.** `POST /reports` stores `{reporter, target,
  reason}` (migration 0005), per-user rate limited, validated (trimmed
  1..1024 characters, no self-report, unknown or malformed target is 404).
  A report has *no automatic effect*: the reported user is never told, the
  reporter learns "received", not an outcome. The profile (S7) got a
  report action and an isolated dialog that says exactly this.
- **Reports outlive accounts.** User references are `ON DELETE SET NULL`
  and both tags are snapshotted — found in plan review, before any
  account-deletion feature exists to make it a bug.
- **`ogadmin`**, the operator CLI (`reports list/resolve`, `invites
  create/list`), talks to Postgres directly: no admin HTTP surface, so
  nothing to authenticate or attack. It also delivers the invite tool the
  docs had promised for months — the audit found that no such tool existed
  and operators had to `INSERT` codes by hand.

## Decisions
- Minimal report: user + reason. Categories and message/chat targets need a
  content-snapshot policy and wait for post-MVP.
- The owner sees who reported (single-operator instance); the dialog says
  so before the user writes anything.
- Report text is user-controlled and ends up on an operator terminal, so
  `ogadmin` prints it quoted (escape sequences and bidi overrides are
  shown, never executed) — covered by a test.

## Guarding the north star
A route table cannot be enumerated from a `ServeMux`, so the guard parses
`server.go` and the OpenAPI document and requires the two to match (WebSocket
upgrade endpoints are specified separately). A second test fails if
`not_implemented` or `StatusNotImplemented` ever returns to `internal/`.
The first run of the guard immediately proved its worth in the other
direction: it found `/healthz` documented but my naive filter had hidden it.

## War stories
- A test fixture reused fixed e-mails and passed once, then failed on the
  second run against a persistent Postgres — fixtures that touch a shared
  database need unique names.
- The first draft of the report-validation test hit the new rate limit
  itself; limits are part of the fixture.
- **Review catch — no body cap.** Probing the new endpoint with a 30 MiB
  body showed the server buffered all of it before validating; the
  decoder had no limit on *any* JSON endpoint (including the public OTP
  request). Fixed once, in `decode` (1 MiB), with a test that was verified
  to fail without the fix — the first draft of that test passed either way
  because validation also answered 400.
- `ogadmin reports resolve not-a-uuid` leaked a raw Postgres error; it now
  validates the id and reports a usage error.
