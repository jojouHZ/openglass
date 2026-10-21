# Slice F5 — UI Redesign (concept 07 "Slate Tabs")

Goal: bring the product to the approved visual concept —
`docs/ux/concept-07/` (open `index.html`; generator + data in the same
folder; ten exploration variants in `docs/ux/mockups-f5/`). Foundation:
**shadcn-vue + Reka UI** (owned copy-paste components, floating-ui
overlays, a11y defaults); stream-chat is a structure reference only.

## Execution model (owner decision)
- Branch `f5-ui-redesign`, **never pushed and never merged without an
  explicit owner command**; all verification (unit, typecheck, build,
  bundle guard, E2E) runs locally; the owner does a manual test gate,
  then compares old vs new UI, then merges on command.
- Rebased onto `main` after F1/F4 land so the redesign covers their
  screens.
- Milestones M1 (foundation) and M2 (Reka primitives: ConfirmDialog,
  MessageMenu, Sheet, Switch) are done on the branch.

## Slice order (decided)
`F1 contacts → F4 stubs (main)` → `F5 core (M3–M5)` → `F7 device identity`
→ `F5-M6 private pane (= F2, in the new design)` → `M7 sweep` → `M8 gate`.
Desktop split view is a separate later slice (F6).

## Decisions embedded in the concept
- **Palette**: four modes — Light, Dark, Private-on-light, Private-on-dark;
  slate base, one blue primary, violet reserved for the private layer;
  every pair AA-checked (`docs/ux/design-tokens.md`, `palette.mjs`).
- **Typography**: Inter for UI/messages, Source Code Pro for headings and
  identifiers; weights 400–700.
- **Navigation**: bottom tab bar (Chats · Contacts · Settings) on root
  screens only, hidden in chats and sub-screens; tab badges (unread,
  pending contact requests). Settings root shows the bar.
- **Dark theme** ships (Settings → Appearance: Light / Dark / System);
  private mode is hue + mask glyph + pattern + ringed composer in both.
- **Identity cues**: avatars coloured by tag hash; chat-list `private`
  chip and Contacts shield from device pins (dev PWA only).
- **Mask = private layer; lock = encryption/verification status.**

## Milestones
| # | Scope |
|---|-------|
| M1 ✅ | shadcn stack, fonts, token aliases |
| M2 ✅ | Reka primitives: ConfirmDialog, MessageMenu, Sheet, Switch |
| M3 | Tokens v3 (four modes as CSS variables), theme store + Appearance setting + `theme-color` meta, Avatar (hash colour), Chip, contrast + hue tests |
| M4 | App shell + tab bar (route meta `nav`), Contacts root (requests / sent / contacts — needs F1), Settings root restyle |
| M5 | Chat list rows, chat view: header, bubbles (tail style), grouping, pinned bar, attachments (photo/file cards), reply quote, typing, composer |
| M6 | Private pane + sheet + lock/switch states (= F2 plan, after F7) |
| M7 | Remaining screens (S1–S3, S7–S9a, S14, S15), motion, a11y pass, empty/loading/error states |
| M8 | Local gate: unit, typecheck, build, bundle guard, E2E, concept-vs-app side-by-side review, owner manual test |

## Out of scope
- No new features beyond the concept (F1/F7/F2 carry the logic).
- Desktop split view (F6), real chat folders, push.
- No runtime stream-chat dependency.

## Verification
- All existing testids stay the contract; E2E selectors updated only
  where flows change (F2).
- Automated contrast test over all four palettes; hue-distinctness test
  for private vs public tokens.
- Bundle guard: private palette, mask pattern and all private UI stay in
  the private chunk.
- Visual review: screenshots of key screens beside the matching concept
  frames (human comparison, not pixel diff).
