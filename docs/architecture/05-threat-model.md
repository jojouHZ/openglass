# Threat Model

## Core Guarantee — scoped honestly

The guarantee this document describes applies **to the private layer only**,
which today ships as a **dev-tier build in the dev host** (gated out of the
production PWA bundle):

> Even in the worst case — a fully compromised relay — the attacker obtains
> **ciphertext + metadata, never plaintext** — *provided the two devices
> verified each other's identity out-of-band (device-pair pinning).*

> **Implementation status:** the pinning model is the owner-approved
> target (slice F7). Until F7 ships, the dev tier uses the interim
> per-session SAS comparison and the guarantee is conditional on that
> comparison; this document is updated again when F7 lands.

Two honest scoping conditions, no asterisks:

1. **Every production-deployed conversation is public-layer.** Public chats
   are stored and readable by the host. TLS protects transit; the server
   itself is a trusted party by design. The private layer exists only in
   the dev host (`VITE_PRIVATE_MODULE=1` + live API) as a dev-tier build —
   ephemeral in-memory session keys, no hardware keystore yet.
2. **The guarantee is conditional on verification.** An unverified pair
   is MITM-able by the relay. In the target model an unverified pair
   cannot open a private session at all (the UI shows a lock); in the
   interim dev tier an unverified session is labelled unverified, never
   "encrypted" — encryption-against-passive-observers is not end-to-end
   security.

## What the Server Sees

| Layer | Server sees | Server does NOT see |
|-------|-------------|---------------------|
| Public (shipped) | Full content (trusted by design) | — |
| Private (dev tier, verified pair) | Ciphertext blobs, session existence, timing, sizes | Content, keys |
| Private (dev tier, **unverified** pair) | Ciphertext blobs **it can re-key itself** — MITM-able | — |

## Public-Layer Attack Surface (shipped today)

| Threat | Mitigation | Status |
|--------|------------|--------|
| Attachment access by non-members | Member-gated download; **404 not 403** — existence privacy | implemented |
| Client-forged MIME/extension | Server-side sniffing; `X-Content-Type-Options: nosniff`; stored under generated IDs | implemented |
| Replay / duplicate sends | `clientNonce` idempotent send | implemented |
| OTP brute force | Argon2id hash at rest, attempt limit, resend cooldown | implemented |
| Stolen refresh token | Refresh rotation; server stores sha256(refresh) only | implemented |
| Revoked session still using a live JWT | `SessionActive` re-check on WS attach + `session.revoked` → close 4401 | implemented |
| Expired JWT keeping a live WS | `afterExpiry` drops the conn at token death | implemented |
| API / auth endpoint flooding | IP token-buckets on `otp/request`, `otp/verify`, `auth/refresh` + a per-email OTP bucket; `429 rate_limited` + `Retry-After` | implemented |
| Presence leaking non-contact status | Mutual-contact scoping only | implemented |

## Private-Layer Attack Surface (dev tier)

| Threat | Mitigation |
|--------|------------|
| MITM on key exchange | Device identity keys + out-of-band verification ritual (5 emoji / QR) pin each peer device once; every handshake is signed by the pinned key — a relay cannot substitute ephemeral keys. Unpinned pairs cannot open a private session at all |
| Public-key directory lies | The directory is untrusted storage; substitution is caught by the ritual |
| Stolen/lost device with an unlocked browser profile | Device vault + lock (F8): secrets wrapped at rest with a PIN/passkey-derived key, exponential delay, wipe on repeated failures (dev tier first), remote revoke wipes on next contact. Deters casual physical access; **does not** stop an offline attacker who copies the profile and brute-forces the wrapper (hardware-backed unlock only in native shells) |
| Mode confusion (sending a secret publicly / mistaking the layer) | Private palette differs by hue in both app themes, mask glyph on every private bubble, ringed composer, private-only composer while a session is live |
| Buffer hijack in grace window | Per-session resume token issued at accept |
| Blob flooding / DoS | Per-session quota + rate limiting |
| Key leakage via platform storage | Native: identity keys in Keychain/Keystore/safeStorage. Dev PWA: non-extractable IndexedDB key (XSS can use it, not export it) — documented weakest tier. Chat/session keys RAM-only everywhere |
| Screenshots | Detect + notify (optional, post-core) — never presented as prevention |

## Residual Risks (documented, not hidden)

1. **Metadata**: who talks to whom, when, how much — visible to the host on
   *both* layers. Traffic analysis is out of scope at this level; users can
   add VPN/Tor on top.
2. **Transit RAM**: a private-layer message lives microseconds in relay
   memory. That is relaying, not storage — but formally the server "touches"
   ciphertext.
3. **Host-level trust**: as the managed hoster we could patch the server.
   Paranoid clients get the self-host option — that is the honest answer.

## Deployment Hardening Notes

Applies to any future component holding ciphertext in RAM:

- Swap disabled or `vm.swappiness=0` — no RAM pages on disk.
- Core dumps off (`ulimit -c 0` / `LimitCORE=0`).
- Opaque identifiers — no user pairing in keys, logs, or metrics.
- Minimal logging of private-layer events; never log payload sizes per user.

## Rejected Decisions (and why)

### Relay server rotation — rejected for v1
Rotation only resists traffic analysis if hops are run by **independent
operators in different jurisdictions**. All our relays are ours — rotation
hides nothing from ourselves, adds session-migration complexity, and breaks
the in-process buffer model. Revisit only if metadata-hiding becomes a
promise.

### Redis for private blobs — rejected
Redis persists by default (RDB/AOF), slowlog records command args, MONITOR
streams everything. Hardening checklist exists, but in-process buffering gives
the same semantics with zero configuration risk.

### E2EE in the public layer — rejected
Blurs the private layer's differentiation, breaks history search and
multi-device sync, adds weeks. Public layer is honestly server-trusted;
UI labels it.

### Double Ratchet for private sessions — deferred
Session lifetime is minutes; a single ECDH session key suffices. Ratchet is
a post-MVP upgrade path.

## Trust Statement (user-facing)

> Public chats are stored on the server of your community — trust your host.
> Private chats are encrypted on your device, relayed blindly, and die with
> the session — trust no one, **verify the fingerprint, or the guarantee
> does not apply.**
