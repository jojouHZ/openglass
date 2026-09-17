# Component Rulebook

Every reusable UI element — anatomy, states, spacing. Penpot components
and frontend components mirror this spec 1:1. Tokens: `design-tokens.md`.

## Naming

`ui/<name>` in Penpot ↔ `<UiName>` in code. States listed exhaustively —
if a state isn't here, it doesn't exist.

## Text styles

| Style | Size/Weight | Color | Usage |
|-------|------------|-------|-------|
| `display` | 24/700 | ink | screen titles (Sign in, Create profile) |
| `title` | 15/600 | ink | header names, list names |
| `body` | 13/400 | ink | message text, menu rows |
| `secondary` | 12/400 | muted | previews, descriptions |
| `label` | 10/400 caps | muted | field labels, section headers |
| `caption` | 10/400 | muted | timestamps, hints |
| `meta` | 9/400 | muted/#c4c4c4 | in-bubble time + receipt |
| `link` | 13/400 | accent + underline | user tag, tappable refs |

## Alignment rules

- Screen-edge margin: 24px everywhere.
- Centered blocks (avatar, name, tag, caption on profile screens):
  optical center = 195 on 390 canvas — no hand-tuned x.
- Button labels always centered in their rect.
- Input placeholders and field text: left + 16px inside the field.
- Header title block: left-aligned next to avatar, never centered.
- Status-bar time: left 24px; header icons: right 24px.

---

## ui/status-bar

Height 44 · `soft` fill · time left (24px inset) · icons right.
States: `public` (soft bg, ink text) / `private` (ink bg, white text).

## ui/header

Height 76 · `bg` fill · 1px `line` bottom border.
Slots: `[back ‹][avatar 44][title block][actions right]`.
Title block: name 15/600 + subtitle 11/400 `muted`.
Private variant: `ink` fill, white text, countdown + `verified` chip,
BURN button right.

## ui/button

Height 52 · radius 8 · text 14.
Variants:
- `primary` — `ink` fill, white text
- `secondary` — transparent, 1px `line` border, `body` text
- `danger` — transparent, 1px `danger` border, `danger` text
- `ghost` — text only, `muted`
States: default / pressed (90% opacity) / disabled (40%).

## ui/input

Height 52 · radius 8 · 1.5px `line` border · text 14 inside.
Label above: `label` size, uppercase, `muted`, 8px gap.
Focused: border `accent`. Error: border `danger` + error text 11 below.

## ui/message-bubble

Max width 60% of screen · radius 16 · padding 14/12.
Anatomy: `[text 13]` + `[timestamp + receipt]` bottom-right inline.
Variants:
- `incoming` — `bubble-in` fill, `ink` text, left-aligned
- `own` — `ink` fill, white text, right-aligned, `✓✓` after timestamp
- `private-in` — `#3c3c43` fill, white text, `🔥` icon top-left
- `private-own` — `line` fill, `ink` text, `🔥` top-left
- `attachment` — bordered card (1px `line`), icon + name + size
Burn interaction: single tap → hint tooltip; long-press 1–2 s → burn.

## ui/date-separator

Pill 110×26 · `soft` fill · text 10 `muted` centered · e.g. "Sep 14".
Sits between message groups, 16px vertical margins.

## ui/chat-item

Height 72 · slots: `[avatar 52][name+preview][time+badge]`.
Name 14/600 + flags (📌 🔕 verified chip) · preview 12 `muted` ·
unread badge: `ink` circle 24, white count · divider 1px `line` bottom
(indented 16px from right edge).

## ui/system-card

Width 342 · radius 16 · 1.5px `body` border · `bg` fill.
In-chat cards (invite, setup, session markers). Header line `ink`,
body text `muted`, action row bottom (primary + secondary buttons).
Padding 20.

## ui/chip

Height 26 · radius 13 · 1px `line` border · text 10.
Variants: `unverified` (line border, muted), `verified` (`accent`
border + text), `tag` (accent text, ⧉ icon, underline on tag part).

## ui/context-menu

Action sheet on message long-press. Width 280 · radius 16 · `bg` fill ·
shadow. Items: 44px rows, text 13, icon left. Destructive item (`delete`,
`burn`) in `danger` color. Divider 1px between items.
Contents: reply / copy / edit / pin / delete (+ `🔥 burn` in private mode).

## ui/folder-tab

Height 32 · radius 16 · text 11. Active: `ink` fill + white text.
Inactive: transparent + 1px `line` border.

## ui/bottom-nav

Height 80 · `soft` fill · 3 slots 64×44, radius 10, `line` border.
Icons + labels. Active slot: `ink` border.

## ui/search-bar

Height 48 · radius 24 · 1px `line` border · 🔍 + placeholder `muted`.

## Rules

1. All spacing multiples of 8; margins 24px screen-edge.
2. Private mode inverts surfaces only — layout identical.
3. Every interactive element has pressed/disabled states defined.
4. Destructive actions always `danger` + confirmation.
5. No emoji-as-icon in production UI — placeholders only in alpha;
   icon set TBD at hi-fi polish.
