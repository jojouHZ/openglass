# Journal 02 — Contract-first development (issues #8–#11)

**Phase:** API contract (8 revision rounds), MFE core scaffold (#8),
MSW mock layer (#9), onboarding S1–S3 (#10), chat S4–S5 (#11).

## Eight rounds before code

The OpenAPI spec and the WebSocket event catalog went through **eight
dedicated review rounds** before implementation began — invite issuance
scope, param exclusivity, forward pagination, event symmetry, nullable
verify-user, session-scoped WS seq, message pinning, first-frame auth,
mutual-contact completion, re-login flow, idempotency. Each round was a
commit; none of them touched code. The contract is the cheapest place
to find design bugs — every round removed a change that would have cost
days later.

## What was built

The entire Vue 3 frontend was developed against a network-level mock
(MSW) before a single backend endpoint existed. The authoritative
contract lives in `docs/api/public-api.openapi.yaml` (REST) and
`docs/api/ws-events.md` (realtime); `packages/core/src/api/schema.gen.ts`
is generated from the spec, so the client types cannot drift.

## Why it worked

- Frontend and backend teams (agents) never blocked each other: the mock
  defined behavior, the backend later had to match it bit-for-bit.
- Contract divergence surfaced as *tests*, not as integration pain:
  when B1 REST landed, every mismatch between mock and spec (e.g. mock
  `addContact` returning 200 where the spec mandates 409) was caught by
  contract tests.

## Lessons captured

- A mock that is *more permissive* than the contract silently trains the
  frontend into wrong assumptions — the mock must be tightened whenever
  the spec is stricter.
- Stable error envelope (`{error:{code,message,details}}`) with
  `404 = absent or invisible` is a privacy decision, not just an API
  style choice: it prevents resource-existence probing.
- `501 not_implemented` for contracted-but-unbuilt routes keeps "route
  missing" distinguishable from "route doesn't exist" during bring-up.
