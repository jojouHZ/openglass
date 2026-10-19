# 14 — F3: UI polish pass

Date: 2025-12-11. Slice F3 of the post-manual-test roadmap
(`docs/ROADMAP.md`, plan `docs/plans/F3-ui-polish.md`). First slice in
the agreed order — visual quality was the weakest link after the
three-user manual test.

## What shipped

**B6 — context menu anchoring.** `MessageMenu.vue` previously hardcoded
`Math.min(x, 200)` / `Math.min(y, 320)` which pinned the menu to the
top-left corner regardless of which bubble was clicked. Replaced with
event-coordinates anchoring + viewport clamping against real menu
dimensions (measured after mount, re-clamped in `nextTick`).

**B7 — group sender avatars.** Group message rows rendered an empty
`<span>` where an avatar should be. Now shows sender initials derived
from display name — same treatment as profile avatars.

**B8 — group settings entry point.** The header treated the *group
avatar* as the settings button while the title was dead text — and a
click on one's own avatar also opened settings (wrong hit target).
Settings now open from a dedicated `headerTarget` control (title +
subtitle), consistent with Telegram's "tap chat name → info" pattern.

**B9 — member rights sheet placement.** The rights overlay in
`S9aGroupManage` sat too low on screen — toggles were unreachable.
Reworked to a bottom-sheet / centered-modal presentation over the scrim.

**B10 — sign out this device.** S14 could only revoke *other* sessions;
with a single session the screen offered no action at all. Added a
current-device "sign out" row that runs `session.logout()` — local
state is torn down in `finally` even if the server call fails —
then routes to `s1-invite`.

**B11 — full-row search highlight.** In-chat search highlighted only
the message bubble (`ring` on the bubble), which was nearly invisible.
Message rows are now wrapped in a full-width container that takes a
background strip (`-mx-6 bg-soft px-6`) — a Telegram-style band across
the entire row. `data-mid` stayed on the interactive element so
existing tests still target it.

**U-3 — honest folder strip.** The tab bar had fake `all / private /
groups` tabs (`private` even appeared only in dev builds) backed by a
comment admitting "no folder semantics in contract". Replaced with a
single `all` label plus a disabled `+ new folder` button — real chat
folders are post-MVP.

**U-4 — Telegram-style chat row.** `ChatListItem` was already close
(52px avatar, name, preview, date, unread). Polish: pin icon moved
from the title row to the right rail (below the date, only when no
unread badge), the redundant `group` chip removed from the preview,
and outgoing own messages get a `you: ` prefix.

**S1 — invite hint.** Label is now "Invite code (new accounts only)" —
returning users no longer read it as mandatory. (B4's deeper check is
in F1.)

**S11 — private setup visibility.** Root cause of "ui is invisible,
no buttons": `.private-mode` inverted `--color-ink` to white but no
element painted `--color-bg` — white text on the body's white
background. The token class now paints its own background
(`background: var(--color-bg)`), making the inversion self-contained.

## War stories

- **Wrapper broke `data-mid`.** The B11 full-row wrapper initially
  carried `data-mid`, but `@contextmenu`/long-press handlers live on
  the inner flex div — two unit tests targeting `[data-mid]` went red.
  Moved `data-mid` back to the element that owns the handlers; the
  wrapper is purely visual.

- **`.gitignore` + `data/`.** The manual test surfaced runtime upload
  blobs under `data/` as untracked noise — added to `.gitignore`.

## Verification

- `vue-tsc --noEmit` clean
- vitest: 59/59 green
- `vite build` clean; `check-mvp-bundle` — no private artifacts in dist

## Remaining roadmap (post-F3)

F1 contacts consent → F2 private UX rework → F4 stub removal, per
`docs/ROADMAP.md`.
