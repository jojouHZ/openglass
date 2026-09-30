# Journal 03 — CI pipeline and security tooling (Phase C)

**Phase:** the agreed order was C→B→A — tooling before more features.

## What CI runs on every commit

- **Go job** — `gofmt` diff, `go vet`, `go build`, `go test`,
  `golangci-lint`.
- **Frontend job** — `pnpm install --frozen-lockfile`, typecheck
  (`vue-tsc`), tests, build, `pnpm audit` (critical, advisory).
- **Security job** — `govulncheck` + Trivy filesystem scan.

## Design decisions worth teaching

- **Security scans are a stage, not a promise.** govulncheck and Trivy
  run in the same pipeline as tests — a CVE is a build failure class,
  not a quarterly audit event.
- **Dependency upgrades as a security action.** The phase included
  bumping CVE-flagged dependencies — tooling without a remediation
  habit is just a red dashboard.
- **Advisory vs blocking.** `pnpm audit` runs advisory while Go checks
  block — noise budget spent deliberately: block on what you will
  actually fix, keep signal visible on the rest.
- **Pinned images.** Compose pins `qdrant:v1.19.1` and puts the
  embedder behind a `kb` profile — reproducible dev environments,
  opt-in heavy services.

## War stories

- `trivy-action` tag requires a `v` prefix (`v0.36.0`) — a one-line CI
  failure that cost a debugging cycle. Pinned external actions are
  dependencies too; their changelogs matter.
- Knowledge-base venv (`.venv-kb`) had to be gitignored mid-flight —
  infrastructure experiments leak into the repo surface unless the
  boundary is enforced continuously.
