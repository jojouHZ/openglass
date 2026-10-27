# Slice F5 — UI Redesign (concept 07 "Slate Tabs")

Goal: bring the product to the approved visual concept —
`docs/ux/concept-07/` (open `index.html`; generator + data in the same
folder; ten exploration variants in `docs/ux/mockups-f5/`). Foundation:
**shadcn-vue + Reka UI** (owned copy-paste components, floating-ui
overlays, a11y defaults); stream-chat is a structure reference only.

## Execution model (owner decisions, revised)
- **New branch `f5-concept-07` from current `main`** (which already has
  F1.1/F1.2/F4: report dialog, archive chats, system lines). The old
  `f5-ui-redesign` branch (26 commits behind, local only) is retired:
  only its two design-agnostic commits are carried over —
  M1 `1fb96a4` (shadcn-vue + Reka stack, fonts, `cn`) and M2 `8f45671`
  (ConfirmDialog, MessageMenu, Sheet, Switch on Reka). A dry-run
  cherry-pick onto `main` applied with **zero conflicts**. Tokens v2 from
  M1 are replaced by tokens v3 as the first step of M3.
- The branch is **never pushed and never merged without an explicit owner
  command**; the full gate runs locally (unit ×3, typecheck, build, bundle
  guard, Go race/lint, real-Chromium E2E), then the owner's manual test,
  then old-vs-new comparison, then **one** merge into `main`. No
  half-redesigned UI ever lands on `main`.
- Rebase on `main` at the start of every milestone so drift stays tiny.
- Visual-only: no API/contract/store-semantics change, all `data-testid`s
  stay the contract.

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


## Implementation plan by role

### Product Manager
- Scope is the concept as approved, nothing more: four palettes, tab bar on
  root screens only, dark theme, private-mode treatment (same chat, mask
  glyph + pattern, lock until verified → switch after), vertical view-once
  toggle, tab badges. New features stay in their own slices (F7/F8/F9/F2).
- Acceptance per milestone = the matching concept frames side by side with
  the running app; the owner's manual test gates M8.
- Contacts becomes a real root tab (F1 data exists); desktop split (F6),
  chat folders, push stay out.

### PWA Shell Agent (main author)
- **M3** tokens v3 (four modes as CSS variables on `:root`, `.dark`,
  `.private`, `.dark.private`), theme store (Light/Dark/System, `og.theme`
  in localStorage), Appearance row in Settings, `theme-color` meta kept in
  sync, `Avatar` (colour from tag hash), `Chip` (verified / private /
  neutral / warning). Heading font Source Code Pro, everything else Inter.
- **M4** shell + tab bar driven by route meta `nav: true` (Chats ·
  Contacts · Settings; hidden in chat and sub-screens), badges from the
  existing stores (unread total, pending requests); Contacts root = the
  current S6 data re-laid-out (requests / sent / contacts / global
  search); Settings root restyle.
- **M5** chat list rows, chat view (header, tail bubbles, series, pinned
  bar, attachment cards, reply quote, typing, composer, system lines and
  tombstones restyled, frozen-chat banner).
- **M6 (after F7)** private pane: same window, mask glyph on private
  bubbles, palette switches on invite acceptance, lock before SAS /
  switch after, vertical view-once toggle (= F2 plan).
- **M7** remaining screens (S1–S3, S7–S9a, S14, S15), ReportDialog on
  Reka, motion with `prefers-reduced-motion`, empty/loading/error states,
  44 px targets, focus order, Esc behaviour, ARIA.

### Backend Agent
- No endpoint, schema or migration change. Duties: confirm that every
  value the concept shows is already served (unread counts, pins, member
  counts, contact relationship, `verifiedAt`, system events) — audited in
  the concept build; keep the contract tests green; answer questions
  about data shapes. Anything the design wants that the API cannot give is
  recorded as a follow-up slice, not improvised.

### Frontend Core Agent
- Theme store lives in the PWA (presentation); core stays UI-free.
- Selectors for the tab badges and avatar hash (pure functions, unit
  tested) — no new network calls.
- Guarantee that private cryptographic state never reaches the host:
  the redesign touches only snapshots (`PrivateRemote` boundary
  unchanged); the private palette/pattern are CSS inside the private chunk.

### Security Agent
- **Theme boot without inline script**: pre-paint theme application via a
  small external file (not an inline `<script>`), so a strict CSP stays
  possible; theme preference contains no secrets.
- **Bundle guard stays authoritative**: private palette, mask pattern and
  private UI must not appear in the production chunk (existing
  `verify:mvp-bundle` plus new markers for the mask/violet tokens).
- Private mode must be unmistakable (hue + glyph + pattern + ringed
  composer in all four modes) — a wrong-layer send is a privacy bug; no
  design choice may weaken the "lock = unverified" semantics.
- XSS posture unchanged and enforced: the sink-ban test covers every new
  component; no `v-html`/`innerHTML`; user text only via interpolation.
- Reduced-pattern option for accessibility must not hide the private cue.

### DevOps Agent
- Branch stays local, so CI cannot run before merge: a single `pnpm
  gate:f5` script replicates CI locally (Go race+lint incl. Postgres,
  typecheck, unit ×3, build, bundle guard, E2E) so the "green" claim is
  evidence, not hope. First real CI run happens on the merge commit —
  mitigated by the identical local gate and by rebasing on `main` right
  before the merge.
- Track bundle size per milestone (Tailwind + Reka + fonts): fail the gate
  on a regression beyond an agreed budget; fonts stay self-hosted.
- Dependabot: Reka/shadcn dependencies pinned to versions ≥ 7 days old.

### Testing Agent
- **Contrast**: a test over all four modes asserting every text/background
  pair from the concept (body, secondary, buttons, bubbles, chips, danger)
  meets AA (4.5:1; 3:1 for the recessed public bubbles) — fed from the
  shipped `tokens.css`, not a copy.
- **Hue distinctness**: private tokens differ from public in hue by a
  threshold in both light and dark (guards the "unmistakable" requirement).
- **Behaviour**: tab bar visible on root routes only; badges track store
  state; theme persistence and System mode; avatar colour stable per tag.
- **Regression net**: all existing view tests keep passing unchanged
  (testids are the contract); new async tests wait on conditions
  (`vi.waitFor`), never fixed delays; unit suite run three times in a row
  before every milestone commit.
- **E2E (real Chromium)**: existing five flows + report flow stay green;
  add tab-navigation, dark-theme toggle and a private-mode visual-state
  check (palette variables switch on invite acceptance).
- **Visual**: screenshots of key screens beside the concept frames for the
  owner's review (human comparison, not pixel diff); 3-browser manual test.

### Mutual tests
- **Security × PWA**: every milestone ends with a joint review — the
  PWA agent walks the Security agent through each new surface (what it
  renders, which store fields feed it); Security checks layer cues, bundle
  contents and sinks; PWA checks that nothing hardens at the cost of
  usability (targets, contrast, focus). Findings are fixed before the next
  milestone starts.
- **Testing × PWA**: testids frozen as a contract; any selector change must
  be listed and justified in the milestone commit.
