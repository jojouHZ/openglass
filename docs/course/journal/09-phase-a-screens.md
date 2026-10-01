# Journal 09 — Phase A: contacts, groups UI, settings (A.1–A.5)

**Phase:** the whole contact/group/settings surface on top of the B-series
backend — S6 contact search, S7 contact profile, S8 group creation,
S9a group management, S13 settings, S14 sessions/security, plus the
realtime contact deltas that feed them. Frontend-heavy; the backend
needed exactly one fix all phase.

## Design decisions (and why)

**Contacts is its own store, not a chats sub-field.** Contact state has
independent lifecycle (lazy `loaded` flag, realtime deltas) and feeds
three screens — S6 picker, S7 relationship actions, S8 group picker. A
dedicated Pinia store with `byId`/`isMutual`/`searchLocal` getters kept
chats.ts from accreting social-graph concerns. WS events route through
`chats.connectRealtime` (it owns the socket lifecycle) but forward to
named, directly-testable handlers — `onContactAdded` works in a unit
test with no socket.

**Relationship is server-computed, always.** `GET /users/{id}` returns
`relationship` — the UI maps enum → action matrix, it never derives
"mutual" itself. This is the same rule as message auth: the backend is
authoritative, the UI is presentation. It paid off immediately — see
the mock-vs-live bug below.

**Search starts at one character.** The contract shipped with
`minLength: 2`. The owner overrode it: work chats use single-char
prefix markers (`!announce`, `#deploy`) that exist *specifically* to be
filtered on. Min-2 buys nothing on a closed instance — this isn't a
public API where short queries cost money. Contract, both handlers,
mock, and both search UIs moved together; empty `q=` still 400s.

**Scroll containment, not page scroll.** Every chat-adjacent screen is
`h-dvh + overflow-hidden` on the root and `min-h-0 flex-1
overflow-y-auto` on exactly one inner layer. `min-h-dvh` lets the column
grow past the viewport and the *whole page* scrolls — header drifts up,
composer gets pushed off-screen. The `min-h-0` is load-bearing: flex
children default to `min-height: auto`, so without it the scroll layer
refuses to shrink. Applied uniformly S4–S8 after the bug showed up in S5.

**Composer is a textarea.** `<input>` can't hold a newline, period.
Autogrow to ~6 lines; Enter sends, Shift+Enter inserts `\n`, and Enter
during IME composition (`e.isComposing`) confirms the candidate instead
of sending — without that guard every CJK user sends half-finished text.

**UI gates mirror server rights — and stay presentation.** Group
management hides actions the user lacks rights for (`inviteMembers`,
`removeMembers`, `editInfo`, chips in the member sheet), but the live
test deliberately drove a member *without* rights into `PATCH` — 403
confirmed the server never trusts the UI.

**No dead affordances.** S9a's "permissions" row, S13's
notifications/privacy/folders, S14's verified chip and screenshot
alerts — all prototypes promised them, the API doesn't have them, none
shipped. A row that 501s is worse than no row.

**Channels are a chat type, not a right — post-MVP.** Read-only
announcement groups were deferred rather than bolted on as a `post`
member-right: rights are moderation over *others*, `post` is a
participation flag on *self*, and mixing axes blurs the model. The
post-MVP plan is `chat.type: channel` where `post` defaults to false
for everyone but the owner — separate feature, separate UX, no retrofit.

## Bugs this phase actually caught

**Mock-vs-live divergence on `relationship`.** `GET /users/{id}`
hardcoded `rel="none"` for everyone except `self` — the enum was
contract-but-not-code. The MSW mock computed it honestly, so the whole
test suite was green while the live API lied. Caught only because the
manual mutual test ran `GET /users/{id}` after making two users mutual
and got `none` — while `POST /chats` (mutual-gated) succeeded on the
same pair, proving the disagreement. Fix: `ContactEdges` on the store
(both directions, one query) + handler mapping. **Lesson: the mock is a
spec of intent, not evidence of implementation — every mock-green
feature needs one live pass.**

**Silent search looked like broken search.** The first live report was
"search doesn't work". Reality: the API searched fine; a one-char query
was rejected by min-2 with *no* UI feedback, and a zero-hit query hid
the counter because `v-if="total"` renders nothing at 0. Two honest
states fixed it: "no results" after an answered query, immediate hint
before one. **UX lesson: every denied or empty result needs visible
feedback — silence reads as failure.**

**Fixed-timeout `flush()` made the suite flaky.** Tests asserted right
after `setTimeout(350)`; under parallel workers MSW latency drifted past
it and a *different* test failed each run — the worst failure signature
because it looks nondeterministic. `vi.waitFor` on the actual condition
fixed it. Companion trap, caught in review: a `waitFor` on a count
passes *before* the mutation lands if the pre-state already matches —
assert `before - 1`, never the absolute number.

**Disabled buttons swallow test clicks.** `trigger("click")` on a
`disabled` button dispatches nothing; the next assertion then fails on a
dialog that never opened. Wait for `busy` to settle before clicking —
or assert the button is enabled first.

**`data-testid` on a fragment-root component is dead weight.** AppInput
renders `label + p` siblings — Vue can't inherit the attr, it silently
drops, and every selector written against it finds nothing. Two views
carried these ghosts; tests now target `placeholder` attributes, which
survive refactors of the component's outer tag.

## Status

Phase A complete: contacts → groups → settings, all screens live-wired.
36 core + 31 PWA tests, Go suite + lint clean, prod build verified —
the private module provably absent from the `pwa-mvp` chunk graph.
