# Course Bundle — Draft Module Outline

Status: draft. Production starts after MVP; entries in `journal/`
accumulate as the phases land.

| # | Module | Source material (journal entries) |
|---|--------|-----------------------------------|
| M0 | Product: two-layer privacy, threat model, why self-hosted | product notes, security reviews |
| M1 | Agent-driven development: agent hierarchy, Qdrant knowledge base, code graph | AGENTS.md, .devin/skills, infra setup |
| M2 | Contract-first development: OpenAPI + WS contract + MSW, frontend before backend | `docs/api/*`, journal/01 |
| M3 | Go monolith: auth (OTP/invite/JWT rotation), store interface Mem/PG, migrations | journal/02 |
| M4 | Realtime: WS first-frame auth, per-session seq, in-memory replay ring, resync.required, presence/typing | journal/03 |
| M5 | Private layer: E2EE, zero-knowledge relay without Redis | *not built yet — flagship module* |
| M6 | One core, three shells: MFE core → PWA, Capacitor, Electron | *post-MVP* |
| M7 | Security & ops: threat model, gosec/govulncheck/trivy, review process with real findings | journal/02, 03 |

Each module = theory + the actual repo code/commits as the lab.
