# Component Rulebook

Every reusable UI element — anatomy, states, spacing. Penpot components
and frontend components mirror this spec 1:1. Tokens: `design-tokens.md`.
Penpot locations and file links: `ui-kit.md`.

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

All Source Code Pro, regular 400 — weight-flat system (emphasis via size,
caps, color). See `design-tokens.md` for the canonical scale:

| Style | Size | Color | Usage |
|-------|------|-------|-------|
| `screen-title` | 24 | ink | screen titles |
| `header` | 18–20 | ink | list & chat headers, nav glyphs |
| `name` | 15 | ink | chat names, profile head, header title |
| `body` | 14 | ink | buttons, inputs, row labels |
| `msg` | 13 | ink | bubble text, previews, menus |
| `meta` | 12 | muted | member meta, captions |
| `sub` | 11 | muted | subtitles, tooltips, tabs |
| `sender` | 10 | accent | group sender, labels, chips, badges |
| `micro` | 9 | muted | in-bubble time, receipts |
| `link` | 13 | accent + underline | user tag, tappable refs |

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
Slots: `[back ← left 16][title+subtitle centered][avatar 40 right]`
with `ellipsis-vertical` centered below the title block.
Title 15 · subtitle 11 `muted`.
Private variant: `ink` fill, white text — contact `name` +
`venetian-mask` icon centered (no "private" prefix); `VERIFIED` chip
centered below the name; `ttl` chip + `flame` burn action on the right.

## ui/msg-bubble — internal grid

Every bubble is a vertical stack `header? / body / footer`, plus a
`reaction tray` rendered OUTSIDE the bubble on its bottom edge.
See `mol bubble-layout` diagram on `04 · Molecules`.

```
bubble:     radius 16 · fill bubble-in (no border; states add ring)
            padding: 12 sides · 8 top · 8 bottom
header row  h24 (group chats only), top-inset 8:
  [name tray    sender 10 accent, auto-width] gap 6
  [chip tray    role chip 9 muted, auto-width]  → privacy pins right
  [privacy tray 36w, lucide icon 16, right-inset 12]
body:       msg 13 ink · gap 8 below header / above footer
footer row  h22, anchored bottom-right, bottom-inset 8:
  [time tray    micro 9 muted, auto-width] gap 4
  [state tray   28w, lucide icon 14, right-inset 12 — ICONS ONLY:
                ✓ sent · ✓✓ read · error · spinner]
reaction:   h20 · hangs on bubble bottom edge (−1 overlap),
            inset +12 from pad edge · own side mirrors right
```

Trays are auto-width except `privacy` (36) and `state` (28) — fixed
slots that never resize the bubble or shift neighbors.

The state tray is a fixed-width slot — it never shifts neighbors or
resizes the bubble.

## ui/msg-group

Consecutive same-sender messages form a series:
- Sender name sits INSIDE the FIRST bubble of the series, top line,
  10px `accent` (per-sender tint, optional role chip e.g. `admin`).
  Group chats only — 1:1 bubbles carry no name.
- `avatar 28` sits OUTSIDE the bubble, bottom corner of the LAST
  bubble of the series: left for incoming, right for own. Never next
  to every bubble.
- Every bubble: `[time][status icon]` bottom-right.
- Alignment: mobile = own bubbles right (24 inset), others left;
  desktop = ALL bubbles left-aligned.

## ui/member-row

Group-management row: `avatar 44` + name 13/600 + rights summary 11
`muted` + `rights` chip (58×28, radius 6) + `✕` remove at right.
Row height ~60, dividers optional.

## ui/avatar

Sizes per context: `24` group message sender · `28` member rows, picks,
mentions · `52` chat list item · `64` contact detail / profile head.
Fill `soft`/`#dedede` placeholder until image support.
Presence dot: 9px `accent`, 1.5px white halo, absolute `right:0
bottom:0` of avatar — never standalone.
Verified ring: +2px `accent` stroke — device-pair verified contacts only.

## Primitives

