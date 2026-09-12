# Private Layer — Ephemeral Live Sessions

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
4. On accept: a separate private chat window opens (Telegram secret-chat UX);
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
- **Message encryption**: blobs encrypted client-side before they reach the
  relay; the server sees ciphertext only.
- **No Double Ratchet for v1**: a single ECDH session key is sufficient for
  sessions measured in minutes. Ratcheting is a post-MVP upgrade.

## MITM Protection — Fingerprint Verification

A relay server could theoretically MITM the key exchange. Mitigation shipped
in MVP-private: after accept, both clients display a short **verification
fingerprint** (emoji/numeric code, Signal-style). Users may compare
out-of-band; the UI shows it prominently but does not force it.

## Relay Semantics

- The Go relay routes opaque encrypted envelopes between the two connected
  clients.
- Envelopes are buffered **in-process (RAM only)** during the grace window —
  see `04-backend.md`. No Redis, no disk, no logs of content.
- Session resumption after a network blip requires a **resume token** issued
  at accept time — prevents buffer hijack during the grace window.
- Key/queue names use opaque session UUIDs — no user pairing in identifiers.

## Platform Availability

Private layer is **native-shells only** (iOS first). PWA never loads the
private remote module — see `03-platforms.md`.

## Optional / Post-MVP

- Screenshot notification ("X took a screenshot") — iOS can detect, not
  prevent; deterrent feature, added after core polish.
- Double Ratchet per-message forward secrecy.
- Multi-device private sessions.
