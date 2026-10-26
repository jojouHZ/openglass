# UX Flows

User stories and screen-transition map for OpenGlass MVP. This document
defines **behavior and navigation only** — no visual design. It is the
contract between product intent and implementation: every arrow is a
navigation event, every screen lists the data it needs.

> **Route truth**: the live routing table is `apps/pwa/src/router.ts` —
> this file documents intent. Statuses below: **shipped** = live in the
> production PWA, **pwa-dev** = built but gated behind
> `VITE_PRIVATE_MODULE` (internal demo host only), **design** = spec only,
> **merged** = realized inside another screen.

## Screen Inventory

| ID | Screen | Layer | Status |
|----|--------|-------|--------|
| S1 | Invite / email entry | Public | shipped |
| S2 | OTP verification | Public | shipped |
| S3 | Profile setup (nickname, ID) | Public | shipped |
| S4 | Chat list (empty / populated) | Public | shipped |
| S5 | Chat view (1-1) | Public | shipped |
| S6 | Contact search & add | Public | shipped |
| S7 | Contact profile / chat actions | Public | shipped |
| S8 | Group creation | Public | shipped |
| S9 | Group view | Public | **merged into S5** — group chats render in the chat view; no standalone route |
| S9a | Group management (owner panel) | Public | shipped |
| S10 | Private session invite (in-chat card) | Private | pwa-dev only |
| S11 | Private session setup + mutual verify | Private | pwa-dev only |
| S11b | Device-pair verification ritual (emoji grid / QR) | Private | pwa-dev only |
| S12 | Chat view in PRIVATE MODE (same window — a pane of S5, not a route; private palette, mask glyph on every private bubble, header chips: Verified · countdown · strict, BURN) | Private | pwa-dev only |
| S13 | Profile & settings | Public | shipped |
| S14 | Security & sessions | Public | shipped |
| S15 | PWA install / push / offline | Public | shipped — install prompt + offline banner live; push card hidden (backend is `501`) |
| S16 | UI state catalog | — | dev-only route `/states` (`import.meta.env.DEV`); a component checklist, not a user flow |

## Flow Map

```mermaid
flowchart TD
    A[Open app] --> B{Authenticated?}
    B -->|No| S1[S1 Invite/Email]
    S1 -->|invite code + email| S2[S2 OTP]
    S2 -->|valid code| S3[S3 Profile Setup]
    S2 -->|invalid/expired| S2
    S3 -->|nickname + unique ID| S4
    B -->|Yes| S4[S4 Chat List]

    S4 -->|tap chat| S5[S5 Chat 1-1]
    S4 -->|tap group| S9[S9 Group View]
    S4 -->|search/add| S6[S6 Contact Search]
    S4 -->|avatar/menu| S13[S13 Profile & Settings]

    S6 -->|found user| S7[S7 Contact Profile]
    S7 -->|add contact| S7
    S7 -->|start chat| S5

    S5 -->|attachments/edit/delete/read/typing| S5
    S5 -->|header tap| S7
    S5 -->|invite to private| S10

    S4 -->|new group| S8[S8 Group Creation]
    S8 -->|members picked| S9
    S9 -->|owner: manage entry| S9a[S9a Group Management]
    S9a -->|save rights/members| S9
    S9 -->|member: read/post per rights| S9

    S5 -->|privacy toggle ON| S11[S11 Setup + Verify]
    S11 -->|invite sent| S10[S10 Invite Card in-chat]
    S10 -->|B accepts → verify| S12[S12 Private Mode in S5]
    S10 -->|B declines/timeout| S5
    S12 -->|burn/expiry/disconnect| S5
    S5 <-->|toggle ON/OFF, session alive| S12

    S13 --> S14[S14 Security & Sessions]
    S14 --> S13
    S4 -.->|install prompt| S15[S15 PWA Install]
    S5 -.->|push permission| S15
    S15 --> S4
```

## Flow 1 — Onboarding

**US-1.1** As an invited user, I want to enter my invite code and email, so
that I can request access to the closed instance.

**US-1.2** As a user, I want to verify a one-time code sent to my email, so
that the server confirms I own the address.

**US-1.3** As a new user, I want to pick a nickname and receive a unique
tag number (`nickname#NNNN`), so that others can find me.

