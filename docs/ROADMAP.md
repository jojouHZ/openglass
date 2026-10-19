# OpenGlass Roadmap

North star: **a laconic product with no stubs** — every UI element either
works or honestly doesn't exist. Placeholders, dead tabs and 501 routes
are defects, not savings.

## Current State (post manual test, Oct 16)

Two layers implemented and CI-verified: public messaging (PG-backed,
realtime) and a dev-tier private layer (ECDH→AES-GCM, SAS, view-once,
zero-trace teardown). Manual 3-browser testing found the backend logic
sound — the gaps are consent semantics and UI/UX polish.

## MVP Residual Work (fix-list)

### Logic bugs

| # | Issue | Fix |
|---|-------|-----|
| B1 | Contacts invisible in UI (edges exist in DB) | contacts screen/section must render the store list |
| B2 | Group add requires no consent — spam vector | pending membership: `group.invite` → accept → member |
| B3 | Private session usable before SAS | verify-to-unlock: messaging enabled only after **both** confirm |
| B4 | Returning user asked for invite | S1 invite field must signal "optional for returning users"; verify backend path |
| B5 | Private chat has no exit affordance | back/close control + clear "leave" semantics |
| B6 | Message context menu detached from bubble | anchor menu to the bubble (right-click/long-press) |
| B7 | Group message sender avatar empty | render initials like own-profile avatar |
| B8 | Group rights open on own-avatar click, not group name | fix hit-target to group header |
| B9 | Rights modal positioned off-viewport | modal placement fix |
| B10 | Cannot revoke current session from S14 | "this device → sign out" action |
| B11 | In-chat search highlight too weak | full-row highlight strip (Telegram-style) |
| B12 | Offline test shows dino page | SW absent in vite dev — methodology: test on `vite preview` build |

### Product/UX changes (owner-decided)

| # | Change |
|---|--------|
| F-1 | **Contacts → invite-consent model**: request → accept → mutual on both sides; decline → nothing; sender may re-request. Replaces one-way add. |
| F-2 | Private toggle → **modal** with session settings (TTL, strict) + "remember configuration" checkbox — not a separate screen |
| F-3 | Private messages render **inside the same conversation window** — the secret layer overlays the public chat, not a separate route |
| F-4 | View-once: oversized fire button → compact toggle |
| F-5 | Private icon: mask → lock |
| U-3 | Folder strip: `All` + disabled "New folder" affordance (real folders are post-MVP) |
| U-4 | Chat list → Telegram-style row: avatar, name+preview, date/pin/mute, unread badge |
| U-5 | displayName stays editable; tag immutable forever (rename-notify-mutuals is post-MVP) |

### SAS verification — decided

Grid shrinks to **5 emoji** (≈30 bits — minimum honest entropy for
out-of-band MITM detection) plus an explicit hint: "compare out loud or
in person — never send it in chat". GitHub-style asymmetric
code-entry was rejected: it structurally invites sending the code over
the channel being protected, which a MITM can rewrite.

**QR verification** (both devices show/scan the SAS as a QR — Signal
style) is the planned second mode; it lands with the private layer's
production-tier work since it needs camera access and a QR dependency.

### Stub removal (new MVP scope)

| Stub | Disposition |
|------|-------------|
| Fake folder tabs | remove (U-3) |
| `POST /reports` (501) | implement: table + endpoint, operator-visible via DB until admin surface |
| Push (VAPID/subscriptions 501) | **decided: routes leave the contract now**; real web-push returns post-MVP as a complete feature |

## Post-MVP Backlog

- **Private layer → production tier**: hardware keystore
  (Keychain/Keystore/safeStorage), persistent signed identity
  (trust-on-first-use), QR-code SAS verification, multi-tab support,
  HKDF domain separation
- **Shells**: Capacitor, Electron, then native iOS/Android/Desktop
- **Group private chats** (currently 1-to-1 only)
- **Double Ratchet** for private sessions
- **Screenshot detection + notify**
- **Scale**: Redis-backed distributed rate limit, multi-instance relay
- **Push notifications** (if not pulled into MVP via stub removal)
- **Offline send queue**, server-side message search (public only —
  E2EE history search is impossible by design)
- **Real chat folders**
- **Rename notification to mutual contacts**
- **Admin surface**: reports review, moderation, rare direct-DB
  overrides
- **Course production** (docs/course)

## UX/UI Direction

- **Decided foundation: shadcn-vue + Reka UI** (owner decision) —
  owned copy-paste primitives, floating-ui overlay correctness,
  a11y defaults, strict business aesthetic. No runtime library
  dependency: component source lives in-repo.
- Visual references: Telegram's information density (row = avatar +
  name + preview + right-side meta rail) and GetStream's component
  discipline (`stream-chat-vue`/`stream-chat-css` — structure only:
  canonical ChannelList/ChannelHeader/MessageList/Message/Composer
  roles, theme layering via CSS custom properties, message-sequence
  grouping rules).
- Private layer inside the host chat window (F-3) keeps one mental
  model: a conversation that can go private, not a separate app mode.

## Slicing Order — decided

| Slice | Contents | Plan | Status |
|-------|----------|------|--------|
| **F3** | UI polish pass (B6–B11 + U-3/U-4 + S1 hint + S11 visibility) | `docs/plans/F3-ui-polish.md` | done (`de8acc1`+`3038a79`) |
| **F1** | Contacts consent model (F-1 + B1 + B2 + B4) | `docs/plans/F1-contacts-consent.md` | next |
| **F2** | Private UX rework (B3, B5 + F-2/F-3/F-4/F-5 + SAS=5) | `docs/plans/F2-private-ux.md` | |
| **F4** | Stub removal (push routes out, reports real, placeholders gone) | `docs/plans/F4-stub-removal.md` | |
| **F5** | **UI redesign pass** — shadcn-vue+Reka primitives, tokens v2, canonical component inventory, theme layering, a11y/motion pass across all screens | `docs/plans/F5-ui-redesign.md` | |

F5 lands last deliberately: consent-model screens (F1) and the
reworked private surface (F2) should exist before they're restyled —
repainting walls after the rooms are built, not before.
