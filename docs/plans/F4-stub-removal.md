# Slice F4 — No Stubs: push leaves the contract, reports become real

Goal (north star, `docs/ROADMAP.md`): every route and every UI element
either works or is absent. After F4 no endpoint answers `501`, nothing in
the docs says "stubbed", and the operator can actually act on what users
send them. Runs on `main`, before the redesign branch (F5) so the removed
surface is not restyled and the new report dialog is a small, isolated
file.

## What exists today (audited)

| Item | State |
|------|-------|
| `GET/POST/DELETE /push/*` (4 routes) | answer `501`; no UI uses them (S15 push card is already hidden) — still in `server.go`, `public-api.openapi.yaml`, generated schema, `ApiClient.push`, `HttpApiClient.push`, MSW mock, README, `00-overview`, `01-public-layer`, `errors.md`, `flows.md` |
| `POST /reports` | `501`; contract is `{userId, reason ≤1024}` → `202`; `ApiClient.reports.report` exists; **no UI** (US-2.4 "report from the profile" was never built) |
| `notImplemented()` helper | used only by the stub loop in `server.go` |
| `TestStubsAre501_NotSilent` | encodes the stubs as a feature |
| Invite issuance | docs promise "admins generate invites via a local CLI"; **no such tool exists** — today an operator must `INSERT INTO invites` by hand |
| `/states` dev route + `_PlaceholderView.vue` | dev-only (`import.meta.env.DEV`), absent from prod builds — a debugging aid, not a stub; **kept**, documented as dev tooling |

## Decisions (made here; reversible)

1. **Push is removed, not hidden.** Routes, contract entries, client
   methods and mocks go; push stays a post-MVP *complete* feature
   (ROADMAP). The `session`/SW code is untouched.
2. **Reports keep the contract shape** (`userId` + `reason`) — no
   categories, no message/chat targets yet. Less surface, nothing invented.
   Message/chat reporting is post-MVP (it needs a content-snapshot policy).
3. **A report has no automatic effect.** No auto-ban, the reported user is
   never notified, the reporter gets "received" — not "reviewed".
4. **Operator read path = a small CLI** (`cmd/ogadmin`), because a report
   nobody can comfortably read is another stub. The same binary delivers
   the invite tool the docs already promise. **Confirmed by the owner.**
5. **The operator sees who reported** (single-operator instance) — stated
   in the dialog copy. **Confirmed by the owner.**
6. **Reports outlive accounts**: `reporter_id` / `target_user_id` use
   `ON DELETE SET NULL` plus a stored `target_tag` snapshot — deleting an
   account must not erase evidence (review finding). There is no account
   deletion today; this keeps the schema ready.

## Work, in order

### A. Remove push (pure deletion)
- `internal/api/server.go`: drop the 4 `/push/*` routes and the stub loop.
- `docs/api/public-api.openapi.yaml`: delete `/push/*` paths and the
  schemas only they used; regenerate `schema.gen.ts`.
- `packages/core`: delete `ApiClient.push`, `HttpApiClient.push`, the MSW
  `push` handlers and fixtures.
- Docs: README "Stubbed" line removed; `00-overview` maturity wording
  ("stubbed") dropped; `01-public-layer` Notifications section rewritten
  as "post-MVP"; `flows.md` S15 note; `errors.md` drops `not_implemented`.
- Regression: a contract test asserts `GET /push/vapid-key` is **404**
  (route gone), not 501.

### B. Reports, for real
**B1 — storage & API (backend agent)**
- Migration `0005_reports.sql`:
  `reports(id uuid pk, reporter_id → users ON DELETE SET NULL,
  target_user_id → users ON DELETE SET NULL, target_tag text,
  reason text 1..1024, status 'open'|'resolved' default 'open',
  created_at, resolved_at, resolved_note)`; index on `(status, created_at)`.
- `POST /reports` → validation (`reason` trimmed, 1..1024; target must
  exist → 404; not yourself → 400), per-user token bucket (new
  `ReportRate` in the existing limiter config, default burst 5, 6/min),
  `202 {report: {id, status: "received"}}`. Duplicate reports are allowed
  (rate-limited) — a second report is signal, not noise.
- Store interface `CreateReport/ListReports/ResolveReport`, Mem + PG with
  the same parity suite as F1.
- `ErrInvalid`/`ErrNotFound` mapping reused; no new error codes.

**B2 — UI (PWA shell + frontend core)**
- `ApiClient.reports.report` returns `{ id }`; mock handler updated.
- S7 profile: **report** action for every non-self user, in the same
  group as "remove contact" (low emphasis, text button).