**Identity scheme**: two separate identifiers.

- **Display name** — free-form, changeable anytime, NOT unique (two
  users named "jojou" is fine). Purely cosmetic.
- **Tag `name#NNNN`** — unique handle bound at registration, immutable.
  Its prefix is taken from the display name chosen at registration but
  lives independently afterward. Tag uniqueness enforced: if `jojou` is
  taken, registration suggests a free variant (`Jojou13245`). `#1` is
  reserved for the instance owner (the hoster) and can never be
  reissued — admin impersonation impossible.

**Transitions**
- `S1 → S2`: submit invite + email → server sends OTP
- `S2 → S3`: valid OTP
- `S2 → S2`: invalid/expired code → error state, resend with cooldown
- `S3 → S4`: profile saved → land on empty chat list

**Edge cases**
- Invite code invalid → inline error on S1, no OTP sent
- OTP expired → resend button (cooldown 60s)
- Nickname taken → suggest alternatives, keep ID immutable

## Flow 2 — Contacts

**US-2.1** As a user, I want to search people by nickname or ID, so that I
can find contacts without sharing phone numbers.

**US-2.2** As a user, I want to send a contact **request** to a found user;
the person appears in my contacts only after they accept (consent model —
no one can add you to their list, or into a group, without your answer).
A request I send stays "pending" for me until accepted; if the other
person declines, I am **not told** (silent decline) and I can only send
it again. I can cancel a request I sent.

**US-2.2a** As a user, I want incoming requests and group invitations in
one obvious place (a badge on the contacts entry and an invitation strip
on the chat list), so that I can accept or decline them without
searching.

**US-2.3** As a user, I want to open a chat directly from a contact profile.

**US-2.4** As a user, I want to report a user from their profile, so that
abuse can be flagged to the instance owner.

**US-2.5** As a user, I want to verify a contact's identity (emoji grid /
QR) right from their profile — without starting a private session — so
that the private toggle is unlocked in advance. Verified contacts show
a "verified" mark on profile and in chat.

**US-2.6** As a user, I want an optional verification freshness reminder:
if a contact was last verified more than N days ago (default 90,
configurable/off in settings), show a soft banner suggesting to
re-verify at the next opportunity. Non-blocking.

**Transitions**
- `S4 → S6`: search field / "add contact" action
- `S6 → S7`: select a result → contact profile card
- `S7 → S5`: "message" → creates/opens 1-1 chat

**Edge cases**
- User not found → empty result state with "check the ID" hint
- Already in contacts → profile shows "in contacts" state
- Blocked user → no profile actions (post-MVP block feature)

## Flow 2.5 — Chat List Features (S4)

**US-2.5.1** As a user, I want to pin important chats to the top of the
list, so that key conversations are always reachable.

**US-2.5.2** As a user, I want to mute a chat and see a mute icon on its
list item, so that I control noise per conversation.

**US-2.5.3** As a user, I want a "Saved Messages" self-chat pinned at the
top, so that I have a private scratch space for notes and drafts.

**US-2.5.4** As a user, I want folder tabs (All / custom folders) above
the chat list, so that I can group conversations.

**US-2.5.5** As a user, I want folder/group tags shown as chips under a
contact's name (in list and profile), so that I can see which folders or
groups a contact belongs to.

**Data**: `chat.pinned`, `chat.muted`, `chat.folder_ids[]`,
`contact.folder_tags[]`, `saved_messages` (self-chat type)

## Flow 3 — Public 1-1 Chat

**US-3.1** As a user, I want to send text and attachments, so that I can
communicate normally.

**US-3.2** As a user, I want to edit and delete my messages, so that I can
fix mistakes.

**US-3.3** As a user, I want to see read receipts and typing indicators, so
that I know the conversation state.

**US-3.4** As a user, I want to see the contact's presence (online/last
seen) in the chat header.

**US-3.5** As a user, I want to pin a message inside a chat and see a
pinned bar at the top, so that key info stays visible.

**US-3.6** As a user, I want to search within a chat's history, so that
I can find an old message without scrolling.

**US-3.7** As a user, I want a context menu on long-press on a message
(reply / copy / edit / pin / delete; 🔥 burn in private mode), so that
message actions are one gesture away.

