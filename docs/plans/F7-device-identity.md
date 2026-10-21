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
persistent store (see `docs/api/relay-events.md`). The old assertion
"no `openglass-private` IndexedDB after teardown" is replaced by "the
database contains only identity + pins, no message or session material".
The dirty-boot sweep wipes session material but keeps identity.

### Sign-out / switch user
Identity and pins are scoped per user and destroyed on sign-out and on
"revoke this device" (otherwise a second person signing in on the same
browser would see the first user's verified-contact graph).

## F7b — device lock (PM + Security proposal, awaiting owner confirmation)

Owner idea: unlock factor on entry (passkey / 2FA / Face ID); repeated
wrong entries wipe the identity; recovery via email OTP.

Recommended shape:
- **Scope of the lock:** gates *private features only* (layer switch,
  verification, sessions) — not the whole app; public chat is already
  protected by the server session. Re-lock after N minutes in background.
- **Factor:** local PIN/passphrase by default (login stays email OTP — no
  new account password); **passkey with WebAuthn PRF** as the unlock
  factor where the browser supports it; native shells use biometrics via
  platform keystores later.
- **At-rest protection:** identity private key is wrapped (AES-GCM) with a
  key from the PIN (PBKDF2, high iteration count) or the passkey PRF
  output; unwrapped at unlock into a non-extractable runtime key. The key
  exists as extractable material only inside the creation call.
- **Attempts:** delay after 3 failures (exponential), **wipe identity +
  pins after 10**; counter and wrapper metadata in the private DB.
- **Recovery:** email OTP restores the **account session** and creates a
  **new device identity**; peers see an unknown device and must re-verify.
  Old keys/pins are never recoverable (consistent with "no key backup").
- **Remote revoke** (S14) wipes the identity on the device's next contact
  with the server (best-effort; an offline device is not reached).
- **Honest limits (documented in the threat model):** the attempt counter
  is enforced in JavaScript — it deters casual physical access (unlocked
  laptop, borrowed phone), **not** an offline attacker who copies the
  profile and brute-forces the wrapper; PBKDF2 cost and PRF raise that
  bar, hardware-backed attempt limits arrive with native shells. An
  attacker can also *trigger* the wipe on purpose (self-DoS) — bounded:
  public chats are unaffected, only local private identity is lost.

## Tests
- Core unit: identity create/load, fingerprint symmetry, pin store, key
  change, handshake accept/reject.
- **Adversarial relay test:** a relay that substitutes ephemeral keys must
  fail the handshake for a pinned pair.
- Real-browser E2E: ritual → pin → reload → session starts without a
  ritual; DB scan (no messages/session keys); sign-out wipes the DB;
  second user on the same browser sees no pins.
- Backend contract tests for the directory (mutual-only read, revoke).
- F7b: wrong-PIN delay/wipe, OTP re-enrol creates a new identity.

## Risks
- Largest security change since the private layer shipped: protocol
  change + persistent store; needs Security Agent design sign-off
  *before* implementation.
- Browser storage eviction can silently delete the identity (user must
  re-verify) — UX copy must say so.
- Multi-tab: two tabs share one identity DB; concurrency rules needed
  (single-tab private layer is already the dev-tier rule).
