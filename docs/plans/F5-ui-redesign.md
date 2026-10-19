# Slice F5 — UI Redesign Pass (LAST)

Goal: replace the hand-rolled visual surface with a disciplined design
system. **Decided foundation: shadcn-vue + Reka UI** — owned
copy-paste components (MIT), Radix-port primitives, Tailwind v4
compatible, strict business aesthetic out of the box. Visual
references remain Telegram (information density) and
`stream-chat-vue`/`stream-chat-css` (chat-component structure — no
code, no dependency).

Rejected alternatives: daisyUI (weak overlay primitives), PrimeVue
(heavy, opinionated behavior), advanced-chat (RC + owns behavior —
duplicates our logic), Naive UI/Vuetify (non-Tailwind style systems).

## Why a dedicated slice

F3 was a polish pass on the existing token system — it fixed defects,
it did not redesign. The owner rates the visual surface as the weakest
part of the product (button placement especially).

## Execution model (owner decision)

- **Branch `f5-ui-redesign`** off `main` — all work lands there,
  never on main.
- Sequential milestones pushed to the branch; CI runs per push.
- **Manual test gate**: owner reviews the running app, then gives an
  explicit merge command — no merge without it.
- If F1/F2/F4 land on main while F5 is in flight, the branch is
  rebased before the manual gate so the redesign covers their
  screens too.

## What shadcn-vue + Reka UI buys us

- **Correct overlay primitives** — Dialog, Sheet, Popover,
  DropdownMenu, ContextMenu powered by floating-ui: the B6/B9 class
  of bugs (detached menu, off-viewport sheet) is solved at the
  primitive level, not patched per screen.
- **a11y by default** — focus trap, ARIA, keyboard nav, focus rings.
- **Owned code** — components are copied into the repo, not imported
  from a package; zero lock-in, matches the "no stubs, owned code"
  principle.
- **Strict business look** — shadcn defaults are Linear/Vercel-style
  minimalism; our token layer maps onto its CSS-variable theming.

## Scope

### 1. Design tokens v2 (`apps/pwa/src/styles/tokens.css`)

- Adopt the shadcn CSS-variable model (`--background`,
  `--foreground`, `--primary`, `--muted`, `--border`, `--ring`,
  `--destructive`, `--radius`) mapped onto our semantic names so
  existing utilities keep resolving.
- Keep or retire the Source Code Pro mono identity — owner decision
  at slice start (mono = brand quirk vs readability).
- Elevation tokens (shadows) — currently absent.
- **Theme layering**: `light`, `dark`, `private` as peer themes via
  CSS vars — `.private-mode` stops being a special snowflake.

### 2. Primitive replacement (Reka/shadcn first)

In priority order — these are the components that hurt:

| Current | Replacement |
|---|---|
| `MessageMenu.vue` (manual clamp) | `ContextMenu` + `DropdownMenu` |
| Member rights sheet (S9a) | `Sheet` (bottom/side variants) |
| `ConfirmDialog` | `AlertDialog` |
| Private setup modal (F2) | `Dialog` |
| Tabs/folder strip | `Tabs` |
| Toggles (strict, view-once) | `Switch` |
| Toasts/errors | `Sonner`-style toast (if in scope) |

### 3. Canonical chat inventory (stream-chat structure)

One component per role — ChannelList/Item, ChannelHeader,
MessageList + Message (sequence grouping, avatar-trail, meta row),
Composer, DateSeparator, TypingIndicator — screens compose, never
reimplement. Grouping rules: consecutive same-sender collapse,
meta on last-of-group, ~5min gap threshold.

### 4. Interaction & a11y pass

- Touch targets ≥44px, keyboard-only navigation S4→S5→menu.
- Motion: 150–200ms transitions on sheets/menus/hover.
- Skeleton loading + designed empty states (no chats/contacts/
  messages) — per component, not per screen.

### 5. Screens sweep

S1–S14 + private surface against the new inventory — kill one-off
styles and dead visual variants. **Button placement audit** is a
named requirement (owner flagged it specifically).

## Explicitly out of scope

- No new features — restyle only what exists.
- No stream-chat/shadcn runtime dependency — components live in-repo.
- Private-layer crypto/state untouched (theme only).
- Dark theme ships via token layering if cheap; otherwise post-MVP.

## Verification

- Visual checklist per screen (owner review, 3-browser pass).
- All existing tests stay green — testids are the contract.
- `check-mvp-bundle`, typecheck, build, E2E.
- a11y spot-check: keyboard-only navigation through S4→S5→menu.
