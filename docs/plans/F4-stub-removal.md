# Slice F4 — Stub Removal: No Placeholders Ship (LAST)

Goal: every route/UI element either works or is absent. The contract
shrinks to what the server actually does.

## Scope

| Stub | Disposition |
|------|-------------|
| `GET/POST/DELETE /push/*` (4 routes) | **Remove** — from `server.go`, `public-api.openapi.yaml`, `errors.md`, MSW mocks. Push notifications documented post-MVP (ROADMAP). |
| `POST /reports` (501) | **Implement minimal**: `reports` table (reporter, optional chat/message/user target, category, text, created_at) + real `POST` handler. Read side: no admin UI yet — documented as operator-visible via DB until the admin surface (post-MVP) lands. This keeps the route honest: it stores, audits, and acknowledges. |
| `_PlaceholderView` route (`/states`) | remove route + file |
| "private / work" folder placeholders | already removed by F3 (U-3) |
| Any other `notImplemented` handlers | sweep + delete |

## Details

- New migration `0004_reports.sql` — flat table, no relations beyond
  FKs to users/chats/messages.
- `POST /reports` validation: target kinds `user|chat|message`,
  category enum (`spam|abuse|illegal|other`), rate-limited by the
  existing per-IP bucket (reuse `rateLimiter`, e.g. 10/min burst 3).
- Response: `201 {report: {id, status:"received"}}` — no false promise
  of review workflow.
- OpenAPI/errors/MSW updated in the same commit — contract stays the
  source of truth.
- `internal/api/envelope.go` `notImplemented` helper deleted — nothing
  calls it after the sweep (CI enforces dead-code absence via lint).

## Tests

- Contract: report create (valid + per-kind), validation errors,
  rate-limit trip, reporter auth required.
- Regression: removed push routes return 404 (not 501) — contract test.

## Docs

- `errors.md`: drop `not_implemented` row if unused.
- `docs/architecture/01-public-layer.md`: reports section.
- README "Stubbed" line → removed entirely (the point of the slice).
- Journal `F4-no-stubs.md`.
