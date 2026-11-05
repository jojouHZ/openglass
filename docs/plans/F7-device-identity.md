# Slice F7 — Device Identity & Verified Contacts (dev tier)

Owner decision (post-concept review): device-bound verification
(`docs/ux/flows.md` US-2.5, US-5.3a) is built **now**, in the dev PWA,
instead of waiting for the desktop shell. The release PWA contains no
private layer and therefore none of this. Desktop/native shells later
replace IndexedDB with platform keystores and gain hardware-backed unlock.

Supersedes: the interim per-session SAS comparison (F2's old
`k:"v"` / `peerConfirmed` plan is dropped — see F2).

## Model

```
device identity  = ECDSA P-256 key pair, private key non-extractable (IndexedDB)
pin              = { peerUserId, peerIdentityFingerprint, verifiedAt }  (local only)
directory        = untrusted server table of PUBLIC identity keys per user device
ritual           = both users compare a 5-emoji (or QR) fingerprint of
                   BOTH identity public keys, then each side pins the other
handshake        = ephemeral ECDH pub key signed by the identity key;
                   receiver verifies against the pinned key
invite rule      = a private session can be invited/accepted ONLY between
                   pinned pairs (unpinned → header shows a lock)
```

Verification is per **device pair**, never per account; a second device of
the same person is an unknown device until verified (no key backup, no
sync).

## F7a — identity, pins, directory, handshake (core of the slice)

### Core (`packages/core/src/private`)
- `identity.ts`: create/load identity per signed-in user; fingerprint
  helper (5-emoji + QR payload) derived from both public keys in canonical
  order (SHA-256).
- `pins.ts`: pin store (`openglass-private`, scoped by user id);
  `verifiedAt` date; "unknown device" detection; key-change detection.
- Handshake v2: sign the ephemeral ECDH public key; verify against pin;
  reject otherwise (no unverified session state exists).
- `PrivateRemote` additions (host gets whitelisted views only):
  - `watchVerification(peerId)` → `{ state: "unverified" | "verified" | "unknown-device" | "key-changed", verifiedAt? , deviceLabel? }`
  - `startVerification(peerId)` → ritual view (emoji[5] / QR payload) +
    `confirmVerification()` / `rejectVerification()`
  - `watchActiveSessions()` → peer ids with a live session (chat-list chip)
  - `forgetDevice()` → wipe identity + pins
- The host never sees keys; "verified" is computed in core from a
  cryptographic pin check, never from a host-settable flag.

### Backend
- Migration: `device_identity_keys(user_id, key_id, public_key, label,
  created_at, revoked_at)`.
- `PUT /users/me/identity-keys` (publish), `GET /users/{id}/identity-keys`
  (mutual contacts only), `DELETE /users/me/identity-keys/{keyId}`.
- Revoking a session in S14 also revokes its published key.
- **Contract:** `Contact.verifiedAt` is removed (verification is local and
  device-bound; the server must not learn who verified whom). OpenAPI,
  mock client, generated schema and contract tests updated together.

### UI hooks (already designed in concept 07)
- Header: lock "Verify" ↔ layer switch; composer slot: lock ↔ vertical
  view-once switch; Contacts: shield + date from local pins; chat list:
  `private` chip from `watchActiveSessions`.

### Zero-trace rules (changed)
Session data stays zero-trace as before; the identity DB is the *one*
persistent store (see `docs/api/relay-events.md`). The old module-stop assertion
"no `openglass-private` IndexedDB" is replaced by "the database contains
only identity + pins, no message or session material". Ordinary boot
preserves these persistent stores. Explicit sign-out/forget-device
teardown still deletes the entire database.

### Sign-out / switch user (owner-confirmed)
Until the F8 vault exists, identity and pins are scoped per user and
**destroyed on sign-out** and on "revoke this device" — otherwise a
second person signing in on the same browser would read the first user's
verified-contact graph in plaintext. After F8, sign-out *locks* the
encrypted vault and keeps it (see F8), so the same user re-verifies
nothing after logging back in.

## Device lock → moved to F8

The unlock factor, encrypted vault and attempt-limited wipe are their own
slice (`docs/plans/F8-device-vault-lock.md`) because they also protect
session tokens and apply to the **release** PWA. Until F8 exists, F7
keeps the simple rule below.

## Tests
- Core unit: identity create/load, fingerprint symmetry, pin store, key
  change, handshake accept/reject.
- **Adversarial relay test:** a relay that substitutes ephemeral keys must
  fail the handshake for a pinned pair.
- Real-browser E2E: ritual → pin → reload → session starts without a
  ritual; DB scan (no messages/session keys); sign-out wipes the DB;
  second user on the same browser sees no pins.
- Backend contract tests for the directory (mutual-only read, revoke).

## V2d incremental delivery

Owner-confirmed baseline: identity and pins are destroyed on sign-out;
the comparison format is six deterministic objects plus six digits.
The verification ritual UI belongs inside the existing chat in V3, not
in a new standalone screen.

### Owner decision A — persistence boundary

