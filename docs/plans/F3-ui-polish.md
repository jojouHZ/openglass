# Slice F3 — UI Polish Pass (FIRST)

Goal: kill every visual/logic wart found in the manual 3-browser test
before deeper rework. The UI is the weakest surface — this slice makes
it honest and dense. Reference: Telegram row discipline + GetStream
component structure (`stream-chat-css`/`stream-chat-react` — patterns
only, no code).

## Scope

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| B6 | Context menu detached from bubble | Anchor `MessageMenu` to event coords / trigger bubble; clamp to viewport | `components/chat/MessageMenu.vue`, `S5ChatView.vue` |
| B7 | Group sender avatar empty | Initials avatar (same component as own-profile avatar) | `S5ChatView.vue` message row |
| B8 | Group rights open via own-avatar click | Group name/header → `S9a`; avatar keeps profile intent | `S5ChatView.vue` header |
| B9 | Rights modal below viewport | Bottom-sheet on mobile, centered modal on desktop | `S9aGroupManage.vue` |
| B10 | No self-revoke in S14 | "This device → Sign out" row + confirm | `S14Security.vue` |
| B11 | Weak search highlight | Full-row highlight strip on match + current-match state | `S5ChatView.vue` / `inchat-search` bits |
| U-3 | Fake folder tabs | `All` + disabled "New folder" (title="post-MVP") | `S4ChatList.vue` |
| U-4 | Chat list row → Telegram-style | avatar / name+preview / right rail: date, pin, mute, unread badge | `S4ChatList.vue`, `ChatListItem.vue` |
| B4-UX | Invite field looks required | label "Invite code (new accounts only)" + optional marker | `S1InviteEmail.vue` |
| S11-vis | Setup screen controls unreadable | Contrast pass — labels legible, primary action prominent | `S11SessionSetup.vue` (interim; F2 replaces with modal) |

## Approach

- Component discipline: extract `ChatListItem` into the reference shape
  (3 slots: leading avatar / center title+preview / trailing meta rail).
- Context menu: teleport to body, `position: fixed` at pointer coords,
  flip when near edges — the standard GetStream pattern.
- No logic/API changes except B10 (`auth.logout` already exists —
  self-revoke reuses it).
- Keep every `data-testid` stable; E2E + unit tests must not drift.

## Tests

- Unit: initials rendering, menu anchoring math (pure fn), S14 revoke row.
- E2E skip — visual changes covered by existing specs (no flow change).

## Risks

- Menu anchoring across scroll containers — clamp + close-on-scroll.
- Don't gold-plate: pixel-perfect polish is NOT the goal; density +
  legibility is.
