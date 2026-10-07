# Threat Model

## Core Guarantee — scoped honestly

The guarantee this document describes applies **to the private layer only**,
which is **designed, not shipped**:

> Even in the worst case — a fully compromised relay — the attacker obtains
> **ciphertext + metadata, never plaintext** — *provided the two clients
> verified the SAS fingerprint out-of-band.*

Two honest scoping conditions, no asterisks:

1. **Today, every conversation is public-layer.** Public chats are stored
   and readable by the host. TLS protects transit; the server itself is a
   trusted party by design. Nothing shipped today is end-to-end encrypted.
2. **Even once private ships, the guarantee is conditional on SAS
   verification.** An unverified private session is MITM-able by the relay.
   Without verification there is encryption-against-passive-observers —
   not end-to-end security.

## What the Server Sees

| Layer | Server sees | Server does NOT see |
|-------|-------------|---------------------|
| Public (shipped) | Full content (trusted by design) | — |
| Private (designed, verified pair) | Ciphertext blobs, session existence, timing, sizes | Content, keys |
| Private (designed, **unverified** pair) | Ciphertext blobs **it can re-key itself** — MITM-able | — |

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
| API / auth endpoint flooding | **Rate limiting not wired yet** — OTP attempt limits exist, but no IP-level rate limit | **known gap** |
| Presence leaking non-contact status | Mutual-contact scoping only | implemented |

## Private-Layer Attack Surface (designed)

| Threat | Mitigation |
|--------|------------|
| MITM on key exchange | SAS fingerprint (emoji code) — the *only* defense; see core guarantee |
| Buffer hijack in grace window | Per-session resume token issued at accept |
| Blob flooding / DoS | Per-session quota + rate limiting |
| Key leakage via platform storage | Identity keys in Keychain/Keystore/safeStorage; chat keys RAM-only |
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
> Private chats *(when shipped)* are encrypted on your device, relayed
> blindly, and die with the session — trust no one, **verify the fingerprint,
> or the guarantee does not apply.**
