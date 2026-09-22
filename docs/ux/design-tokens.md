# Design Tokens

Single source of truth for OpenGlass visual language. Every value here maps
to a `tailwind.config` key. Adjust here → regenerate.
Penpot file map and links: `ui-kit.md`.

## Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `ink` | `#181818` | Primary text, primary button fill, private-mode surfaces |
| `body` | `#3c3c43` | Secondary text, icons, private incoming bubbles |
| `muted` | `#666666` | Captions, placeholders, timestamps, meta |
| `line` | `#c4c4c4` | Borders, dividers, outgoing private bubble fill |
| `soft` | `#dedede` | Incoming bubbles, status bar, selected states |
| `bg` | `#ffffff` | Public-layer background |
| `bg-private` | `#0e0e10` | Private-mode background |
| `accent` | `#3d6b99` | Links, verified chip, copy affordances, active states |
| `bubble-own` | `#181818` | Own public message (white text) |
| `bubble-in` | `#f1f1f4` | Incoming public message (ink text) |
| `danger` | `#b00000` | Destructive text (report, burn confirm) |
| `canvas` | `#f8f8f8` | Kit canvas, alt screen background |

## Typography

Font: **Source Code Pro** only (monospace — deliberate brutalist/technical
feel). Weight-flat system: everything is regular 400; emphasis comes from
size, caps and color (`accent`/`muted`), never bold.
Fallback stack: `ui-monospace, monospace`.

| Token | Size | Usage |
|-------|------|-------|
| `screen-title` | 24 | Screen titles (auth, setup) |
| `header` | 18–20 | List & chat headers, nav glyphs |
| `name` | 15 | Chat names, profile head, header title |
| `body` | 14 | Buttons, inputs, row labels, settings |
| `msg` | 13 | Bubble text, list previews, status-bar, menus |
| `meta` | 12 | Member meta, attachment size, captions |
| `sub` | 11 | Header subtitles, tooltips, folder tabs |
| `sender` | 10 | Group sender name (accent), field labels, chips, badges, date-sep |
| `micro` | 9 | In-bubble time, read receipts |

## Iconography

Pack: **Lucide** (lucide.dev, ISC license — compatible with AGPL).
Style: 24px grid geometry, **stroke 1.25px**, round caps & joins,
stroke-only (no fills) — lighter than the 2px stock weight to match the
mono voice.
Sizes: `16` inline/meta · `20` UI default (base size).
Color: inherits the text token of its context.
Exception: `flame` (burn/TTL) is the only filled icon — bright red
`#e03131` fill + `ink` stroke. Burn is a critical destructive action and
must be immediately visible.

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
| 🔒 | `lock` | Private mode |
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

Private mode inverts: `bg` → `#0e0e10`, incoming bubble → `#3c3c43`,
outgoing → `#c4c4c4`, text → `#ffffff`. `lock` icon + countdown in header.

## Message anatomy

- Read receipt `check-check` icon — bottom-right inside own bubble
- Timestamp — beside receipt, `micro` size
- Date separators — centered pill `September 14` between message groups
- Private burn `flame` icon — top-left corner of private bubble;
  **long-press 1–2 s** to burn (misclick guard), progress ring on hold
- Tag copy — `copy` icon + accent-colored underlined tag; "copied" tooltip