`nav-back` — `arrow-left` 20px icon, top-left of every sub-screen
(x24 y~70); hit area 44.
`screen-title` — `screen-title` style, left 24px (Sign in, Security…).
`field-label` — `sender` caps 10 style above inputs/sections.
`otp-cell` — 48×60 radius-8 box + digit 20.
`checkbox` — 28×28 radius-6, `ink` fill + `check` icon when checked.
`switch` — 52×28 pill + 24 knob; privacy toggle in chat header.
`preset-chip` — 95×40 radius-8 option (lifetime presets).
`verify-option` — 298×36 radius-8 row (verification methods).
`tooltip` — 136×30 pill `ink`, white caption (copied).
`radio-pick` — 20px ring 1.5 `body`, inner dot 10 `ink` when on.
`icon-button` — icon 20 (stroke 1.25) inside min 44×44 touch target.
`send-button` — 48 circle `ink` fill, white `arrow-up` 20; `accent`
state when composing.
`divider` — 1px `line`; full-bleed between sections, inset 68px in chat
lists.
`unread badge` — h18 min-w18 `ink` pill, mono 9 white count, caps at
`99+`; muted chats: `line` fill.
`receipts` — 14px icons in own bubble right of time: `check` sent ·
`check-check` muted delivered · `check-check` accent read.
`typing` — three 5px dots gap 4, pulse; replaces preview text in list.
`progress-ring` — 24px, `soft` track + `danger` arc; burn hold 1–2s.
`status dot` — 9px `accent` online / `muted` offline.

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
`member-row` — avatar 28 + name 15 + post/rights 11 muted · role
chips right (OWNER accent / invite·edit·pin·kick muted /
none = member) ·
`invited` pending state · `✕` on owner view.
`prompt-card` — grouped card content on S15 (install/notif/offline).
`otp-row` — 6 × `otp-cell` 48×60, gap 8 (auth flows).
`empty-state` — centered stack: icon in 56 `soft` circle + title
15 + hint 11 `muted` + `sm-primary` CTA (empty lists, no-results).
`composer` — 390×88: attach icon-btn inside left of pill r18 +
input flex + send 48 `ink` circle outside; reply/attach strips
slide above the pill.
`reply-strip` — 342×40, r8, 1px `line`: accent bar 3 + name 9 +
preview 10 ellipsis + `✕`; sits above composer.
`attach-strip` — 342×44, staged-attachment chips 32h r8:
name+size 10 + `✕`; horizontal scroll past 2 chips.
`ttl-picker` — iOS timer-style wheel picker (`hours | min` drums,
342×180, ink surface, selected row = soft band, neighbors fade
.5/.25). Default **10 min** on first private chat with a contact;
min 1m, max 24h; last selection remembered locally. Preset chips
may sit below for quick picks.

## ui/button

Height 52 · radius 8 · text 14.
Variants:
- `primary` — `ink` fill, white text
- `secondary` — transparent, 1.5px `body` border, `ink` text
- `danger` — transparent, 1px `danger` border, `danger` text
- `ghost` — text only, 51×17 hug, `ink`/accent on hover
- `sm` — 145×44 pair (primary + secondary, gap 12) for
  cards/sheets; stacks vertically below 320px
States: default / pressed (opacity .88) / disabled (opacity .4).

## ui/input

Height 52 · radius 8 · 1.5px `line` border · text 14 inside.
Label above: `label` size, uppercase, `muted`, 8px gap.
Focused: border-strong `body`. Error: `danger` border + error text
11 below. Icon slot left 20px when used as search.

## ui/otp-row

6 × `otp-cell` 48×60 · gap 8 · r8 · 1px `line`.
Focus: 1.5px `body` border. Filled: `ink` 20 text.
Error: all cells `danger` border. Auto-advance on type, paste
splits into cells. Used in: email code, device-pairing code.

## ui/message-bubble

Max width 60% of screen · radius 16 · padding 14/12.
Anatomy: `[text 13]` + `[timestamp + receipt]` bottom-right inline.
Variants:
- `incoming` — `bubble-in` fill, `ink` text, left-aligned
- `own` — `ink` fill, white text, right-aligned, `✓✓` after timestamp
- `private-in` — `#3c3c43` fill, white text, `venetian-mask` 16
  in reserved top-right slot (private marker — not flame; flame is
  burn action only)
