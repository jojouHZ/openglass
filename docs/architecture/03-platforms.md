# Platforms — MFE Shells

OpenGlass uses a **micro-frontend (MFE)** architecture: one shared frontend
core plus thin per-platform shells. Remote modules are loaded dynamically —
which modules a shell loads defines what the platform can do.

## Shell Matrix

| Shell | Tech | Public layer | Private layer | Key storage |
|-------|------|:---:|:---:|-------------|
| PWA | Vue 3 + Vite | ✅ | ❌ never loads private module | — (server-trusted) |
| iOS | Capacitor | ✅ | ✅ first private platform | Keychain / Secure Enclave |
| Android | Capacitor | ✅ | ✅ | Keystore |
| Desktop | Electron | ✅ | ✅ | `safeStorage` (weaker) |

Each shell lives in its **own repository** — including the private-hosting
deployment host.

## Remote Modules

- **Public module** — loaded by every shell. Contacts, chats, messaging.
- **Private module** — loaded only by native shells. Contains:
  - `Privacy Engine` — E2EE via Web Crypto API / native crypto
  - `Volatile State Manager` — RAM-only state, zero persistence
  - `Relay Client (TS)` — WebSocket client for the Go relay

**The PWA exclusion is architectural**: the private module simply is not served
to it. This is the security boundary, not a config flag.

## Security Tier Indicator

Every platform displays its protection level in the UI — honest transparency
as a product feature:

- 🛡️ **Hardware-backed** — iOS/macOS/Android (key material in Keychain/Keystore)
- 🛡 **RAM-only** — Desktop (ephemeral keys fine; identity keys use OS storage,
  weaker isolation)
- ⚪ **Server-trusted** — PWA (public layer only)

Users always know how protected they are on a given platform.

## Platform Notes

- **iOS**: strongest key storage; background execution limited — app suspension
  kills the socket → grace window → session death. Capacitor plugins provide
  Keychain access for identity keys; ephemeral chat keys stay in RAM anyway.
- **Android**: Keystore equivalent; background rules similar to iOS.
- **Desktop (Electron)**: no hardware enclave; `safeStorage` encrypts at rest.
  Private chats still RAM-only — acceptable tier, marked accordingly.
- **PWA**: no secure storage, no background guarantees — excluded from private
  layer by design.