- `ReportDialog.vue` (new, isolated): reason textarea with live counter
  (1024), submit disabled when empty, success state "report sent — the
  instance owner can read it; you won't be notified of the outcome",
  inline error on `429` with a retry hint. It uses the existing modal
  pattern now; F5 swaps it for the Reka dialog (new file → no rebase
  conflict).
- No entry in message menus / chat lists in F4 (post-MVP).

**B3 — operator CLI (DevOps + backend agents)**
- `cmd/ogadmin`: stdlib `flag` + `pgx`, reads `OPENGLASS_PG_DSN` like the
  server; subcommands
  `reports list [--status open|resolved|all]`,
  `reports resolve <id> [--note ...]`,
  `invites create [--uses N] [--days N]`, `invites list`.
- Plain text, no colour codes, exit code ≠ 0 on error; unit-tested against
  a Mem-free path by factoring the query layer behind the existing store
  where possible, otherwise Postgres-gated tests like `pg_test.go`.
- Dockerfile builds it next to the server (`/usr/local/bin/ogadmin`);
  operator usage: `docker compose exec server ogadmin reports list`.
- Docs: `docs/architecture/01-public-layer.md` ("Operator surface").

### C. Sweep and guard
- Delete `notImplemented` from `envelope.go` and
  `TestStubsAre501_NotSilent`; golangci `unused` keeps it deleted.
- Repo guard (a Go test): walk the router's route table (not the OpenAPI
  paths — parameters make smoke calls brittle) and assert that no
  registered route is served by a stub; additionally grep-style test that
  `not_implemented` appears nowhere in `internal/`. Fails the build if a
  stub is ever reintroduced. The OpenAPI path set and the route table must
  match (also catches contract drift).
- `README`, `ROADMAP`, journal `17-f4-no-stubs.md`, vectorize.

## Order and commits (each commit leaves `main` green)
1. `F4a` — push removal (server, contract, schema, client, mock, docs) +
   404 test.
2. `F4b` — migration `0005`, store `Create/List/ResolveReport` (Mem+PG
   parity), `POST /reports`, limiter, API tests, contract/schema.
3. `F4c` — core client/mock + PWA `ReportDialog` + S7 action + unit tests.
4. `F4d` — `cmd/ogadmin` + Dockerfile + operator docs + tests.
5. `F4e` — sweep (`notImplemented`, stub test), route-table guard, E2E,
   journal `17-f4-no-stubs.md`, vectorize.
Before each push: Go race tests (Mem+PG), lint, PWA tests **3 runs in a
row**, core tests, typecheck, build, bundle guard; before the last push
also the full local Chromium E2E. New async tests wait on conditions
(`vi.waitFor`), never on fixed delays.

## Tests
- **Backend:** report create (valid, whitespace-only, too long, self,
  unknown target, unauthenticated), rate-limit trip and per-user
  isolation, Mem/PG parity for `Create/List/Resolve`, push routes → 404,
  contract guard (no 501 anywhere).
- **Core:** mock contract test for `reports.report`; push surface gone
  from the client type (compile-time).
- **PWA:** S7 report flow (open dialog, counter, submit disabled when
  empty, success state, 429 state); S15 unchanged.
- **E2E (real browser):** Alice reports Bob from his profile → the row is
  in the table (fixture exposes a test-only count via the store) and the
  UI shows the acknowledgement.
- **CLI:** list/resolve against a seeded Postgres.

## Agent notes
- **Product Manager:** closes the "no stubs" promise; reports are
  deliberately minimal and honest about what they do. Explicitly *not*
  in scope: moderation tooling, bans, appeals, report categories.
- **PWA Shell:** one new dialog + one profile action; zero changes to the
  redesign branch's files except none (new file, one S7 hunk).
- **Backend:** one migration, one handler, one limiter spec, one CLI.
- **Frontend Core:** shrinks the `ApiClient` surface; touches only client
  types, HTTP client, mock.
- **Security:** reports contain free text from users — rendered as plain
  text only in the CLI (no HTML anywhere), length-capped, rate-limited,
  never echoed to the target; reporter identity is operator-visible by
  design and stated in the dialog copy. `ogadmin` needs DB credentials, so
  it is operator-only by construction (no network surface added).
- **DevOps:** migration `0005` forward-only; new binary in the image; CI
  builds `./cmd/...` already. Dependabot PR #46 (certifi) is merged.
- **Testing:** the "no 501 anywhere" guard is the regression net for the
  whole north star; E2E covers the only new user-visible flow.

## Risks
- A report is evidence of nothing the operator can verify automatically —
  copy must not promise action.
- Deleting push from the contract is a breaking API change for any
  third-party client; none exist (single deployment class).
- The CLI is new operator-facing surface: keep it tiny; anything that
  grows into moderation belongs to the post-MVP admin surface.

## Open for owner review
None — `ogadmin` and operator-visible reporter identity were confirmed.
