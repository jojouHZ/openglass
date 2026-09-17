# Design Tokens

Single source of truth for OpenGlass visual language. Every value here maps
to a `tailwind.config` key. Adjust here → regenerate.

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
| `danger` | `#b00000` | Destructive text (report, burn confirm) |

## Typography

Font: **Source Code Pro** (monospace — deliberate brutalist/technical feel).

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `display` | 28 | 600 | Screen titles (Sign in) |
| `title` | 20 | 600 | Section titles (Chats) |
| `name` | 15 | 600 | Contact/chat names |
| `body` | 14 | 400 | Body text |
| `msg` | 13 | 400 | Message bubbles |
| `meta` | 11-12 | 400 | Previews, captions |
| `label` | 10-11 | 400 | Field labels (uppercase), annotations |
| `chip` | 9-10 | 400 | Chips, badges |

## Radius

| Token | Value | Usage |
|-------|-------|-------|
| `r-card` | 16 | In-chat system cards, modals |
| `r-bubble` | 16 | Message bubbles |
| `r-input` | 8 | Text fields, buttons |
| `r-pill` | 24-32 | Composer, chips, toggles |
| `r-logo` | 6 | Logo badge |

## Spacing

8pt grid. Screen margins: **24px**. Component gaps: 8/16/24.

## Strokes

| Token | Value | Usage |
|-------|-------|-------|
| `border` | 1px `line` | Dividers, default borders |
| `border-strong` | 1.5px `line`/`body` | Inputs, in-chat cards |

## Screen

Mobile: **390×844** (iPhone 14 class). Safe areas: `env(safe-area-inset-*)`.

## Private-mode overrides

Private mode inverts: `bg` → `#0e0e10`, incoming bubble → `#3c3c43`,
outgoing → `#c4c4c4`, text → `#ffffff`. Lock icon + countdown in header.
