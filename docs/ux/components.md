# Component Rulebook

Every reusable UI element — anatomy, states, spacing. Penpot components
and frontend components mirror this spec 1:1. Tokens: `design-tokens.md`.

## Sizing contract (adopted from exyte/chat, radii ours)

```
message row:   edge→bubble 12px · text pad 12h/8v · avatar↔bubble 6px
               opposite inset 70px · avatar only on last of user group
               gap 4px in-group / 8px between groups
reply:         2px capsule accent bar + quoted text 12 muted, reduced opacity
receipt/time:  inside bubble bottom-right; own status icon may sit outside
composer:      bar minHeight 48, radius 18 · send = 48 circle OUTSIDE bar
               attach button 36 inside-left · horizontal margin 12
attachment:    card ~200×92, radius 14, hairline border
radius:        bubbles 14 · cards 10-14 · pills 22 · (not exyte's 20+)
```

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
- Header title+subtitle: centered on canvas; avatar on the right.
- Status-bar time: left 24px; header icons: right 24px.

---

## ui/status-bar

Height 44 · `soft` fill · time left (24px inset) · icons right.
States: `public` (soft bg, ink text) / `private` (ink bg, white text).

## ui/header

Height 76 · `bg` fill · 1px `line` bottom border.
Slots: `[back ‹ left 16][title+subtitle centered][avatar 44 right 15]`
with `⋯` centered under the subtitle.
Title 15/600 · subtitle 11/400 `muted`.
Private variant: `ink` fill, white text, countdown + `verified` chip,
BURN button right.

## ui/msg-group

Group incoming message: `avatar-sm 28` left + sender name 10 `muted`
above an `incoming` bubble (indent 36 from avatar edge).

## ui/member-row

Group-management row: `avatar 44` + name 13/600 + rights summary 11
`muted` + `rights` chip (58×28, radius 6) + `✕` remove at right.
Row height ~60, dividers optional.

## ui/avatar

`avatar-sm` 28 · `avatar-md` 44 · `avatar-lg` 96–100.
Fill `soft`/`#dedede` placeholder until image support.

## Primitives

`nav-back` — `←` 20px, top-left of every sub-screen (x24 y~70).
`screen-title` — display style, left 24px (Sign in, Security…).
`field-label` — `label` style above inputs/sections (INVITE CODE…).
`otp-cell` — 48×60 radius-8 box + digit 20/600.
`checkbox` — 28×28 radius-6, `ink` fill + white ✓ when checked.
`switch` — 52×28 pill + 20 knob; privacy toggle in chat header.
`preset-chip` — 95×40 radius-8 option (lifetime presets).
`verify-option` — 298×36 radius-8 row (verification methods).
`tooltip` — 136×30 pill `ink`, white caption (copied ✓).

## Composites

`header-list` — chat-list header: avatar-md + title + `+` button.
`header-private` — private-mode header: `ink` fill, title +
countdown + verified + BURN button.
`profile-head` — avatar-md + name + tag link (settings/profile).
`member-pick` — avatar-md + name, used with checkbox (group create).
`msg-attachment` — 190×96 radius-12 card: 📎 name + size + time.
`system-card` — 342-wide radius-16 `body`-bordered in-chat card.
`session-row` — 342×60: device + meta + revoke (security screen).
`settings-row` — label + `›` + divider, 56px pitch.
`member-row` — avatar + name + rights + chip + ✕ (group manage).
`prompt-card` — grouped card content on S15 (install/notif/offline).

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
