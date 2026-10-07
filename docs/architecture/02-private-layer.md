# Private Layer — Ephemeral Live Sessions

> **Status: DESIGN — not implemented.** No relay endpoint, no key exchange,
> no private messaging ships today. The screens exist only inside the
> internal `pwa-dev` demo build (`VITE_PRIVATE_MODULE=1`), gated out of the
> production bundle. Everything below is the intended contract, not a
> guarantee — treat it as a spec under review, not shipped behavior.

The private layer provides **burnable end-to-end encrypted chats**: live
sessions that exist only while both parties are present, where the server acts
as a blind relay and stores nothing.

Primary use case: passing confidential data (credentials, tokens, secrets)
inside an otherwise normal conversation — agree in public, transmit in private.

## Core Properties

- **1-to-1 only.** Group private chats are out of scope.
- **Zero persistence.** The server relays encrypted blobs and keeps nothing.
- **Live sessions.** A session exists while both participants are connected.
- **Cheap cryptography + local-first** — per-chat session keys, RAM-only state,
  keys die with the chat.

## Session Lifecycle

### Invite flow (via the public layer)

1. Both users are mutual contacts.
2. User A taps **[Invite to private chat]** inside their public chat.
3. User B sees an invite message → **accept** or **decline**.
4. On accept: a separate private chat window opens;
   ECDH key exchange happens over the relay channel.
5. On decline: nothing is created.

The public chat is the **control channel**; content never flows through it.

### Lifetime configuration (set at creation)

- Range: **1 minute – 24 hours**, default **10 minutes**.
- Free-form custom duration input (no fixed preset list).
- The last chosen value is remembered for next time.

### Per-message burn (optional, set at creation)

Each message can additionally burn after being read — independent of the
session lifetime.

### Death triggers

| Trigger | Behaviour |
|---------|-----------|
| Timer expires | Session ends, keys destroyed, window closes |
| Either party disconnects | Grace window ~60 s (reconnect resumes the session; keys held in RAM). Strict mode at creation: die instantly. |
| Manual burn | Either participant can kill the session |
| App suspended (iOS) | OS kills the socket → grace window counts down → death if not resumed |

## Cryptography

- **Session keys**: generated client-side **per chat**, ECDH exchange over the
  relay; live in RAM only; destroyed with the chat.
- **Identity keys**: long-term, stored in platform secure storage —
  iOS/macOS Keychain (Secure Enclave), Android Keystore, Electron `safeStorage`.
- **Dev-tier exception (pwa-dev only)**: the internal demo host has no
  keystore, so identity keys are **non-extractable `CryptoKey` objects in a
  dedicated IndexedDB** (`openglass-private`). Weakest tier of all shells —
  no enclave, XSS-compromisable — and it exists **only** in the `pwa-dev`
  build; `pwa-mvp` ships no private code at all. Full teardown deletes the
  database itself (see zero-trace discipline in `docs/api/relay-events.md`).
- **Message encryption**: blobs encrypted client-side before they reach the
  relay; the server sees ciphertext only.
- **No Double Ratchet for v1**: a single ECDH session key is sufficient for
  sessions measured in minutes. Ratcheting is a post-MVP upgrade.

## MITM Protection — Fingerprint Verification

**This is the load-bearing piece, and it deserves bluntness.** A relay —
malicious or compromised — can MITM the ECDH exchange: it substitutes both
public keys, terminates the encryption on itself, and re-encrypts onward.
The "blind relay" guarantee does not exist unless the clients authenticate
the key exchange.

Mitigation designed for MVP-private: after accept, both clients display a
short **verification fingerprint** (emoji/numeric code, derived from both
parties' session public keys — S11b). Users compare it out-of-band; the UI
shows it prominently but does not force it.

Consequences, honestly:

- **Verified pair** → relay is blind. Ciphertext and metadata only.
- **Unverified pair** → the session is encrypted against passive sniffing
  but remains MITM-able by the relay. The guarantee is not "partial" — it
  simply does not apply. The UI must never imply otherwise: an unverified
  session is labeled unverified, not "encrypted".

## Relay Semantics

- The Go relay routes opaque encrypted envelopes between the two connected
  clients.
- Envelopes are buffered **in-process (RAM only)** during the grace window —
  see `04-backend.md`. No Redis, no disk, no logs of content.
- Session resumption after a network blip requires a **resume token** issued
  at accept time — prevents buffer hijack during the grace window.
- Key/queue names use opaque session UUIDs — no user pairing in identifiers.

## Platform Availability & Implementation Plan

Private layer is **native-shells only** in production — the internal
`pwa-dev` demo host is the sole exception (dev-tier, IndexedDB keys).

Implementation order — the path to the post-MVP goal *"a running server
serves private-layer clients on any device"* (milestone **v0.9.0**,
pre-1.0 GA):

| Order | Shell | Identity key storage | Why this order |
|-------|-------|----------------------|----------------|
| 1 | **pwa-dev** (internal) | IndexedDB, non-extractable | testable today, unblocks the whole stack's E2E before any shell exists |
| 2 | **Desktop (Electron)** | `safeStorage` | first *real* client — buildable and testable immediately, no store/signing pipeline needed |
| 3 | **Android (Capacitor)** | Keystore | second-largest target, mature keystore API |
| 4 | **iOS (Capacitor)** | Keychain / Secure Enclave | strongest storage, most pipeline overhead (signing, entitlements, App Store) — last |
| — | **macOS** | Keychain (via Electron `safeStorage` or native) | covered by the desktop shell unless a native client appears |

Same rule everywhere: private code is a remote module loaded only by
shells entitled to it; a shell that shouldn't have private simply never
receives the module (build exclusion on pwa, platform entitlement on
native).

## Optional / Post-MVP

## Optional / Post-MVP

- Screenshot notification ("X took a screenshot") — iOS can detect, not
  prevent; deterrent feature, added after core polish.
- Double Ratchet per-message forward secrecy.
- Multi-device private sessions.
