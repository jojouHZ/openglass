# OpenGlass Roadmap

North star: **a laconic product with no stubs** — every UI element either
works or honestly doesn't exist. Placeholders, dead tabs and 501 routes
are defects, not savings.

## Current State (post manual test, Oct 16)

Two layers implemented and CI-verified: public messaging (PG-backed,
realtime) and a dev-tier private layer (ECDH→AES-GCM, SAS, view-once,
zero-trace teardown). Manual 3-browser testing found the backend logic
sound — the gaps are consent semantics and UI/UX polish.

## Decisions since the concept review (owner-approved)

- UI target = `docs/ux/concept-07/` (Slate Tabs): tab-bar navigation,
  dark theme, same-window private session, four palettes.
- Verification is **device-bound and persistent in the dev PWA now**
  (slice F7): device identity key, signed handshake, local pins, public
  key directory; the release PWA has no private layer and no
  verification. Supersedes the per-session SAS-confirm ack.
- Mask = private layer, lock = encryption/verification status; header
  lock replaces the layer switch for unverified contacts.
- Palette flips when the invite is accepted; background = mask pattern.
- Dark theme is no longer reserved for the private layer (hue + glyph
  distinguish it).

## MVP Residual Work (fix-list)

### Logic bugs

| # | Issue | Fix |
|---|-------|-----|
| B1 | Contacts invisible in UI (edges exist in DB) | contacts screen/section must render the store list |
| B2 | Group add requires no consent — spam vector | pending membership: `group.invite` → accept → member |
| B3 | Private session usable before verification | **superseded by F7**: no private session between unpinned device pairs (header lock) — "both verified" holds by construction |
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
| F-2 | Layer switch → **sheet/modal** with session settings (5 min / 15 min / 1 h, strict, "remember configuration") — not a separate screen |
| F-3 | Private messages render **inside the same conversation window** — the secret layer overlays the public chat, not a separate route |
| F-4 | View-once: oversized fire button → compact **vertical** switch (flame) in the private composer; lock in its place until the contact is verified |
| F-5 | Icon roles: **mask = private layer**, **lock = encryption/verification status** (supersedes "mask → lock") |
| U-3 | Folder strip: `All` + disabled "New folder" affordance (real folders are post-MVP) |
| U-4 | Chat list → Telegram-style row: avatar, name+preview, date/pin/mute, unread badge |
| U-5 | displayName stays editable; tag immutable forever (rename-notify-mutuals is post-MVP) |

### Verification — decided

Out-of-band ritual shows **5 emoji** (≈30 bits) derived from both
devices' **identity public keys** — "compare out loud or in person, never
send it in chat" — or a QR when meeting. It runs **before** a session
(header lock / contact profile / Contacts), pins the peer device locally
and unlocks the layer switch (slice F7). GitHub-style asymmetric
code-entry stays rejected: it invites sending the code over the channel
being protected. Persistent signed identity / TOFU, previously
post-MVP, is now built in the dev PWA (F7); hardware keystores remain a
native-shell item.

### Stub removal (new MVP scope)

| Stub | Disposition |
|------|-------------|
| Fake folder tabs | remove (U-3) |
| `POST /reports` (501) | implement: table + endpoint, operator-visible via DB until admin surface |
| Push (VAPID/subscriptions 501) | **decided: routes leave the contract now**; real web-push returns post-MVP as a complete feature |

## Post-MVP Backlog

- **Private layer → production tier**: hardware keystore
  (Keychain/Keystore/safeStorage) with OS-enforced unlock limits and
  biometrics, hoster-signed identity keys, multi-tab support, HKDF domain
  separation (device identity, pinning, QR/emoji verification and the
  device lock are **built earlier**: F7 identity/pins, F8 vault + lock, F9 device trust)
- **Shells**: Capacitor, Electron, then native iOS/Android/Desktop
- **Group private chats** (currently 1-to-1 only)
- **Double Ratchet** for private sessions
- **Screenshot detection + notify**
- **Scale**: Redis-backed distributed rate limit, multi-instance relay
- **Push notifications** (if not pulled into MVP via stub removal)
- **Offline send queue**, server-side message search (public only —
  E2EE history search is impossible by design)
- **Real chat folders**
- **Auth hardening** (F8/F9 remainder): wipe-after-failures in release
  builds, hardware-backed unlock, passkey device binding, risk-based
  step-up, token binding + rotation-reuse detection, instance lock policy
- **Contact-request message**: a short note sent together with a contact
  request (so the recipient knows who is asking and why)
- **Profile privacy setting — who may write to me**: everyone / contacts
  only / contacts and their contacts (built with the desktop client; the
  default stays "contacts only", i.e. today's consent model)
- **Cap on active outgoing contact requests** (requests themselves never
  expire — owner decision); complements the per-user rate limit
- **Rename notification to mutual contacts**
- **Desktop split view** (list | chat | info panel) — slice F6
- **Admin surface**: reports review, moderation, rare direct-DB
  overrides
- **Course production** (docs/course)

## UX/UI Direction

- **Target: concept 07 "Slate Tabs"** (`docs/ux/concept-07/`), built on
  shadcn-vue + Reka UI (owned code, no runtime library); tokens v3 in
  `docs/ux/design-tokens.md`. Telegram's row density and GetStream's
  component discipline remain structural references only.
- Private layer inside the host chat window keeps one mental model: a
  conversation that can go private, not a separate app mode.

## Slicing Order — decided

| # | Slice | Where | Plan |
|---|-------|-------|------|
| ✅ | F3 UI polish | main | `docs/plans/F3-ui-polish.md` |
| 1 | **F1** Contacts consent (F-1, B1, B2, B4) — also unblocks the Contacts tab — **done**; **F1.1** sending in a direct chat requires a mutual pair (403 `not_contacts`) — **done**; chore: certifi 2026.10.19 (PR #46, alert #5) — **done** | main | `docs/plans/F1-contacts-consent.md` |
| 2 | **F4** No stubs: push out of the contract, reports real (+ operator CLI `ogadmin`, optional) — plan detailed, awaiting go | main | `docs/plans/F4-stub-removal.md` |
| 3 | **F5 core** M3–M5: tokens/themes, tab bar, Contacts root, list + chat | branch `f5-ui-redesign` (not pushed) | `docs/plans/F5-ui-redesign.md` |
| 4 | **F7** Device identity & verified contacts (wipe on sign-out until F8) | branch | `docs/plans/F7-device-identity.md` |
| 4b | **F8** Device vault & lock — optional lock (PIN/passkey), vault for tokens + identity, auto-lock; sign-out keeps the encrypted vault | branch | `docs/plans/F8-device-vault-lock.md` |
| 4c | **F9** Device trust & step-up auth (server): MVP = new-device email notification only; rest after MVP | main/branch | `docs/plans/F9-device-trust-stepup.md` |
| 5 | **F5-M6 = F2** private pane in the new design | branch | `docs/plans/F2-private-ux.md` |
| 6 | F5 M7–M8 sweep + local gate; owner manual test; merge **on owner command only** | branch → main | |
| later | F6 desktop split view | | |

Release-MVP boundary for auth/lock (owner-confirmed): optional app lock
(PIN + passkey where supported), email+OTP on every new device,
sessions list, new-device login email. After MVP — and implemented fully
on **desktop first**: wipe-after-failures in release builds, hardware
unlock, passkey device binding, risk-based step-up, instance lock policy.

Rationale: F1 is a security fix (group spam) and a hard dependency of the
Contacts tab; F2 would be built twice if done on the old styling, so it
lives inside F5; F7 precedes the private pane because the header lock,
composer lock and chat-list chip read its state.
