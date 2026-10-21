# Design Tokens

Single source of truth for OpenGlass visual language (tokens v3, concept
07 "Slate Tabs"). Every value here maps to a CSS variable / Tailwind v4
`@theme` key. Adjust here → regenerate.
Penpot file map and links: `ui-kit.md`.

## Colors (tokens v3 — supersedes the monochrome v1/v2 palette)

Source of truth for the numbers: `docs/ux/concept-07/palette.mjs`
(machine-checked, WCAG 2.x AA contrast table in
`docs/ux/concept-07/01-palette.html`). Visual reference:
`docs/ux/concept-07/index.html`.

Four modes. The app theme (Light / Dark / System, user setting) picks the
public pair; a live private session swaps in the matching private pair.
**Private is a hue, not a brightness**: the violet-ink private palettes
exist in both app themes, so "dark" never means "private" (a dark app theme
is already dark).

| Token | Light · public | Dark · public | Private · on light app | Private · on dark app | Usage |
|---|---|---|---|---|---|
| `bg` | `#f8fafc` | `#0b1220` | `#1b1540` | `#07050f` | Screen background |
| `card` | `#ffffff` | `#111a2e` | `#251d54` | `#100c20` | Cards, sheets, tab bar, composer (private) |
| `fg` | `#0f172a` | `#e6ebf5` | `#f1edff` | `#f4f0ff` | Primary text |
| `mfg` | `#53627a` | `#9aa8c4` | `#b9b0e0` | `#aaa0cf` | Secondary text, meta, placeholders |
| `muted` | `#eef2f7` | `#18233b` | `#2f2670` | `#1a1433` | Search field, segmented control, chips base |
| `border` | `#dbe3ee` | `#25345a` | `#41358a` | `#2c2256` | Dividers, field borders |
| `primary` | `#3b5bdb` | `#8ea2f7` | `#b79cff` | `#c4adff` | Primary action, active tab, badge |
| `pfg` | `#ffffff` | `#0b1220` | `#1b1540` | `#07050f` | Label on primary |
| `inb` | `#ffffff` | `#18233b` | `#2f2670` | `#1a1433` | Incoming bubble |
| `infg` | `#0f172a` | `#e6ebf5` | `#f1edff` | `#f4f0ff` | Text on incoming bubble |
| `ownb` | `#3b5bdb` | `#3b5bdb` | `#6f4fe6` | `#6c47e6` | Own bubble |
| `ownfg` | `#ffffff` | `#ffffff` | `#ffffff` | `#ffffff` | Text on own bubble |
| `okb` | `#dcfce7` | `#123524` | `#123524` | `#0f2c1d` | Chip verified bg |
| `okf` | `#14532d` | `#86efac` | `#86efac` | `#86efac` | Chip verified text |
| `pvb` | `#ede9fe` | `#2b2160` | `#41358a` | `#2c2256` | Chip private bg |
| `pvf` | `#4c1d95` | `#d6ccff` | `#ece6ff` | `#e9e2ff` | Chip private text |
| `warnb` | `#ffedd5` | `#3a1d0c` | `#3a1d0c` | `#3a1d0c` | Chip warning / view-once bg |
| `warnf` | `#9a3412` | `#fdba74` | `#fdba74` | `#fdba74` | Chip warning / view-once text |
| `danger` | `#b91c1c` | `#f87171` | `#fca5a5` | `#fca5a5` | Destructive text |

Rules:

- Semantic names only in components (`bg`, `fg`, `primary`, …) — no literal
  hex outside the token layer; shadcn aliases (`--color-background`,
  `--color-primary`, …) map onto these.
- Private violet (`primary`/`pvb`/`pvf` in the private modes) appears
  **nowhere in public UI**. Every private bubble also carries the mask
  glyph — the layer is never signalled by colour alone.
- Every text pair must pass AA (4.5:1; recessed public history 3:1). A
  token change that fails the contrast test does not merge.
