# Public Layer

The public layer is the foundation of OpenGlass: a complete messenger with
server-side storage. The private layer builds on top of it (contacts, invite
handshake, identity).

## Accounts

- **Registration**: email + one-time code (OTP) → unique ID + nickname.
- **Invite-only**: admins generate invites; there is no open registration.
  For a managed closed-circle service this is a feature, not a limitation.
- **Sessions**: JWT access + refresh tokens, per-device session list.

## Contacts

- Users find each other by **nickname or unique ID**.
- Contact relationship is **mutual** — both parties add each other.
- Private-chat invites are only possible between mutual contacts.

## Chats

### 1-to-1 chats
Standard direct messaging with full server-side history.

### Group chats — party/raid model

Deliberately simple membership, learned from the legacy projects where
membership was over-engineered:

- **Owner** (creator): full rights, can transfer ownership.
- **Members**: default no elevated rights.
- **Delegatable rights** (raid-style): owner can grant specific rights to
  specific members — invite/remove members, edit group info, pin messages,
  delete others' messages.

No complex role hierarchy: one owner + members + per-member grants.

## Messages

- Text + **attachments** (photos, files).
- **Edit** and **delete** supported.
- History stored server-side; searchable.

## Realtime

WebSocket channel delivers: new messages, **read receipts**, **typing
indicators**, presence (online/offline).

## Notifications

Web Push for the PWA shell (service worker). Native push arrives with the
native shells in later stages.

## Security Baseline

The public layer is **server-trusted** by design — and honest about it in UI.

| Mechanism | Purpose |
|-----------|---------|
| TLS / WSS everywhere | Transport security |
| Argon2 password hashing, OTP | Authentication |
| JWT + refresh, device sessions | Session management |
| At-rest DB encryption | Protection against raw DB dumps |
| Rate limiting (Redis) | Abuse prevention |

**No E2EE in the public layer** — a deliberate product decision: it preserves
history search and multi-device sync, keeps the codebase simpler, and keeps the
private layer meaningfully differentiated.