- `private-own` — `line` fill, `ink` text, same top-right mask slot
- `attachment` — bordered card (1px `line`), icon + name + size
Burn interaction: single tap → hint tooltip; long-press 1–2 s → burn.

States (any variant):
- `reply` — quote strip 30h on top: 2px `accent` bar + name 9
  `accent` + text 10 `muted`
- `edited` — `edited ·` marker before timestamp inside bubble, 9 muted
- `failed` — 1.5px `danger` border + `! failed · retry`; tap resends
- `selected` — 1.5px `accent` ring (multi-select mode)
- `sending` — opacity .6, spinner replaces receipt

Meta slot (all bubbles): bottom-right corner reserves a fixed
`[time][icon]` zone — icon slot 16px wide at inset 12/10 is always
reserved for receipts / pending / warning icons (Lucide `check`,
`check-check`, `timer`), and the timestamp sits immediately left of
the slot even when no icon is shown. Private bubbles additionally
reserve a symmetric 16px slot in the top-right corner (inset 12/10)
for the `venetian-mask` privacy marker.

**Status slot = icons only.** The slot renders `check` (sent),
`check-check` (read), `circle-alert` (failed) or `loader` (sending)
— never text, so the slot never shifts neighbors or breaks layout.
A message visible inside an open chat is by definition delivered
and read — every bubble (incoming, own, private) shows its status
icon. Failed messages show `[time][alert icon]`; tap opens the
error tooltip (below).

**Slot-icon tooltips** (molecules → `mol tooltips`):
- mask icon → burn tip: filled flame + "hold to burn"; press-and-hold
  on the flame deletes/burns the message
- receipts in group chats → compact tooltip (width hugs content)
  with per-member status rows: `check-check` accent = read,
  `check` = delivered, `clock` = pending; with >4 members a
  "show all →" row opens a modal listing everyone
  (read / delivered / pending)
- receipts in 1:1 chats → no tooltip
- alert icon → "failed to send — <reason>" tooltip with `retry`
  action; tapping retry resends
- link/tag tap → "copied" tooltip; edited mark → "edited at hh:mm"

## ui/date-separator

Pill 110×26 · `soft` fill · text 10 `muted` centered · e.g. "Sep 14".
Sits between message groups, 16px vertical margins.

## ui/chat-item

Height 72 · slots: `[avatar 52][name+preview][time+badge]`.
Name 15 `name` + flags (`pin`, `bell-off`, chips per taxonomy) ·
preview 12 `meta` `muted` **italic** ·
unread badge: `ink` circle 24, white count · divider 1px `line` bottom
(indented 16px from right edge).
States: `unread` badge right 18 · `muted` icon · `typing` = accent
preview replacing text · `selected`/active = `soft` bg fill.

## ui/system-card

Width 342 · radius 16 · 1.5px `body` border · `bg` fill.
In-chat cards (invite, setup, session markers). Header line `ink`,
body text `muted`, action row bottom (primary + secondary buttons).
Padding 20.

## ui/chip — taxonomy

Sizes by context: `xs` 18h / 9px — under-name rows (chat list, chat
header) · `sm` 22h / 10px — contact detail, member rows · `md` 26h /
10px — standalone, filters · `lg` 32h — folder tabs.
Radius: half-height pill. Gap between chips: 4.

| Kind | Style | Used in |
|------|-------|---------|
| `system-verified` | `accent` bg, white caps | private header, contact detail, chat list |
| `system-private` | `ink` bg, white caps + `lock` | chat list, chat header |
| `system-unverified` | `soft` bg, muted text | pairing flow, private invite |
| `role-owner` | `OWNER` text, muted pill | group member rows, group header |
| `role-delegated` | short perm name (`invite`/`edit`/`pin`/`kick`), muted pill | members with granted perms |
| `tag-custom` | `soft` bg, `ink` text — user labels | chat list under name, contact labels |
| `state-muted` | `line` bg, muted text | chat list, group settings |
| `ttl` | `line` bg, mono countdown | private header only |
| `folder-tab` | active `ink`/white · inactive `line` border | chat grouping bar |

