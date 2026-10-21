# Slice F8 — Device Vault & Lock

Owner decisions: the lock is **optional** (prompted at first login, never
forced); it applies to the **release PWA as well**, not just the dev
PWA; first sign-in on any device is always email + OTP; the most
convenient factor is asked on every launch.

## Three layers (do not conflate)
| Layer | Lives | Protects | Factors |
|---|---|---|---|
| A. Account auth | server | who you are to the server | email+OTP on a new device; passkey / email code for step-up (F9) |
| B. App lock | device | what a person holding the device can see | biometrics (= passkey with user verification in a browser), PIN / passcode, auto-lock |
| C. Vault | device | secrets at rest | key derived from the layer-B factor |

A lock screen without a vault is theatre: today the session tokens sit
in `localStorage` in plaintext, so hiding the UI protects nothing.

## Vault
- One encrypted store holds: refresh/session secret, the device identity
  key and the pinned peer keys (F7). Scoped per user id.
- Key sources: PIN/passcode → PBKDF2 (high iteration count) ; passkey →
  WebAuthn PRF output where the browser supports it ; native shells →
  Keychain / Keystore / safeStorage.
- Identity key is extractable only inside its creation call; at rest it
  is AES-GCM wrapped; at unlock it is imported as a **non-extractable**
  runtime key.
- A `KeyVault` port in core with pluggable backends (WebCrypto+IndexedDB
  for the PWA now; Keychain/Keystore/safeStorage later) so the desktop,
  Android and iOS work replaces the backend, not the lock logic.

## Lock behaviour
- First login: soft prompt "Protect this device" (passkey if available,
  else PIN); skipping is allowed.
- Every launch / after auto-lock (immediately · 1 · 5 min · 1 h):
  biometrics (passkey UV) → PIN fallback. Gates the whole app when
  enabled.
- Wrong-PIN policy: exponential delay after 3 failures. **Wipe after N
  failures** (default 10) is built in the dev PWA to learn from, but is
  **post-MVP for the release PWA / first shipped on desktop** where
  hardware limits exist.
- Wipe = destroy the vault (tokens + identity + pins) on this device only.
  Recovery = sign in again with email OTP → account and public chats
  return, a **new device identity** is created, contacts see an unknown
  device and re-verify. No key backup, by design.
- Sign-out **locks** the vault and keeps it (replaces F7's wipe-on-sign-out);
  vaults of other users on the same browser are separate and unreadable.
  Vault destroyed on: "forget this device", revoke from Security &
  sessions (on next contact), wipe-after-failures.

## Honest limits (written into the threat model)
- The attempt counter runs in JavaScript: it stops casual physical access,
  **not** an offline attacker who copies the profile and brute-forces the
  wrapper — PBKDF2 cost and passkey PRF raise the bar; hardware-enforced
  attempt limits exist only in native shells.
- An attacker can trigger the wipe on purpose (self-DoS); impact is
  bounded: public chats are server-side and untouched.
- UI copy must not claim "bank-grade" for the PWA.

## MVP scope vs later
| In release MVP | After MVP (desktop first) |
|---|---|
| optional lock: PIN + passkey (where supported), auto-lock, vault for tokens, exponential delay | wipe-after-failures in release builds, hardware-backed unlock, instance-enforced lock policy |

## Tests
- Vault: wrap/unwrap, wrong PIN, delay schedule, wipe, per-user isolation,
  sign-out keeps vault, forget-device wipes.
- E2E: lock → reload → unlock; two users on one browser see nothing of
  each other; tokens are not readable from `localStorage` when locked.
- Contrast/visual: unlock screens in light and dark (concept 06).

## Risks
- WebAuthn PRF support differs by browser → PIN must always work.
- Browser storage eviction can delete the vault → treat as a wipe; UI says
  so.
- Needs Security Agent design sign-off before implementation.
