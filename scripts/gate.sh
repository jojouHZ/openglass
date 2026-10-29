#!/usr/bin/env bash
# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only
#
# Local gate — everything CI runs, in one command, for branches that are not
# pushed (so CI cannot vouch for them). Fails fast; prints a summary.
#
#   pnpm gate            # full gate
#   GATE_SKIP_E2E=1 …    # skip the browser run (e.g. no Chromium libs)
#
# Needs: Go + golangci-lint on PATH, Postgres (OPENGLASS_TEST_PG_DSN) for the
# store-parity tests, and for E2E: PLAYWRIGHT_BROWSERS_PATH / LD_LIBRARY_PATH.
set -uo pipefail
cd "$(dirname "$0")/.."

PG_DSN="${OPENGLASS_TEST_PG_DSN:-postgres://openglass:openglass_dev@localhost:5432/openglass}"
export OPENGLASS_TEST_PG_DSN="$PG_DSN"
results=()
failed=0

step() {
  local name="$1"; shift
  printf '\n=== %s\n' "$name"
  if "$@"; then results+=("ok    $name"); else results+=("FAIL  $name"); failed=1; fi
}

repeat() { # repeat N cmd… — a flaky test must not pass by luck
  local n="$1"; shift
  for _ in $(seq "$n"); do "$@" || return 1; done
}

step "gofmt"            bash -c 'test -z "$(gofmt -l cmd internal)" || { gofmt -l cmd internal; exit 1; }'
step "golangci-lint"    golangci-lint run ./...
step "go test -race (Mem + Postgres)" go test -race -count=1 ./...
step "typecheck"        pnpm typecheck
step "core tests"       pnpm --filter @openglass/core test
step "pwa tests x3"     repeat 3 pnpm --filter @openglass/pwa test
step "build"            pnpm build
step "mvp bundle guard" pnpm verify:mvp-bundle
if [ -z "${GATE_SKIP_E2E:-}" ]; then
  step "e2e (real Chromium)" pnpm --filter @openglass/pwa e2e
else
  results+=("skip  e2e (GATE_SKIP_E2E set)")
fi

printf '\n=== gate summary\n'
printf '%s\n' "${results[@]}"
exit "$failed"
