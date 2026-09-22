# UI Kit — Penpot Reference

Single index of the OpenGlass design file for dev agents. Specs live in
`components.md` and `design-tokens.md`; this file maps where every
component lives in Penpot and how to reach it.

**File:** `openglass-mvp-screens`
**File ID:** `d8ac01df-6646-81d2-8008-a381c838c620`

View links follow `https://design.penpot.app/#/view/<file-id>?page-id=<page-id>&section=interactions`.

## Access for agents

Preferred path is the Penpot MCP server (`penpot`):

- `execute_code` — run JS in the plugin context:
  `penpot.currentPage.findShapes()` to locate shapes/components by name,
  `penpot.library.local.components` for masters.
- `export_shape` — PNG export of a board/shape for visual verification.
- Component and board names below are stable lookup keys — search by
  `name`, never by position.
- `*-legacy` masters are deprecated: never instantiate; replace instances
  with the current component of the same base name.

## Pages

| Page | Contents | Link |
|------|----------|------|
| `UI_Kit: 01_Foundation` | Colors, Typography, Iconography, Spacing, Radius, Strokes, States — mirrors `design-tokens.md` | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=56d9a9af-3b26-80b8-8008-a88c9abc4da7&section=interactions) |
| `UI_Kit: 02_Layout` | Column grid, Devices, PWA chrome, CSS Architecture | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=c47e64de-6ac7-8073-8008-a984aeccc95b&section=interactions) |
| `UI_Kit: 03_Atoms` | A · Identity / B · Controls / C · Badges / D · Chips / E · Text & misc | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=c47e64de-6ac7-8073-8008-a984cb294179&section=interactions) |
| `UI_Kit: 04_Molecules` | Molecule rows `mol *` — see index below | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=c47e64de-6ac7-8073-8008-a984dd40f232&section=interactions) |
| `UI_Kit: 05_Organisms` | Organism rows `mol *` — see index below | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=c47e64de-6ac7-8073-8008-a984f49334da&section=interactions) |
| `UI_Kit: 06_Anathomy` | Diagram boards: chat screen, bubble, chat-item, private session | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=c47e64de-6ac7-8073-8008-a9850327b26f&section=interactions) |
| `Hi-Fi · Mobile` | ⚠ Broken, pending rebuild — do not edit | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=4eddbdf9-deab-803a-8008-a716754b90e7&section=interactions) |
| `UI Raw` | Legacy screen references S1–S15 — read-only | [open](https://design.penpot.app/#/view/d8ac01df-6646-81d2-8008-a381c838c620?page-id=d8ac01df-6646-81d2-8008-a381c838c621&section=interactions) |

## 04 · Molecules — row index

| Block | Rows (`mol *` boards) |
|-------|------------------------|
| blkA | button-primary, button-secondary, button-danger, sm-buttons, button-ghost, input, otp-row, search-bar |
| blkB | chat-item, member-row, settings-row, session-row, profile-head |
| blkC | msg-incoming, msg-own, msg-private, msg-group, msg-attachment, bubble-states, **bubble-layout** (internal tray grid) |
| blkD | system-card, context-menu, empty-state, tooltips |
| blkE | composer, reply-strip, attach-strip, ttl-picker |

## 05 · Organisms — row index

| Block | Rows |
|-------|------|
| blkA | status-bar, header-list, header-chat, header-private, bottom-nav, folder-bar |
| blkB | chat-list, member-list, settings-section |
| blkC | message-day-group, composer, composer-stack |
| blkD | invite-sheet |

## Screen prototypes (Hi-Fi)

Hi-Fi screens are NOT drawn in Penpot — they live as production-shaped
HTML+CSS prototypes in `docs/ux/screens/` (see its README for the file
list). `base.css` carries the shared component classes; each screen is
mobile-first 390×844 with a `@media ≥1024` desktop layout (centered
card for auth, two-pane for app screens). These files are copied into
the frontend as components during implementation.

## 06 · Anatomy — diagrams

| Board | Covers |
|-------|--------|
| Chat screen | status-bar / header / day-group / composer / bottom-nav stack |
| Bubble anatomy | tray grid: name / chip / privacy / body / time / state / reaction |
| Chat-item anatomy | avatar / name+preview / time+badge / divider |
| Private session | dark screen, private header, masked bubbles, dark composer |

## Component library (local)

Active masters agents may instantiate:

- Chrome: `status-bar`, `header-list`, `header-chat`, `header-private`,
  `bottom-nav`, `nav-back`
- Bubbles: `msg-incoming`, `msg-own`, `msg-private`, `msg-group`,
  `msg-attachment`, `date-separator`
- Rows/lists: `chat-item`, `member-row`, `settings-row`,
  `session-row`, `search-bar`, `profile-head`
- Controls: `button-*` (primary/secondary/danger/ghost, sm-primary,
  sm-secondary), `input`, `otp-cell`, `checkbox`, `switch`,
  `preset-chip`, `verify-option`, `folder-tab`, `tooltip`
- Feedback: `context-menu`, `composer`, `system-card`,
  `chip-verified`, `chip-unverified`, `avatar-sm`, `screen-title`

Deprecated (do not use, kept for migration): all `*-legacy` masters —
`header-chat-legacy`, `header-private-legacy`, `header-list-legacy`,
`bottom-nav-legacy`, `composer-legacy`, `context-menu-legacy`,
`msg-incoming-legacy`, `msg-own-legacy`, `msg-private-legacy`,
`msg-group-legacy`, `member-row-legacy`, `search-bar-legacy`,
`settings-row-legacy`.

## Spec ↔ Penpot mapping

| Doc section (components.md) | Penpot location |
|-----------------------------|-----------------|
| `ui/msg-bubble — internal grid` | 04 · blkC · `mol bubble-layout` |
| `ui/msg-group` | 04 · blkC · `mol msg-group` + 05 · blkC · `mol message-day-group` |
| `ui/header` | 05 · blkA · `mol header-chat` / `mol header-private` |
| `ui/bottom-nav` | 05 · blkA · `mol bottom-nav` |
| `ui/chat-item` | 04 · blkB · `mol chat-item` + 05 · blkB · `mol chat-list` |
| `ui/chip — taxonomy` | 03 · D · Chips + 05 · blkB · `mol member-list` |
| `ui/context-menu`, tooltips | 04 · blkD |
| `ui/composer`, strips, `ttl-picker` | 04 · blkE + 05 · blkC/blkD |
| `ui/button`, `ui/input`, `ui/otp-row` | 04 · blkA |
