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

## Slice order (owner correction: private core and UX remain pre-MVP)
`F1/F4 → F5 M3–M5 → U1 mobile acceptance → V1 SAS design/O8
→ V2 F7 device verification → V3 M6/F2 same-window private UI/O10
→ U2 remaining M7 sweep → U3 M8 combined acceptance`.
R1 real OTP delivery and R2 deployment readiness remain required for production
operation and can be planned independently of private UI implementation.
Each slice requires owner review before advancing.

O8, F7 and O10 are explicitly NOT post-MVP. They are implemented and tested in
the shared private core and dev frontend; the release PWA still excludes private
artifacts. Do not confuse release-bundle contents with the project's MVP scope.
Only private browser lifecycle work and platform-specific local-storage features
are deferred here. Public PWA functionality and its existing storage remain in
scope. O9 stays open for Android lifecycle/core investigation; a browser-only root
cause is not established. Shared-core isolation or authentication defects found
later must be triaged on their merits, not automatically deferred as browser bugs.
The hidden-page teardown policy was not approved and must not be implemented.

The historical session/P0 plans below are superseded. F7 → M6 remains required.
Desktop split view stays a separate later slice (F6).

## V3 incremental evidence (2026-11-10)

The owner authorized continued local increments, with mass review and manual
acceptance before merge. V3.1 places device comparison inside the existing
chat: the lock opens an inline panel, users select a published device,
compare six objects and six digits, and independently confirm or reject.
Directory/save failures surface without exposing internal diagnostics;
device labels use escaped text. All access goes through PrivateRemote.
The panel is dynamically imported only in the private dev build.

Validation: two component tests, PWA 207/207, PWA typecheck, production build
and bundle guard passed. Real Chromium verifies both users complete the
in-chat ritual without leaving the chat URL, then pins survive reload and
a signed session works through the facade. This is not yet the complete
same-window private composer implementation. Legacy private-route E2E
migration and the full gate remain outstanding. No merge/deploy is implied.

### V3.2 — same-window private surface

The verified header switch now swaps public history/composer for a dev-only
private surface without changing chat URL. Public reply/edit/upload state
is cleared on layer changes; public send is guarded while private or in a
verification ritual. The private surface supports invitations, TTL/strict
choice, signed-session readiness, view-once sends, purge-on-exit and burn
confirmation. Its composer is disabled without verified keys, relay access
or contact consent. The live-session banner opens the in-chat layer.

Component tests cover private-only routing, view-once, purge-on-exit,
exchanging-key and removed-contact send gates. Real Chromium verifies
in-chat verification, layer switching, invitation/acceptance, encrypted
delivery and absence of the private test text in public message POSTs.
PWA 209/209, typecheck, production build and private-artifact bundle guard
passed. Legacy private UI E2E migration and whole-gate rerun remain pending;
this is implementation evidence, not owner manual acceptance or merge approval.

### V3.3 — migrated browser acceptance and local gate

Private UI E2E now compares current device keys before inviting, stays on
the chat URL for setup, acceptance and messaging, checks view-once purge
on layer exit and burn for both peers, and distinguishes preserving tab
close from destructive teardown. The synthetic identity marker is retained
on ordinary reopen, then explicit teardown removes the database.

The final complete local gate passed: Go formatting/lint/race, typechecks,
core 125/125, PWA 209/209 in three consecutive runs, production build,
private-artifact bundle guard and Chromium 13/13. Run browser suites
sequentially because Playwright can reuse another run's server. The local
WSL environment uses ~/sdk/go/bin and ~/go/bin on PATH and
~/pwlibs/usr/lib/x86_64-linux-gnu on LD_LIBRARY_PATH; no CI security setting
was changed. Earlier failed attempts remain documented in F7.

Owner mass review and real-device manual acceptance remain mandatory before
merge. The in-chat implementation does not finish every F5 M7/M8 or release
readiness item; contact verification badges, chat-list private-session chips,
remaining screen/a11y sweep and release operations must be reconciled with
the existing checklist before declaring the entire roadmap complete.

### V3.4 — public draft isolation during layer switches

A new Chromium assertion first reproduced loss of the public draft on a
private/public switch. Public history and composer now stay mounted but
hidden and disabled in private mode; reply/edit/upload state stays public,
and public send/upload handlers reject calls while private or verifying.
The browser test confirms the original public draft returns unchanged and
no private test text appears in public message POSTs. This supersedes the
V3.2 note about clearing public draft state.

