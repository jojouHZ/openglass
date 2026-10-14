# Slice #10 — Testing & Security Review (pre-release pass)

A release-gate audit across four areas: documentation honesty, code-level
security, test-gap coverage, and repo hygiene. Findings were fixed in the
slice where material; the rest are recorded here.

## 1. Honesty audit — claims vs code

Four docs still described the private layer as "designed, not shipped",
which stopped being true once the dev-host build and its E2E landed:

- `SECURITY.md` — "Private-layer cryptography is not yet shipped" → now
  states the layer ships in the dev host, is gated out of the production
  bundle, is dev-tier (in-memory ephemeral keys, no hardware keystore),
  and that crypto/relay/teardown findings are in scope.
- `README.md` — status list, security-model paragraph, and the
  `relay-events.md` link (no longer "(design)" — the endpoint exists).
- `docs/architecture/05-threat-model.md` — core guarantee, server-sees
  table, attack-surface heading, and the user-facing trust statement.
- `docs/architecture/02-private-layer.md` — status banner: DESIGN →
  IMPLEMENTED (dev tier), with the dev-tier caveats spelled out.

Deliberate wording kept: production-deployed conversations remain
public-layer and host-readable; the private guarantee stays conditional
on SAS verification. No unverified claims added.

## 2. Code security audit — clean

- **Crypto engine** (`packages/core/src/private/engine.ts`): fresh
  12-byte random IV per AES-GCM envelope (no nonce reuse), ECDH P-256 →
  non-extractable session key, private key never exportable, SAS derived
  from both public keys in canonical byte order.
- **Blind relay**: receipts and message types live inside the ciphertext —
  the wire carries only `key`/`msg` envelopes, indistinguishable to the
  server.
- **Logging sweep**: no `console.*`/`log.*` of keys, plaintext, blobs, or
  session pairing anywhere in private code. `LogSender` logs OTP codes
  only under `OPENGLASS_DEV_MODE` (already documented as deploy-never).
- **Boundary**: zero runtime references to `usePrivateStore` outside the
  private module; host sees whitelist snapshots only.

Observation (accepted, not a finding): WebCrypto `deriveKey` applies the
raw ECDH secret directly as the AES-GCM key with no HKDF domain
separation — standard for this scheme and adequate at dev tier; an
upgrade path exists if the key hierarchy grows.

## 3. Test-gap coverage — public-layer browser E2E added

The private layer had real-browser E2E; the public layer had none
(happy-dom + unit only — the exact blind spot that hid the E.6 class of
bugs). Added `apps/pwa/e2e/public-smoke.spec.js`: two seeded sessions,
Alice sends a public text via the composer, both clients assert the same
message renders in `msg-scroll` (live WS delivery).

## 4. Repo hygiene — local tooling broke `go test ./...`

Local-only agent tooling (`internal/knowledge`, `internal/codegraph`,
`internal/vector`, `cmd/main.go`, `cmd/codegraph`) is intentionally
untracked (`.gitignore: internal/*` except product packages), but it sat
inside the Go module with deps absent from `go.mod`, so any `go
build/test ./...` failed locally while CI (which never sees the files)
stayed green — a confusing split for any agent.

Fix (local-only, invisible to the repo): `//go:build devtools` constraint
on the untracked files. `go test -race ./...` now passes locally; the
tooling still rebuilds with `-tags devtools`.

## Verified

- `go build ./...` + `go test -race ./...` — full module green locally
- Honesty docs updated + re-vectorized to Qdrant
- New E2E spec committed; validated in CI (local Playwright browsers
  unavailable — CI is authoritative)

## Known gaps carried forward (documented in threat-model)

- IP-level rate limiting on auth endpoints — **not wired**; only OTP
  attempt limits exist.
- Screenshot detection — post-core, never presented as prevention.
- Multi-tab private sessions — documented MVP limitation.