- Public history inside a private session is shown recessed (60% opacity).

## Typography (v3)

- **Body, UI, messages: Inter** (variable, self-hosted via `@fontsource`).
- **Headings, screen titles, identifiers (`tag`), numeric timers:
  Source Code Pro 400** (self-hosted).
- Weights are no longer flat: names/chips/buttons 500–600, section labels
  700 uppercase, body 400. Emphasis through weight + colour + size.
- Tokens: `--font-sans` (Inter), `--font-heading` (Source Code Pro).

| Token | Size | Usage |
|-------|------|-------|
| `screen-title` | 24–28 | Auth/setup titles (mono) |
| `header` | 19 | List & chat headers (mono) |
| `name` | 15–16 / 600 | Chat names, profile head |
| `body` | 14 | Buttons, inputs, rows, settings |
| `msg` | 14.5 | Bubble text |
| `preview` | 13.5 | List previews |
| `meta` | 12 | Time, captions, sender names |
| `chip` | 11.5 / 600 | Chips, badges, tab labels |
| `micro` | 11 | In-bubble time and state |

## Iconography

Pack: **Lucide** (lucide.dev, ISC license — compatible with AGPL).
Style: 24px grid geometry, **stroke 1.75px**, round caps & joins,
stroke-only (no fills).
Sizes: `16` inline/meta · `20` UI default (base size).
Color: inherits the text token of its context.
`flame` (view-once / burn) is stroke-only like every icon; when active it
uses the `warnf` colour on a `warnb` chip so it stays unmistakable
without a filled glyph.

Emoji placeholders are replaced by Lucide glyphs:

| Emoji | Lucide icon | Context |
|-------|-------------|---------|
| ← | `arrow-left` | Back navigation |
| 🔍 | `search` | Search bar |
| + | `plus` | New chat |
| ⋯ | `ellipsis` | Header "more" |
| 📎 | `paperclip` | Attachment (composer, file bubble) |
| ↑ | `arrow-up` | Send button |
| ✓ | `check` | Sent state, checkbox, confirm |
| ✓✓ | `check-check` | Read receipt |
| 🔥 | `flame` | Burn / TTL |
| 🔒 | `lock` | **Encryption/verification status** — Verified chip, locked header control and composer slot until the contact is verified |
| 🎭 | `venetian-mask` | **Private layer identity** — layer switch, marker on every private bubble, background pattern |
| — | `timer` | Session TTL countdown |
| ✎ | `pencil` | Edit message |
| 📌 | `pin` | Pin message |
| 🗑 | `trash-2` | Delete |
| ↩ | `reply` | Reply |
| ⧉ | `copy` | Copy tag / content |
| › | `chevron-right` | Row navigation |
| ✕ | `x` | Close / remove |
| — | `shield-check` | Verified device pair |
| — | `users` | Group chat |
| — | `bell` | Notifications |
| — | `camera` | Screenshot alert |
| — | `settings` | Settings |

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `r-input` | 8 | Text fields, buttons, preset chips |
| `r-nav` | 10 | Bottom nav |
| `r-pill` | 13 | Pills: chips, date separator |
| `r-tooltip` | 15 | Tooltip |
| `r-card` | 16 | Bubbles, in-chat cards, modals |
| `r-search` | 24 | Search bar |
| `r-round` | 32+ | Avatars, send button (full round) |
| `r-logo` | 6 | Logo badge |

## Spacing

8pt grid. Scale: `4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 70`.

| Values | Usage |
|--------|-------|
| 4 · 6 · 8 | Inside message group · avatar→bubble · between groups |
| 12 · 16 | Screen-edge inset · component padding |
| 20 · 24 | Row gaps · screen margin |
| 32 · 48 | Component gaps · section padding |
| 70 | Opposite-side inset behind bubbles |

## Strokes

| Token | Value | Usage |
|-------|-------|-------|
| `border` | 1px `line` | Dividers, default borders |
| `border-strong` | 1.5px `line`/`body` | Inputs, in-chat cards, focus ring |

