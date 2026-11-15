#!/usr/bin/env bash
# Copyright (C) 2025 OpenGlass contributors
# SPDX-License-Identifier: AGPL-3.0-only
#
# Local gate — everything CI runs, in one command, for branches that are not
# pushed (so CI cannot vouch for them). Fails fast; prints a summary.
#
#   pnpm gate                # full gate
#   GATE_ONLY=go pnpm gate   # Go side only (gofmt, lint, race tests + Postgres)
#   GATE_ONLY=web pnpm gate  # web side only (typecheck, unit, build, guard, E2E)
#   GATE_SKIP_E2E=1 …        # skip the browser run (e.g. no Chromium libs)
#
# Needs: Go + golangci-lint on PATH, Postgres (OPENGLASS_TEST_PG_DSN) for the
# store-parity tests, and for E2E: PLAYWRIGHT_BROWSERS_PATH / LD_LIBRARY_PATH.
#
# Local toolchain defaults: when Go, the Chromium shared libraries or a
# Playwright browser cache exist in their usual per-user locations and the
# variables are not already set, they are picked up automatically. CI sets
# its own environment, so none of this applies there.
#
# Note: CI does not run the Postgres-backed store-parity tests; only this
# gate does, so changes to the Go data layer (pgx, store/) must run it.
set -uo pipefail
cd "$(dirname "$0")/.."

# --- local toolchain defaults (only when present and not already set) ---
if ! command -v go >/dev/null 2>&1; then
  for d in "$HOME/sdk/go/bin" /usr/local/go/bin; do
    [ -x "$d/go" ] && PATH="$d:$PATH" && break
  done
fi
[ -d "$HOME/go/bin" ] && case ":$PATH:" in *":$HOME/go/bin:"*) ;; *) PATH="$HOME/go/bin:$PATH";; esac
export PATH
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d "$HOME/pw-browsers" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/pw-browsers"
fi
if [ -z "${LD_LIBRARY_PATH:-}" ] && [ -d "$HOME/pwlibs/usr/lib/x86_64-linux-gnu" ]; then
  export LD_LIBRARY_PATH="$HOME/pwlibs/usr/lib/x86_64-linux-gnu"
fi

only="${GATE_ONLY:-all}"
case "$only" in all|go|web) ;; *) echo "GATE_ONLY must be all, go or web (got: $only)" >&2; exit 2;; esac
run_go() { [ "$only" = all ] || [ "$only" = go ]; }
run_web() { [ "$only" = all ] || [ "$only" = web ]; }

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

if run_go; then
  step "gofmt"            bash -c 'test -z "$(gofmt -l cmd internal)" || { gofmt -l cmd internal; exit 1; }'
  step "golangci-lint"    golangci-lint run ./...
  step "go test -race (Mem + Postgres)" go test -race -count=1 ./...
fi
if run_web; then
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
fi

printf '\n=== gate summary\n'
printf '%s\n' "${results[@]}"
exit "$failed"
