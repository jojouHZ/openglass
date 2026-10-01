# Contributing to OpenGlass

Thanks for your interest. OpenGlass is currently in an MVP phase driven by a
single maintainer; external contributions are welcome through GitHub.

## How to contribute

- Bug reports and enhancement requests: open a
  [GitHub issue](https://github.com/jojouHZ/openglass/issues).
- Code changes: open a pull request against `main`. Keep changes focused;
  describe the problem and the approach in the PR body.
- Security issues: do NOT file a public issue — use GitHub private
  vulnerability reporting as described in [SECURITY.md](SECURITY.md).

## Requirements for acceptable contributions

- **Language:** all committed documentation and code comments are in English.
- **License:** contributions are licensed under AGPLv3; new source files
  carry the SPDX header
  (`# Copyright (C) 2025 OpenGlass contributors` /
  `SPDX-License-Identifier: AGPL-3.0-only`).
- **Tests:** new features and bug fixes come with tests. `go test ./...`,
  `pnpm test` in `apps/pwa` and `packages/core` must pass.
- **CI green:** gofmt, `go vet`, golangci-lint, vue-tsc typecheck, and the
  test suites are enforced in CI.
- **Privacy posture:** keep the public-layer/private-layer separation
  documented in `docs/architecture/` — private (E2EE) code must never leak
  into the public `pwa-mvp` build.

## Commit style

Short imperative subject lines; focus commit messages on the "why".
Conventional-style prefixes (`feat:`, `fix:`, `ci:`, `docs:`) are welcome.