## States & opacity

| Token | Value | Usage |
|-------|-------|-------|
| `pressed` | opacity .88 | Pressed buttons |
| `disabled` | opacity .4 | Disabled controls |
| `guides` | `accent` @ .4 | Layout guides (kit only) |
| `scrim` | `ink` @ 40% | Overlay behind sheets/menus |
| `menu-shadow` | 0 / 8 / 24, `#000` @ 12% | Context menu elevation |

## Screen

Mobile: **390×844** (iPhone 14 class). Safe areas: `env(safe-area-inset-*)`.

## Devices & viewports

CSS viewport (logical px), portrait. Safe-area = top / bottom inset.

### iOS — iPhone XR and up

| Device | Viewport | Safe T/B | Notes |
|--------|----------|----------|-------|
| iPhone XR / 11 | 414×896 @2x | 48 / 34 | notch · owner test device |
| iPhone 12 / 13 / 14 | 390×844 @3x | 47 / 34 | kit canvas baseline |
| iPhone 12/13 mini | 360×780 | 50 / 34 | narrowest modern iPhone |
| 14 Pro · 15 · 16 | 393×852 | 59 / 34 | Dynamic Island |
| Plus / Pro Max | 430×932 | 59 / 34 | largest current |
| iPhone 16 Pro / PM | 402×874 / 440×956 | 62 / 34 | larger DI inset |

### Android — popular models

| Device | Viewport | Safe T/B | Notes |
|--------|----------|----------|-------|
| Galaxy S23 / S24 | 360×780 | 24 / 16 | Samsung flagship, gesture nav |
| Galaxy S24 Ultra | 412×915 | 24 / 16 | stylus flagship |
| Pixel 7 / 8 | 412×915 | 24 / 16 | stock Android |
| Pixel 8 Pro / XL | 448×998 | 24 / 16 | |
| Redmi / POCO mid | 393×873 | 24 / 16 | typical mid-range |

**Design floor: 360×800** — most common Android viewport; layout must not
break below 360 wide.

### Desktop / macOS

| Context | Viewport | Notes |
|---------|----------|-------|
| Browser ≥1024 | fluid | two-pane: chat list 340 + chat fill |
| Desktop window | min 960×600 | below min → mobile single-column |
| macOS shell | — | traffic lights 78×28 top-left, titlebar 38 |

Breakpoints: `<768` single column · `768–1023` narrow two-pane ·
`≥1024` two-pane · `≥1440` content max 1400 centered.

## PWA · browser chrome

- **Height** — `100dvh` for full-height; never fixed `100vh` under iOS
  Safari.
- **Viewport** — `viewport-fit=cover`; pad edges with
  `env(safe-area-inset-*)`.
- **Top** — status-bar/header inside `safe-area-inset-top`; Safari
  address bar overlays ~55px.
- **Bottom** — composer & bottom-nav inside `safe-area-inset-bottom`;
  Safari toolbar ~50px overlays content.
- **Keyboard** — `interactive-widget=resizes-content`; pin composer to
  `visualViewport.bottom`.
- **Scroll** — bars collapse on scroll; never measure once — listen to
  `visualViewport` resize.
- **Safe bottom** — iOS home indicator 34, Android gesture ~16; keep 12+
  breathing room.
- **Installed standalone** — no browser chrome; our status-bar component
  owns the top inset.
- **Test** — iPhone XR: Safari in-browser + installed standalone;
  Android Chrome at 360×780.

## CSS architecture

Assign these rules to atoms/molecules/organisms as they are built — the
frontend then just assembles them.

### Primitives

