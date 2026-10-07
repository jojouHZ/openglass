# Public Layer

The public layer is the foundation of OpenGlass: a complete messenger with
server-side storage. The private layer builds on top of it (contacts, invite
handshake, identity). Everything on this page is **implemented** unless marked
otherwise.

## Accounts

- **Registration**: email + 6-digit one-time code (OTP) → display name +
  unique tag (`name#NNNN`).
- **Invite-only**: admins generate invite codes; there is no open
  registration. A new email without an invite gets `invite_required`.
- **OTP safety**: codes are Argon2id-hashed at rest, attempt-limited and
  resend-cooldowned server-side.
- **Sessions**: JWT access + opaque refresh pair per device. Refresh
  rotates on use; the server stores only sha256(refresh). Per-device
  session list with revoke and logout — revocation kills REST access
  and the live WebSocket (`session.revoked` event → close 4401).

## Contacts

- Users find each other by **tag or display name** (`GET /users/search`).
- Contact relationship is **mutual** — both parties add each other.
- Mutual contacts gate: direct-chat creation, presence visibility,
  and (designed) private-chat invites.

## Chats

### 1-to-1 chats

Standard direct messaging with full server-side history. A chat with
oneself is **saved messages** (peer = self).

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
- **Edit**, **delete**, **reply**, **pin** supported.
- **Send is idempotent**: every send carries a client `clientNonce`;
  a replayed request returns the original message, never a duplicate.
- History is server-side, cursor-paginated (`before`/`after`/`around`),
  searchable per-chat, with a pinned-messages listing.

### Attachment lifecycle

1. `POST /chats/{id}/attachments` — multipart staged upload
   (≤25 MiB, `photo`/`file` kinds; **MIME is sniffed, never trusted from
   the client**).
2. `POST /chats/{id}/messages` with `attachmentIds` — binds the staged
   upload to the message; a bound attachment cannot be reused, and a
   foreign uploader's attachment is rejected.
3. `GET /attachments/{id}` — authenticated download, **members-only;
   non-members get 404** (existence privacy). Responses carry
   `X-Content-Type-Options: nosniff`; stored under generated IDs, never
   user filenames.

## Realtime (WebSocket)

One authenticated channel per session (`/api/v1/ws`):

- **Contract order**: missed-frame replay → `auth.ok` → `resync.required`
  (if needed) → `presence.snapshot`. Per-session monotonic `seq`.
- **Delivery**: `message.new`, `message.edited`, `message.deleted`,
  `message.pinned/unpinned`, `chat.new`, `chat.updated`, `contact.*`,
  `receipt.read`, `typing`, `presence`, `session.revoked`.
- **Replay**: each session keeps a bounded in-memory ring; reconnect with
  `?last_seq=N` replays what survives. Gap or eviction →
  `resync.required` and the client refetches truth over REST.
- **Client frames**: `auth`, `ping`, `typing.start/stop`, `receipt.read`.
- **Presence is mutual-only**: online/offline is emitted to mutual
  contacts only; a disconnect has a grace window before `offline`
  broadcasts, so flaky reconnects don't flap.
- Full contract: `docs/api/ws-events.md`.

## Notifications

Web Push for the PWA shell is **stubbed (501)** — the S15 settings screen
intentionally hides the notification card until the backend exists.
Native push arrives with the native shells.

## Security Baseline

The public layer is **server-trusted** by design — and honest about it in UI.

| Mechanism | Purpose | Status |
|-----------|---------|--------|
| TLS / WSS everywhere | Transport security | deployed |
| Argon2id OTP hashing + attempt/cooldown limits | Authentication | implemented |
| JWT + rotating refresh, per-device sessions, WS revoke | Session management | implemented |
| Member-gated attachment access, existence-private 404s | Content privacy | implemented |
| IP/user rate limiting | Abuse prevention | **not wired yet** — Redis provisioned |
| At-rest DB encryption | Raw-dump protection | deployment responsibility |

**No E2EE in the public layer** — a deliberate product decision: it preserves
history search and multi-device sync, keeps the codebase simpler, and keeps the
private layer meaningfully differentiated.
