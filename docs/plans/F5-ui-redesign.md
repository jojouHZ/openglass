# Slice F5 — UI Redesign Pass (LAST)

Goal: replace the hand-rolled visual surface with a disciplined design
system, using `stream-chat-vue` / `stream-chat-css` (GetStream) and
Telegram as structural references — **structure only, no code, no
runtime dependency** (their SDKs are React/Vue wrappers around the
Stream service, which we do not use; we borrow the component
architecture and CSS layering discipline).

## Why a dedicated slice

F3 was a polish pass on the existing token system — it fixed defects,
it did not redesign. The owner rates the visual surface as the weakest
part of the product. A redesign belongs last: F1 introduces consent
screens, F2 rebuilds the private surface, F4 deletes stubs — all must
exist before they are restyled.

## Scope

### 1. Design tokens v2 (`apps/pwa/src/styles/tokens.css`)

- Audit the current scale (Source Code Pro mono, monochrome, 8pt grid)
  against the redesign target — decide whether mono stays as brand or
  becomes content-only.
- Elevation tokens (shadows) — currently absent; sheets/menus use
  ad-hoc `shadow-lg`.
- Semantic tokens: `surface-1/2/3`, `text-primary/secondary/danger`,
  `accent`, `state-*` — replacing literal color names so themes swap
  cleanly.
- **Theme layering** à la `stream-chat-css`: base layer + theme
  overrides through CSS custom properties. `light`, `dark`,
  `private` as peer themes — `.private-mode` stops being a special
  snowflake and becomes a theme applied the same way.

### 2. Canonical component inventory

One component per role, screen files compose them (stream-chat's
component discipline — ChannelList/Channel/MessageList/Message/
Composer as separable units):

| Ours today | Canonical target |
|---|---|
| S4 rows inline | `ChannelList` + `ChannelListItem` (exists — formalise) |
| S5 header | `ChannelHeader` (extracted component) |
| `msg-scroll` block | `MessageList` + `Message` (sequence grouping, avatar-trail, meta row, date separators as data) |
| Composer.vue | keep, restyle (reply/edit states, attachment strip) |
| scattered modals/sheets | `Sheet`/`Modal` primitives with consistent placement rules |
| — | `EmptyState`, `Skeleton`, `ErrorState` primitives — per component, not per screen |

### 3. Message grouping rules (stream-chat reference)

Consecutive same-sender messages collapse avatar+name; meta row only
on last-of-group; day separators as list items; time-gap threshold
(~5 min) breaks a group. Current implementation approximates this —
align to the reference rules exactly.

### 4. Interaction & a11y pass

- Touch targets ≥44px, visible focus rings (keyboard nav).
- Motion: 150–200ms ease transitions on sheets/menus/hover states —
  none today.
- Skeleton loading for chat list + message list (currently blank or
  spinner-less).
- Empty states: no chats, no contacts, no messages — designed, not
  blank.

### 5. Screens sweep

S1–S14 + private surface against the new inventory — find and kill
one-off styles, dead visual variants, inconsistent paddings.

## Explicitly out of scope

- No new features — this restyles what exists.
- No stream-chat dependency or API — reference repo only.
- Private-layer crypto/state untouched (theme only).
- Dark theme ships if cheap via token layering; otherwise post-MVP.

## Verification

- Visual checklist per screen (owner review, 3-browser pass like the
  Oct 16 manual test).
- All existing tests must stay green — testids are the contract.
- `check-mvp-bundle`, typecheck, build, E2E.
- a11y spot-check: keyboard-only navigation through S4→S5→menu.
