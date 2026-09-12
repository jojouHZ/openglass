# Threat Model

## Core Guarantee

Even in the worst case — a fully compromised relay — the attacker obtains
**ciphertext + metadata, never plaintext**. The primary guarantee is
client-side cryptography; server-side hygiene is defense-in-depth.

## What the Server Sees

| Layer | Server sees | Server does NOT see |
|-------|-------------|---------------------|
| Public | Full content (trusted by design) | — |
| Private | Ciphertext blobs, session existence, timing, sizes | Content, keys |

## Residual Risks (documented, not hidden)

1. **Metadata**: who talks to whom, when, how much. Traffic analysis is out
   of scope at this level — and users can add VPN/Tor on top for free.
2. **Transit RAM**: a message lives microseconds in relay memory. That is
   relaying, not storage — but formally the server "touches" ciphertext.
3. **Host-level trust**: as the managed hoster we could patch the server.
   Paranoid clients get the self-host option — that is the honest answer.

## Private-Layer Attack Surface

| Threat | Mitigation |
|--------|------------|
| MITM on key exchange | Fingerprint verification (emoji code) in MVP-private |
| Buffer hijack in grace window | Per-session resume token issued at accept |
| Blob flooding / DoS | Per-session quota + rate limiting |
| Key leakage via platform storage | Identity keys in Keychain/Keystore/safeStorage; chat keys RAM-only |
| Screenshots | Detect + notify (optional, post-core) — never presented as prevention |

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
> the session — trust no one, verify the fingerprint.