### Placement rules

- **Chat list row** — chips on 2nd line under name, left of preview;
  order: system → tag; max 2 visible + `+N` overflow; size `xs`.
- **Chat header** — under name next to subtitle; system chips only
  (PRIVATE / VERIFIED); size `xs`.
- **Private header** — VERIFIED + ttl inside header cluster; replaces
  subtitle.
- **Contact detail** — own “LABELS” section row; wrap allowed; order:
  system → role → custom; size `sm`.
- **Member / group rows** — role chip right-aligned at row end; `sm`.
- **Folder bar** — folder-tabs row above chat list, horizontal scroll;
  active = `ink` fill.
- **Global** — system chips always first; never two chip rows inside
  list contexts; custom tags keep user order.

## ui/context-menu

Action sheet on message long-press. Width 280 · radius 16 · `bg` fill ·
shadow. Items: 44px rows, text 13, icon left. Destructive item (`delete`,
`burn`) in `danger` color. Divider 1px between items.
Contents: reply / copy / edit / pin / delete (+ `burn` in private
mode) — Lucide `reply`, `copy`, `pencil`, `pin`, `trash-2` icons.

## ui/folder-tab

Height 32 · radius 16 · text 11. Active: `ink` fill + white text.
Inactive: transparent + 1px `line` border.

## ui/bottom-nav

Height 80 · `bg` fill, 1px `line` top. 5 zones 78px: chats
(`message-square`), calls (`phone`), contacts (`users`), private
(`venetian-mask`), settings (`settings`). Lucide 20px icons; active
tab = `ink` icon + 4px dot under icon, inactive = `muted`.
Private mode: nav hidden — no cross-mode navigation.

## ui/search-bar

Height 48 · radius 24 · `soft` fill · Lucide `search` 16px +
placeholder `muted`.
Clear `x` icon appears when filled · sticky at top of list contexts.

## ui/composer

390×88 · pill radius 18, 1px `line`, horizontal padding 12.
`paperclip` attach icon-btn 36 inside left · input `flex:1` ·
send button 48 `ink` circle outside the bar.
`reply-strip` and `attach-strip` slide in above the pill.
Safe-area bottom padding applies to the wrapper, not the pill.
Private mode: `bg-private` pill + `flame` icon + `ttl` chip.

## Organisms (05)

Full-width screen regions; fixed heights; anchored top or bottom.

- `folder-bar` — 390×44 under `header-list`, h-scroll. System folders
  first (`all`/`private`/`groups`), custom user folders after,
  `+ new` ghost chip creates a folder. Active = `ink` fill.
- `chat-list` — column of `chat-item` 72h; separator = `line` inset-68
  atom; sticky date/folder headers inside scroll.
- `member-list` — section label 10 muted + `member-row` 44h; name
  only (no caption line) — role shown via chip only: `OWNER` /
  `invite`/`edit`/`pin`/`kick` 22h pill, plain member = no chip;
  `x` remove visible to owner only.
- `settings-section` — caps label + `settings-row` 39h; groups
  separated by 24px + label; danger rows = `danger` text.
- `message-day-group` — `date-separator` sticky + bubble cluster:
  incoming left 24, own right 24; same-sender gap 4, switch 12.
- `composer-stack` — `reply-strip`/`attach-strip` slide above
  `composer`; only one strip at once; strip `x` cancels.
- `invite-sheet` — private-session bottom sheet r16, ink surface:
  grabber, title, `ttl-picker` wheels + preset chips,
  `accept` (white fill) / `decline` (ghost) actions.

## Rules

1. All spacing multiples of 8; margins 24px screen-edge.
2. Private mode inverts surfaces only — layout identical.
3. Every interactive element has pressed/disabled states defined.
4. Destructive actions always `danger` + confirmation.
5. No emoji-as-icon in production UI — icon set is **Lucide**, 20px
   base / 16px inline, stroke 1.25, round caps; `flame` is the only
   filled icon (`#e03131` + `ink` stroke). Emoji placeholders in
   components are migrated per the mapping in `design-tokens.md`.