**Message anatomy**: read receipt `✓✓` bottom-right inside own bubble;
timestamp beside it; date separators ("September 14") between groups;
burn `🔥` top-left on private bubbles — a single tap only shows the
"hold to burn" hint; the burn itself requires a long-press of 1–2 s
with a progress ring.

**Data needed per message**: `id, sender_id, text, attachments[],
created_at, edited_at, read_at, pinned`

**Edge cases**
- Send while offline → queue locally, send on reconnect, "sending" state
- Attachment too large → inline error with limit
- Peer typing → indicator in header, clears after timeout

## Flow 4 — Groups (party/raid model)

**US-4.1** As a user, I want to create a group and become its owner, so
that I can host a closed discussion.

**US-4.2** As an owner, I want to add/remove members and delegate specific
rights (invite, pin, manage messages), so that I control the group without
micromanaging.

**US-4.3** As a member, I want the UI to reflect my rights — disabled
actions are hidden or explained, not silently failing.

**Transitions**
- `S4 → S8 → S9`: create → pick members → group view
- `S9` owner panel: member list, per-member rights toggles

**Edge cases**
- Owner leaves → ownership transfer prompt or group dissolution (decide:
  transfer to oldest member — simpler, matches party model)
- Member without post rights → read-only view with explanation

## Flow 5 — Private Session (mode-toggle model)

**Core concept**: a private session is NOT a separate chat window — it is
a **mode of the existing 1-1 conversation**. A privacy toggle in the chat
header switches the conversation between public and private mode. Private
messages render inline in the same timeline, visually distinct (private
palette, mask glyph on every private bubble), and burn without leaving
the window. The conversation never changes screen.

**US-5.1** As a user in a 1-1 chat, I want to flip a privacy toggle, so
that I can start exchanging sensitive data without leaving the
conversation.

**US-5.2** As the invited user, I want to accept or decline the invite
inside the same chat, so that I control when the mode activates.

**US-5.3** As the inviter, I want to set the session in a sheet (modal
on desktop) before it starts: lifetime presets 5 min / 15 min / 1 hour
(server accepts 1 min–24 h), a strict-mode switch, and a "remember these
settings" checkbox. The sheet states plainly what the server sees
(session existence, timing, size — never content).

**US-5.3b** As a participant, I want a compact vertical **view-once
switch** (flame) in the private composer and a "Burn" action in every
private message's menu, so that I control destruction per message
instead of per session. Until the contact is verified the switch slot
shows a lock.

**US-5.3a** As BOTH participants, I want verification to follow a
per-device TOFU (trust-on-first-use) model:

- **Verification binds device pairs, not accounts.** My iOS↔friend's
  iOS verified ≠ my desktop↔friend's iOS verified. A private session
  exists only between two specific devices — never shared account-wide.
- **First contact between a device pair** requires manual
  verification — emoji grid ritual or QR. Hoster-signed alone is NOT
  sufficient for a never-verified pair.
- **Chain of trust for new devices**: once one device pair is
  verified, a new device is verified through the existing private
  channel — the peer reads their emoji grid and I confirm it via the
  already-verified session. No call or meeting needed.
- **Key pinning**: after verification the peer device's identity key is
  pinned locally. Subsequent sessions on the same pair use
  hoster-signed verification automatically.
- **Key change detection**: a changed pinned key → prominent in-chat
  "identity key changed" banner → re-verification required before the
  private toggle unlocks.
- **No key backup**: private identity keys never leave the device —
  lost device = lost keys = re-verify.

| Method | Protection tier | When |
|--------|----------------|------|
| Emoji grid ritual | "Extra check" — mutual 5-emoji grid, both tap 3 | First session on a device pair; re-verify after key change; new device via existing private channel |
| QR code | "Maximum — verify in person" | Face-to-face anchor; paranoid mode |
| Hoster-signed identity keys | "Verified by instance" — automatic | Only for previously verified device pairs (pinned keys) |

> **Implementation status (owner decision):** this model is built **now**
> in the dev PWA (slice F7, `docs/plans/F7-device-identity.md`) — device
> identity key, signed handshake, local pins, directory of public keys.
> The release PWA contains no private layer and therefore none of it.
> Native/desktop shells later swap IndexedDB for platform keystores.

