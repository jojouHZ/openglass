# Course Bundle — Draft Module Outline

Status: draft. Production starts after MVP; entries in `journal/`
accumulate as the phases land.

| # | Module | Source material (journal entries) |
|---|--------|-----------------------------------|
| M0 | Product: two-layer privacy, threat model, why self-hosted | journal/00, security reviews |
| M1 | Agent-driven development: agent hierarchy, Qdrant knowledge base, code graph, bad-case memory | journal/00 |
| M2 | Contract-first development: 8 rounds of API review, OpenAPI + WS contract + MSW, frontend before backend | journal/01 |
| M3 | Go monolith: auth (invite/OTP/JWT rotation/sessions), store interface Mem/PG, migrations | journal/02 |
| M4 | Realtime: WS first-frame auth, per-session seq, in-memory replay ring, resync.required, presence/typing | journal/05 |
| M5 | Private layer: E2EE, zero-knowledge relay without Redis | *not built yet — flagship module* |
| M6 | One core, three shells: MFE core → PWA, Capacitor, Electron | *post-MVP* |
| M7 | Security & ops: CI stages, gosec/govulncheck/trivy, review process with real findings | journal/03, 04, 05 |
| M8 | Messaging domain depth: idempotency, cursors, tombstones, existence privacy, mutual contacts | journal/04 |
| M9 | Debugging craft: token-collision CSS, test isolation, live-smoke methodology | journal/04, 06 |

Each module = theory + the actual repo code/commits as the lab.
