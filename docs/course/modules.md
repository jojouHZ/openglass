# Course Bundle — Draft Module Outline

Status: draft. Production starts after MVP; entries in `journal/`
accumulate as the phases land.

| # | Module | Source material (journal entries) |
|---|--------|-----------------------------------|
| M0 | Product: two-layer privacy, threat model, why self-hosted | journal/00, security reviews |
| M1 | Agent-driven development: agent hierarchy, Qdrant knowledge base, code graph, bad-case memory | journal/00 |
| M2 | Environment engineering: WSL, toolchains, IDE remote-mode, proxy/debug discipline | journal/01 |
| M3 | Contract-first development: 8 rounds of API review, OpenAPI + WS contract + MSW, frontend before backend | journal/02 |
| M4 | Go monolith: auth (invite/OTP/JWT rotation/sessions), store interface Mem/PG, migrations | journal/03 |
| M5 | Realtime: WS first-frame auth, per-session seq, in-memory replay ring, resync.required, presence/typing | journal/06 |
| M6 | Private layer: E2EE, zero-knowledge relay without Redis | *not built yet — flagship module* |
| M7 | One core, three shells: MFE core → PWA, Capacitor, Electron | *post-MVP* |
| M8 | Security & ops: CI stages, gosec/govulncheck/trivy, review process with real findings | journal/04, 05, 06 |
| M9 | Messaging domain depth: idempotency, cursors, tombstones, existence privacy, mutual contacts | journal/05 |
| M10 | Debugging craft: token-collision CSS, test isolation, live-smoke methodology, corrupted-read clients | journal/05, 06, 07 |

Each module = theory + the actual repo code/commits as the lab.