**Trust indicators**: contacts and chats show a binary verification
chip — `unverified` (no pinned key or key changed) / `verified`
(key pinned, matches). Device details surface on tap ("verified:
my iOS ↔ their iOS · my desktop: unverified"), keeping the chip clean.

**US-5.3c** As a participant, I want the session's *settings* in a sheet
(US-5.3) and every other stage — invite sent, waiting, verification
ritual, session started, session ended — as in-chat cards/dividers, so
that the flow stays inside the conversation timeline with one visual
language. There is no separate verification screen inside a session.

**US-5.4** As a participant, I want an unmistakable private-mode
indicator: the private palette (a violet-ink hue that exists in both app
themes), a mask pattern background, a mask glyph on every private bubble,
a ringed composer with a mask placeholder, and header chips (Verified ·
countdown · strict) — so that I can never mistake which mode I'm in,
including in the dark app theme and without relying on colour alone. In
private mode the composer sends **private only**; to write publicly the
layer is switched off.

**US-5.5** As a participant, I want to toggle private mode OFF and back
ON while the session is alive (lifetime not expired, not burned), so
that I can mix public and private messages in one conversation.

**Transitions**
- `S5, contact unverified`: the header shows a **lock** ("Verify")
  instead of the layer switch → tap runs the device-bound verification
  ritual (US-5.3a) as an in-chat card → on success the switch appears
- `S5 (switch ON) → setup sheet`: lifetime / strict / remember
- `send invite`: in-chat divider "invite sent", composer stays public
- `peer accepts`: the chrome flips to the private palette **at accept**;
  both sides are already verified (an invite can only be sent/accepted
  between verified device pairs), so the session starts encrypted at once
- `private mode ON → S12 state`: countdown, BURN, private messages
  inline with mask glyph, ringed composer
- `toggle OFF (session alive)`: back to public mode, private history
  stays visible until burn/expiry
- `burn / expiry / grace exceeded`: private messages destroyed, toggle
  dies, timeline shows system marker "private session ended"

**Edge cases**
- Invitee offline → invite expires after configured timeout
- Disconnect mid-session → 60 s grace, visible "waiting" state → auto-burn
- App killed → same as disconnect; no session restore (zero persistence)
- Mode-confusion guard: private mode must be visually unmistakable —
  private palette + mask pattern, mask glyph on every private bubble,
  ringed composer, placeholder "Private message", a divider where the
  session started, public history recessed
- Page reload / app kill: private messages are memory-only and are gone —
  the timeline shows "private session lost" instead of vanishing silently

## Flow 6 — Profile & Settings

**US-6.1** As a user, I want to edit my nickname and see my ID, so that I
control my identity.

**US-6.2** As a user, I want to manage active sessions/devices, so that I
can revoke stolen access.

**US-6.3** As a user, I want notification controls (push on/off,
per-chat mute), so that I control interruptions.

**US-6.4** As a user, I want to see the platform security tier of my
current device, so that I understand my local protection level.

**US-6.5** As a user, I want an **optional device lock** (prompted at
first login, never forced): biometrics via passkey where the browser
supports it, otherwise a PIN/passcode, with auto-lock (immediately / 1 /
5 min / 1 h), so that someone holding my device cannot open the app. The
lock gates the whole app when on (public chats included) and protects the
stored secrets (session tokens, device identity, pins) — see
`docs/plans/F8-device-vault-lock.md`.

**US-6.6** As a user on a new device, I always sign in with email + OTP;
afterwards the app asks for the most convenient unlock (biometrics → PIN).
A suspicious sign-in (new device, repeated failures, several anomalies at
once) asks for a stronger check (passkey or an email code); **an IP or
country change alone never does** — VPN use must stay frictionless
(`docs/plans/F9-device-trust-stepup.md`; the full policy ships after MVP).

**US-6.7** As a user, if the device wipes after too many wrong PINs
(post-MVP for release builds), I want to recover the account with an
email OTP, understanding that contacts will see a new, unverified device
and I must verify them again — keys are never backed up.

**Transitions**
- `S4 → S13 → S14` and back
- `S14`: session list → revoke → confirmation → session killed

## Flow 7 — PWA Specifics

**US-7.1** As a PWA user, I want an install prompt at the right moment
(after first chat sent, not on landing), so that I install when value is
proven.

**US-7.2** As a PWA user, I want a push-permission request tied to context
("get notified about new messages"), not a cold browser prompt.

**US-7.3** As a PWA user, I want a visible offline state — queued messages,
greyed composer for unsupported actions — so that connectivity loss is not
silent.

**Edge cases**
- Push denied → in-app fallback hint in settings
- Offline on launch → cached chat list, no chat content guaranteed

## Cross-Cutting Rules

1. Every destructive action (delete message, remove member, burn session,
   revoke device) requires explicit confirmation.
2. Private-layer UI ships ONLY in the pilot PWA build — the regular
   build excludes the module entirely (see Recorded Product Decisions).
3. Presence/typing must degrade gracefully when Redis is unavailable.
4. All flows must work fully keyboard-accessible (native shells later).
5. Empty states are designed states, not afterthoughts: every list has a
   defined empty view.

## Recorded Product Decisions

- **Invite issuance**: no in-app UI. The hoster generates invite codes via
  a CLI script shipped with the instance (`POST /admin/invites`, local
  only). Fits the ~100-user closed-instance scope; revisit if instances
  grow.
- **Push payload privacy**: notifications carry no message content —
  "New message" + sender display name at most. Private sessions never
  trigger push (relay-only, no server-readable content anyway).
- **Dark theme**: shipped with the redesign (Light / Dark / System in
  Settings → Appearance). The old rule "dark surfaces are reserved for the
  private layer" is **retired**: private is distinguished by hue (violet),
  mask glyph, pattern and ringed composer in both themes. An automated
  test asserts the private tokens stay hue-distinct from the public ones.
- **Consent outlives the chat**: when either side ends the contact the
  direct chat stays for both as a read-only archive. A **system line** is
  added to the timeline, rendered per viewer — "You removed Anna from
  contacts — new messages are turned off. This chat stays as an archive."
  / "Anna removed you from contacts — …" — and the composer is locked
  (banner). Frozen chat: no new messages or uploads, **no edits, no pins,
  no typing indicator**; the author can still retract their own messages.
  Groups and saved messages are unaffected. "Remove chat from my list"
  is post-MVP. Contact requests never expire.
- **Retract, don't rewrite**: deleting a message leaves a visible
  "message deleted" tombstone (text, attachments, reply and pin are
  erased server-side; search and pinned views skip it). Editing is possible
  for **15 minutes** after sending (then `edit_window_closed` — delete and
  send a new message); an edited message shows "edited".
- **Navigation**: a bottom tab bar (Chats · Contacts · Settings) on root
  screens only; hidden in an open chat and on detail/sub-screens (group
  info, devices & sessions, verification, PWA prompts). Tab badges: unread
  chats, pending contact requests.
- **Layer vs encryption icons**: mask = the private *layer* (switch,
  bubble marker, pattern); lock = *encryption/verification status*.
- **Fonts**: Inter (UI, messages) + Source Code Pro (headings,
  identifiers), both self-hosted (OFL). No third-party font CDN anywhere
  in the app.
- **Device lock**: optional, prompted at first login; the same factor
  unlocks the app and the encrypted vault. In a browser "Face ID" means a
  passkey with user verification — there is no direct biometric API. The
  PWA lock is a deterrent against casual access, not hardware-grade
  protection; do not claim otherwise in UI copy.
- **Verification ritual placement**: verification happens **before** a
  private session — from the header lock, from S7, or from Contacts —
  never inside a session. Verified pairs are pinned per device pair and
  stored locally (dev PWA now; native shells on platform keystores). The
  release PWA has no private layer and therefore no verification.
- **Two PWA builds**: `pilot` — full build incl. the private layer
  (demo/testing track); `regular` — public layer only, private module
  is tree-shaken out (no code, no UI entry points). Build-time flag,
  same codebase.
- **Sheet/modal rule**: bottom sheets are mobile-only. On desktop PWA
  every sheet renders as a centered modal (`.scrim.bottom` → centered,
  `.sheet` 420px radius 16). Dismissal = X in the top-right corner or
  scrim tap; no dedicated "decline/cancel" button for dismiss-only
  sheets.
- **Chat-list search**: the search bar sits directly under the header,
  above folder tabs. On mobile it is hidden by default and revealed by
  a pull-down gesture on the list (iOS/Android pattern); on desktop it
  is always visible.