Identity and local pins survive ordinary reload, app close and unclean
restart. Private messages, ephemeral/session keys, resume tokens and
pending session state remain RAM-only and are not restored on restart.
Ending a session or stopping the module must not mean forgetting the
device. Sign-out and explicit forget/revoke-this-device destroy local
identity and pins; a different user must not inherit them.

Startup must await persistent-store preparation before loading identity
and pins. Stale initialization must not repopulate RAM after stop/logout,
and a subsequent boot must wait for any in-progress destructive cleanup.
Before the encrypted vault exists, persistent pins are an unencrypted
local verification graph, not a promise of no device traces.

Screen-lock/background/resume policy and O9 remain post-MVP Android work.
The owner's intended platform model adds app re-entry authentication
(face/fingerprint, passcode or authenticator; mechanisms to be designed)
and does not treat sleep/screen lock alone as a session-erasure trigger.
This is not authorization to persist private message history or raw
session keys in the current browser build. Native secure storage, session
retention limits and unlock semantics require a later security design.

### V2d.1 — directory transport

The private module owns `directory.ts`, a typed client for publishing,
listing and revoking public identity keys. Request types come from the
generated OpenAPI schema and HTTP handling reuses `HttpTransport`.
Publishing explicitly selects keyId, publicKey and label; extra runtime
properties (including private keys or verification timestamps) are not
serialized. Peer and key identifiers are encoded as individual URL path
segments. Directory failures propagate; a directory response never
creates a local pin or a verified state.

Transport tests cover PUT, both GET routes, DELETE/204, current bearer
token injection, path encoding, payload whitelisting and error propagation.
These are mocked HTTP tests, not evidence of browser ritual completion.

### V2d.1b — device-specific directory identifiers

Directory key IDs are the lowercase 64-character SHA-256 digest of the
public SPKI bytes, not the signed-in user's ID. Different device keys
for the same account therefore no longer collide at the directory's
`(user_id, key_id)` uniqueness boundary. This identifier is not evidence
of verification; trust still requires the local device-pair ritual.

The local IndexedDB address stays `ecdsa-p256-<userId>` so existing
non-extractable keys are reused without migration or export. A newly
generated identity after a local wipe receives a different directory ID;
loading the same stored identity preserves the ID. Existing directory
entries under the old account-derived ID, if any, are not revoked by this
change and must be handled by subsequent publication/revocation work.

Regression tests cover digest format, stable reload, replacement identity,
non-extractability and reuse of a pre-existing account-addressed key.
The replacement test uses a local DB wipe; it is not a real multi-device
browser E2E test.

Validation for this increment: core 105/105 tests, core and PWA typechecks,
and `git diff --check` passed. Full gate, Chromium E2E and real-device
acceptance were not run for this identifier-only increment. Owner review
is pending; publication and verification are not complete.

### Persistence option A — implementation increment

The private store now uses non-destructive store preparation and waits
for storage work before loading identity/pins. A generation check prevents
late initialization from restoring stopped RAM state. `stop()` clears
volatile state and disconnects without deleting device trust; destructive
`teardown()` waits for initialization before deleting the DB. Subsequent
boot waits for cleanup. Blocked DB deletion rejects instead of reporting
success. The legacy destructive preparation helper is no longer used by
private store boot.

PWA pagehide calls `stop()`. An authenticated-to-unauthenticated transition
calls destructive teardown; an initially unauthenticated mount does not
delete persisted trust. No new visibility, screen-lock or resume handlers
are introduced. Core tests cover stop/reboot persistence, logout cleanup,
late-boot invalidation and cleanup overlapping another user's boot; PWA
tests cover pagehide versus logout. These do not establish real-phone
screen-lock correctness.

Increment evidence: core 109/109 and PWA 205/205 tests passed; core/PWA
typechecks, build, MVP bundle guard and diff check passed. The blocked
IndexedDB deletion test first reproduced a false-success result, then
passed after the fix. PWA output included teardown-time AbortError and
mock-network diagnostics despite a successful test exit. Full gate,
Chromium E2E and owner real-device checks remain pending. Owner review is
required before advancing; no push, merge or deploy is included.

### Remaining before F7 acceptance

- V2d.2: publish the identity from private core and add verification
  commands and UI-safe subscriptions to `PrivateRemote`.
- Complete authenticated bootstrap so login/re-login supplies the current
  user ID, and surface/retry storage-cleanup failures without falsely
  claiming that device trust was erased. The shell still initializes
  boot with the user present at module creation.
- Complete device selection, pin/key-change handling and the ritual
  confirmation flow without exposing identity keys to the shell.
- V2e/V3: real Chromium ritual/pin/reload/sign-out coverage, in-chat UI,
  full `pnpm gate`, real-device checks and owner review. None are implied
  by passing directory transport tests.

## Risks
- Largest security change since the private layer shipped: protocol
  change + persistent store; needs Security Agent design sign-off
  *before* implementation.
- Browser storage eviction can silently delete the identity (user must
  re-verify) — UX copy must say so.
- Multi-tab: two tabs share one identity DB; concurrency rules needed
  (single-tab private layer is already the dev-tier rule).