The final sequential gate passed again after this fix: core 125/125,
PWA 209/209 three times, both typechecks, build/bundle guard, Go checks and
Chromium 13/13. An earlier PWA-unit run overlapping browser activity failed
two fixed-delay assertions (consent request count and pinned-bar load);
the sequential gate passed. That does not prove those timing-sensitive
unit assertions are deterministic under load.

V3 remains in progress, not complete: F2 still requires the settings sheet
and preference choice, removal of legacy private routes, mask/palette/pattern
and vertical view-once control, timeline ended/reload states and list chips.
U2/U3 and the owner mass review/manual acceptance are not completed by this
implementation. Production OTP/provider configuration and live deployment
remain separately owner-gated R1/R2 work.

## Current execution slices

### U1 — public UI acceptance on a real phone (next)
Goal: use the remaining VPS window for release-PWA interaction testing, not
private browser lifecycle repair. Scope is the current public UI; no new features,
crypto, relay, identity or same-window private integration.

1. Orchestrator/Product Manager: freeze the checklist and classify findings as
   release blockers, public visual polish or deferred private/post-MVP work.
2. PWA/Testing: compare the public build against concept 07; establish the tested
   local SHA and check for stale service-worker assets before attributing a bug.
3. Run relevant public UI tests, typecheck, build and MVP bundle guard before a
   test deployment. Record checks actually run; never imply the full gate passed
   from targeted checks alone. DevOps deploys only an approved committed tree.
4. Owner tests the release build on the phone, with a desktop peer for messaging:
   - keyboard open/close, input focus without page zoom, safe areas, scroll and
     composer visibility, portrait/landscape where supported;
   - Chats/Contacts/Settings tabs, deep screens and deterministic Back behavior;
   - tap-to-chat, right-click/long-press menus, scrolling cancellation and dialogs;
   - photo upload/display, text send, reply/edit/retract, archived-chat lockout;
   - group member navigation/actions and report submission;
   - light/dark/system themes, readable states and touch targets;
   - background/resume of PUBLIC chat and reconnect, refresh/update and offline
     indication. Public browser bugs remain in MVP scope.
5. Record device, OS, browser, build SHA, reproduction, expected/actual behavior
   and screenshots for each finding. Repeat the public UI flow in installed PWA
   mode if available; do not report untested devices/modes as passed.
6. PWA/Core fix only reproduced public blockers; Backend participates only for
   confirmed API/storage defects. Add a regression first where practical.
7. Security checks safe rendering, permissions and exclusion of private UI/code
   from the production build. Testing reruns affected flows; owner reviews each
   completed increment. Documentation records evidence in the existing owner log.

Exit: public mobile checklist has explicit results, blockers fixed and retested,
remaining polish queued for U2, and owner acceptance recorded. VPS cancellation
is the owner's action. If the window closes early, keep untested cases pending
and continue locally; do not mark them passed or rush unsafe changes. Before
cancellation, ask whether test data/uploads need preservation; no deletion or
backup/export of private data is implicit in this plan.

### V1 — O8: five-symbol verification design and consistent visuals
Security/Core audit the current per-session SAS and the planned F7 device-pair
fingerprint separately. Specify canonical input, domain separation, symbol-set
size, entropy and comparison/rejection flow before changing output length.
Five symbols are the owner target, not permission to truncate an existing digest
without review. If security strength is insufficient, present the tradeoff to
the owner before implementation. PWA renders identical locally hosted licensed
assets and stable labels across devices. Testing supplies deterministic vectors,
pair-order tests and desktop/mobile rendering checks. Avoid an interim session-SAS
rewrite that would immediately be discarded by F7; reusable mapping/rendering
belongs here and F7 integration in V2.

### V2 — F7: device-pair verification, without a browser-storage expansion
Backend/Core/Security implement the F7 identity-directory and signed-handshake
contract in reviewable increments: public key publication/access/revocation,
identity and pin logic, then verification/integration tests. Verification is per
device pair, not an account-level badge; unknown/changed keys block private sends.
The server must not receive the local pin graph; keys stay behind PrivateRemote.

