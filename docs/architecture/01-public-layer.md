# Public Layer

The public layer is the foundation of OpenGlass: a complete messenger with
server-side storage. The private layer builds on top of it (contacts, invite
handshake, identity). Everything on this page is **implemented** unless marked
otherwise.

## Accounts

- **Registration**: email + 6-digit one-time code (OTP) → display name +
  unique tag (`name#NNNN`).
- **Invite-only**: the operator generates invite codes with `ogadmin
  invites create` (see Operator surface); there is no open
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

## Operator surface

`ogadmin` (built into the server image next to `server`) is the
instance owner's tool. It talks to the database directly with the same
`OPENGLASS_PG_DSN` as the server, so it needs credentials and adds **no
network surface** — there are no admin HTTP routes.

```
docker compose exec server ogadmin reports list [--status open|resolved|all]
docker compose exec server ogadmin reports resolve <id> [--note "..."]
docker compose exec server ogadmin invites create [--count N] [--uses N] [--days 1..30]   # default 30, always expires
docker compose exec server ogadmin invites list
```

- **Reports** (`POST /reports`): a user reports another user; the owner
  sees who reported (stated in the dialog). A report has *no automatic
  effect* — the reported user is never told and nothing changes; the
  reporter learns "received", not an outcome. Reports outlive accounts
  (tags are snapshotted, references become NULL). User-supplied text is
  printed quoted, so control characters never reach the terminal raw.
- **Open-report cap**: a user can have at most 50 unresolved reports
  (409 `open_reports_limit`); the per-minute rate limit stops bursts, the cap
  stops a slow flood of the operator's queue. Resolving frees a slot.
- **Invites**: codes `GLS-XXXXXXXX` from an unambiguous alphabet, with an
  optional use count. An invite is the only way to register, so it **always
  expires**: default 30 days, ceiling 30 days. (Letting selected users invite
  new people is post-MVP.)
- **Hostile text**: report text reaches the database only as a bind
  parameter (the store never splices it into SQL — also enforced by the
  `gosec` SQL-concatenation rules in lint), is never echoed in any response,
  is printed quoted by `ogadmin`, and the PWA never renders anyone else's
  report. The PWA bans markup-producing sinks (`v-html`, `innerHTML`, …) with
  a test; every API response carries `nosniff` and a `default-src 'none'`
  CSP.

## Notifications

Web Push is **not part of the MVP contract** (no routes) — the S15 settings screen
intentionally hides the notification card until the backend exists.
Native push arrives with the native shells.

## Security Baseline

The public layer is **server-trusted** by design — and honest about it in UI.

| Mechanism | Purpose | Status |
|-----------|---------|--------|
| TLS / WSS everywhere | Transport security | deployed |
| Argon2id OTP hashing + attempt/cooldown limits | Authentication | implemented |
| JWT + rotating refresh, per-device sessions, WS revoke | Session management | implemented |
| `nosniff` + `default-src 'none'` CSP on every API response | A direct visit to an uploaded file or JSON can never run as a page | implemented |
| 1 MiB cap on every JSON request body (uploads have their own limit) | Memory-exhaustion DoS, incl. unauthenticated endpoints | implemented |
| Member-gated attachment access, existence-private 404s | Content privacy | implemented |
| IP/user rate limiting | Abuse prevention | **not wired yet** — Redis provisioned |
| At-rest DB encryption | Raw-dump protection | deployment responsibility |

**No E2EE in the public layer** — a deliberate product decision: it preserves
history search and multi-device sync, keeps the codebase simpler, and keeps the
private layer meaningfully differentiated.