| Primitive | Use for | Never |
|-----------|---------|-------|
| `flex` row | headers, toolbars, composer, list rows, chip/tag groups | 2-D structures |
| `flex` column | screen stacks, message flow, forms, menus | when order/direction varies — use grid |
| `grid` | app shell rows, desktop two-pane, media grids, header centering (`1fr auto 1fr`) | simple rows/columns |
| `absolute` | badges, online dot, tooltips, menus, decorative guides — inside positioned parent | content flow layout |
| `sticky` | date separators & section headers inside scroll regions | app chrome — chrome lives in shell rows |
| `fixed` | only true overlays above the shell: sheets, scrims, toasts | header/composer/nav — they are shell rows, not fixed |

### Shell templates

| Shell | Rule |
|-------|------|
| Mobile | `display:grid` · `grid-template-rows: auto 1fr auto auto` → status+header / scroll / composer / bottom-nav |
| Desktop ≥1024 | `grid-template-columns: 340px 1fr` → chat list / conversation; each pane keeps its own mobile rows |
| Scroll region | only the `1fr` row scrolls · `overflow-y:auto` · `overscroll-behavior:contain` |
| Safe areas | padding on outermost chrome only: header top, composer/nav bottom via `env(safe-area-inset-*)` |

### Component CSS map

| Component | CSS rule |
|-----------|----------|
| `status-bar` | flex row · `justify-content:space-between` · `align-items:center` · h44 |
| `header-*` | flex row · `align-items:center` · h76 · title via inner `grid 1fr/auto/1fr` |
| `bottom-nav` | flex row · `justify-content:space-around` · h80 + `padding-bottom:env(sab)` |
| `composer` | flex row · `align-items:flex-end` · gap 8 · input `flex:1` + `min-width:0` |
| list rows (chat/member/session/settings) | flex row · `align-items:center` · separator `border-bottom:1px line` · text col `min-width:0` |
| message flow | flex column · gap 4 in-group / 8 between · own msgs `margin-left:auto` |
| `msg` bubble | `inline-flex` column · `max-width:276px` text / ~300 bubble · padding 8×12 · r16 |
| `date-separator` | `position:sticky` · `top:8px` · `align-self:center` · inside scroll region |
| forms / auth / system-card | flex column · gap 16/24 · `width:min(342px, 100%−48px)` |
| `context-menu` / `tooltip` | `position:absolute` in anchored overlay layer · `menu-shadow` token |
| `avatar-sm` + status dot | `position:relative` on avatar · dot `absolute; right:0; bottom:0` |
| chips / badges / tabs | `inline-flex` · `align-items:center` · padding tokens · `r-pill` |
| media / attachment grid | `grid` · `repeat(auto-fill, minmax(160px,1fr))` · gap 4 |

### Mechanics

- **Text ellipsis** — flex child: `min-width:0` + `white-space:nowrap` +
  `overflow:hidden` + `text-overflow:ellipsis`.
- **Scrolling** — only the `1fr` shell row scrolls;
  `overscroll-behavior:contain`.
- **Full height** — shell uses `100dvh`; safe-area pads on outermost
  chrome only.
- **Tokens → CSS vars** — `--ink`, `--bg`, `--accent`, `--sp-4..70`
  generated from this file / tailwind config.
- No floats, no negative margins, no magic px — spacing from the 8pt
  scale only.

## Private-mode overrides

A live private session swaps the whole chrome to the private palette for
the current app theme (see Colors): violet-ink background with a tiled
mask pattern (stroke at ~8–9% opacity, capped so text stays AA), private
bubbles with a mask glyph and a thin primary ring, composer with a
primary ring and mask placeholder, header chips (Verified · countdown ·
strict). The pattern is optional per user (plain gradient fallback for
high-contrast / reduced-visual-noise).

## Message anatomy

- Read receipt `check-check` icon — bottom-right inside own bubble
- Timestamp — beside receipt, `micro` size
- Date separators — centered pill `September 14` between message groups
- Private bubble: mask glyph in the meta row (never colour-only); a
  view-once message shows a `view once` chip; manual burn of any private
  message through its long-press / context menu "Burn" (misclick guard:
  confirm)
- Tag copy — `copy` icon + accent-colored underlined tag; "copied" tooltip