Retain the existing F7 specification as the architecture reference, but review
its storage-dependent parts before implementation. Define a storage adapter and
the minimum dev-test identity/pin lifecycle explicitly; this planning update does
not authorize replacing IndexedDB with an insecure store or silently switching
to volatile identity. Browser persistence, vault/unlock, recovery and native
keystore integrations are deferred; cryptographic correctness and cross-user
isolation are not. The dev implementation must honestly expose whether reload
requires re-verification. Any change to F7's persistence/sign-out contract needs
owner approval before code. Test with an isolated adapter while that decision is
pending; do not mark integrated F7 complete from adapter-only tests.

### V3 — O10 / M6 / F2: same-window private mode
After V2, embed the private pane in S5 as concept 07 specifies: verification
entry, settings sheet, invite/waiting/ended states, explicit layer control,
private composer, view-once and burn. Preserve public history and drafts without
wrong-layer sends; snapshots only cross the host boundary. No browser-background
repair or persistent-storage feature is added here. Test invite/verification,
bidirectional delivery, rejection, TTL, burn and layer transitions in Chromium;
check phone layout when available. Keep O9 documented as an unresolved dev-host
limitation, not a passing lifecycle test or a zero-trace guarantee.

### U2 — public M7 completion
Audit S1–S3, S7–S9a, S14/S15 and shared dialogs against concept 07. Implement only
missing public styling, loading/empty/error states, focus/keyboard/44px target
and reduced-motion behavior; retain API semantics and testids. Break into small
screen-family commits; owner reviews each increment. Private frames are covered
by V3, not deferred. No features added to fill visual empty space.

### U3 — M8 combined acceptance
Run the full local `pnpm gate`, public and dev-private real-Chromium E2E,
release-bundle exclusion checks and public/private concept comparison. Record real-device coverage and remaining limitations;
owner approval is required before any separately authorized merge. Update the
phase journal before a later approved knowledge refresh. No push/merge by default.

### R1 — real OTP delivery
Separate Backend/Security/DevOps slice: select an owner-approved HTTPS email
provider, configure secrets without committing values, test delivery and provider
failure behavior, retain rate limits and ensure codes are not exposed in logs.
Provider choice, account access and production configuration require owner input.
This slice is not implied to be implemented by UI acceptance.

### R2 — production deployment readiness
Verify reproducible deployment, secrets, health, writable uploads, migrations,
backup/restore procedure and operational limits. Disable demo authentication and
development OTP logging for the release environment; test registration/login
using real delivery. Owner approval gates changes to the live environment. This
can run on a later VPS and must not depend on retaining today's test server.

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
| M1 ✅ | shadcn stack, fonts, token aliases (tokens v2 replaced in M3) |
| M2 ✅ | Reka primitives: ConfirmDialog, MessageMenu, Sheet, Switch |
| M3 ✅ | Tokens v3 (four modes as CSS variables), theme store + Appearance setting + `theme-color` meta, Avatar (hash colour), Chip, contrast + hue tests |
| M4 ✅ | App shell + tab bar (route meta `nav`), Contacts root (requests / sent / contacts — needs F1), Settings root restyle |
| M5 ✅ | Chat list rows, chat view: header, bubbles (tail style), grouping, pinned bar, attachments (photo/file cards), reply quote, typing, composer |
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
  gate` script (`scripts/gate.sh`, done) replicates CI locally (Go race+lint incl. Postgres,
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


## Owner test log (first device test, test server, 2026-11-02)
Passed: login, messages, group creation, report (verified in the DB via
`ogadmin`), contact removal; UI "smooth and tidy".

| # | Finding | Status |
|---|---------|--------|
| O1 | iOS zooms the page when a text field is focused → whole UI cropped | fixed: 16px fields on touch devices, E2E over every screen (mutation-checked) |
| O2 | photo upload fails on PC and phone | fixed: uploads volume was root-owned while the server runs unprivileged (500, silent) — image creates it owned by the server user, start-up refuses an unwritable dir, failures logged, volume repaired on the server, verified with a real upload |
| O3 | tapping a group member does nothing | fixed: a tap opens the profile; owner/moderator actions behind a per-row manage button |
| O4 | "pretty empty" | expected: features not built yet (private layer, F7/F2) |
| O5 | demo for the mediator: needs a reusable invite + a code without an inbox | done: master invite (`--uses`) + demo login code limited to fake demo addresses (dev mode only) |
| O6 | wants the private layer on the server within 1–2 sessions | `dev.openglass.space` serves the current private layer as soon as the DNS record exists; redesign (M6) follows F7 |
| O7 | people lists: tap should open the chat, right-click / long-press a menu (Profile, Report …) | done: tap = chat for mutual contacts (profile for anyone else); context menu Message · Profile · Report · Remove contact (Reka menu at the pointer; touch long-press cancelled by scrolling and not followed by a tap); applied to Contacts and group members |
| O8 | SAS currently displays 12 emoji; owner expects 5. Native emoji differ between desktop and mobile and are difficult to compare | open: audit the current SAS mapping and security strength before changing length; use identical self-hosted visuals and text labels across devices |
| O9 | after mobile screen lock, desktop tears down the private session but mobile resumes stale messages; Back opens invite creation instead of the public chat; a second session cannot deliver mobile messages to desktop | open, release blocker for private demo: reproduce both initiator/receiver roles; investigate lifecycle, transport and session cleanup before assigning a root cause |
| O10 | private chat is a separate screen rather than a layer in the same chat window, contrary to concept 07 | open: implement the approved same-window private pane; preserve isolation of private state and explicit public/private send cues |

## Historical proposal — next two work sessions (superseded)

Not active: the owner deferred private work in favor of public mobile acceptance.

This is an execution order, not a delivery-time guarantee. No implementation or
server deployment is authorized by this planning update. Owner review remains
required; F7 and the M6 dependency order must be reconciled before expanding scope.

### Session 1 — lifecycle correctness before visual work
- Frontend Core + PWA: reproduce O9 on mobile and desktop in both roles,
  including screen lock, background/resume, disconnect and a second invitation.
- Testing: first add a failing regression for stale state and repeated sessions.
- Frontend Core + Security: ensure terminal sessions cannot be reused, old
  messages/keys/listeners cannot contaminate a new session, and sending is blocked
  until the new session is independently verified. Audit actual cleanup; hiding
  the pane is not evidence of erasure.
- PWA: Back and terminal-session navigation return to the existing public chat,
  not invitation creation; resuming must reconcile the session before allowing sends.
- Acceptance: bidirectional delivery in a fresh second session, no old private
  messages visible, and consistent terminal state on both devices. Run Chromium
  regression plus an owner test on the real phone; simulated visibility events
  alone do not establish mobile screen-lock correctness.

### Session 2 — verification UX and same-window integration
- Security + Frontend Core: audit SAS entropy and mapping; five symbols must
  retain an explicitly reviewed authentication strength rather than merely
  truncating the existing sequence. Agree an alternative representation with the
  owner if the five-symbol target is insufficient.
- Design + PWA: identical self-hosted SAS visuals with stable labels on desktop
  and mobile, subject to asset license/CSP checks; no platform-native glyph dependency.
- Product Manager + Orchestrator: reconcile F7/M6 scope with the existing plan.
  Integrate the approved private pane inside the public chat window only after
  the lifecycle fix, without exposing crypto/session state to the shell.
- Testing + Security + Code Review: repeat invite/SAS/message/view-once/burn,
  lock/resume, Back, rejection, timeout and repeated-session flows; check wrong-layer
  sends and the MVP bundle guard, then run the full local gate.
- Owner compares against concept 07 and tests both devices before advancing to
  `next`. Deploy only after explicit approval, with the exact tested commit recorded.

## Historical proposal — P0 private lifecycle recovery (deferred)

Not authorized for implementation. O9 remains open for the post-MVP Android
workstream; the hidden-page policy below is a rejected current-scope proposal.

Owner direction: keep commits local; the current VPS is available for testing
only until the owner cancels it this evening. This is a test opportunity, not a
reason to skip gates or promise completion today. No push, merge or cancellation
of infrastructure is included. Implementation awaits owner review of this plan.

### Scope and evidence
- Fix O9 only. O8 (SAS) and O10 (same-window UI) stay tracked separately.
- `apps/pwa/src/privateBoot.ts` currently wires authentication and `pagehide`,
  but has no visibility/resume reconciliation. Screen lock does not reliably
  imply `pagehide`; this is an investigation lead, not a proven root cause.
- `S12PrivateChat.vue` uses history-based Back and a non-immediate terminal-state
  watcher. Audit initial empty snapshots and history entry points as well as
  subsequent closure notifications.
- `PrivateRemote` snapshots are explicitly notified and selected by peer;
  inspect stale subscriptions, session selection and asynchronous callbacks.
- `store.teardown()` clears volatile state before awaiting IndexedDB cleanup;
  test overlap with connect/new invitation rather than assuming it is race-free.

### Intended lifecycle policy for this slice
- Use fail-closed behavior when the document becomes hidden: invalidate the
  current private session locally and prevent further sends immediately. Screen
  lock cannot be detected distinctly from tab switching, so this policy also
  ends sessions on tab/app switches; owner approval of that tradeoff is required.
- Perform best-effort relay notification/disconnect, never depend on delivery of
  a final network event while the browser is suspending.
- On visible/pageshow, finish pending cleanup before allowing a fresh relay
  connection; never revive the old session or reuse its verification state.
- An active peer must converge through existing relay disconnect/expiry rules;
  do not claim simultaneous deletion or physical memory erasure.
- Preserve the ordinary public chat, authentication and history. Returning from
  the private screen must target that chat explicitly, not invitation history.
- Do not introduce F7 persistent identities, new verification semantics, migrations
  or relay envelope kinds. If investigation requires a protocol change, stop and
  review scope instead of silently widening this slice.

### Ordered work and role ownership
1. Orchestrator + Product Manager: approve the above hidden-tab policy and P0
   scope. No F7/M6 dependency changes are needed for this correctness patch.
2. Testing + PWA: reproduce the owner's exact sequence on real devices, then
   write failing lifecycle/navigation tests and a two-client regression.
3. Frontend Core: trace connection generations, session IDs, queued envelopes,
   snapshots and teardown/connect overlap. Reject late events from dead sessions
   and serialize cleanup/reconnection where the reproducer demonstrates a need.
4. PWA: wire platform lifecycle through the typed remote; make handlers
   idempotent, clear private UI draft/error state on session replacement, and
   route terminal/empty private screens and Back to the existing public chat.
5. Backend: audit disconnect grace/expiry and obsolete-session relay handling;
   change backend code only if a failing test establishes a server defect.
6. Security + Testing: review stale-event isolation, cleanup and wrong-session
   sends. No plaintext, key, OTP or resume-token logging for diagnostics.
7. DevOps: run the local gate, make a focused local commit, record its SHA,
   and deploy that clean tested tree only with owner approval. Do not change
   demo access, wipe data, or cancel the VPS as part of P0.
8. Documentation: update O9 with evidence and known limits; write the completed
   phase journal before any later approved knowledge refresh. Owner review gates
   `next`; role checklists are not represented as independent agent reviews.

### Acceptance matrix
| Scenario | Required result |
|----------|-----------------|
| Phone locks as initiator / receiver | local private state invalidated; peer converges to ended state under relay policy |
| Phone resumes, including pageshow | no old messages, draft or live send capability; public chat is shown |
| New invitation from either side | new session ID and normal verification; bidirectional delivery; no old payloads |
| Teardown repeated / overlaps reconnect | no duplicate clients/listeners; no stale callbacks restoring state |
| Late old-session envelope or close event | cannot mutate or close the replacement session |
| Back from setup / verify / chat, including direct entry | deterministic return to the corresponding public chat |
| Burn / TTL / logout / reload | existing cleanup semantics and public messaging remain correct |

Verification ladder: targeted Vitest regressions first, core/PWA typecheck and
unit suites, real two-client Chromium E2E, MVP bundle guard, then full `pnpm gate`.
Real phone screen-lock testing remains mandatory; simulated events are not a
substitute. If server access ends before owner testing, retain the local commit
and mark real-device acceptance pending, not passed. No unsafe rush to deploy.

### Minimal continuation queue (not one combined slice)
1. **P0:** lifecycle recovery above — first and blocking further private demos.
2. **P1:** SAS audit and consistent rendering (O8); distinguish today's ephemeral
   session SAS from F7's planned five-symbol device ritual. Approve entropy and
   representation before implementation; do not truncate blindly.
3. **F7:** device-pair identity and verification, separately reviewed backend/core
   and integration increments, retaining the existing dependency before M6.
4. **M6/F2:** same-window private pane (O10), no unrelated feature additions.
5. **M7/M8:** finish existing UI scope, regression/security/bundle checks and owner
   acceptance. Production readiness also requires real OTP delivery and removal
   of demo/dev access; the private demo is not the release-PWA readiness gate.

The release MVP still excludes private artifacts. F7/M6 are dev-tier work, not a
reason to silently redefine the production bundle contract. Extra contact
permissions, vault expansion and desktop features remain outside P0.
