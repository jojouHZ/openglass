# Journal 11 — Phase C close + Phase D: states, silent failures, WS tests, docs audit

**Phase:** finishing MVP polish (C.3 PWA installability, C.4 state audit),
then a review-driven hardening pass (D.1 silent-failure sweep, D.2
WebSocket test coverage, D.3 full documentation audit).

## Design decisions (and why)

**Error as state, not as exception.** `ChatWindow.loadError` and
`chatsLoadError` store which operation failed rather than throwing past
the store boundary. The trigger was `refreshChats()`: ~8 call sites are
fire-and-forget WS handlers — a thrown error there is an unhandled
rejection nobody can display. A failure flag the UI renders (with a
manual retry) is the observable contract; a thrown exception was the
invisible one.

**Direction-aware load errors.** `loadError` is `"tail" | "older" |
"newer" | null`, not a boolean — a failed "load newer" was rendering the
"load earlier" retry button and calling the wrong recovery path. The
retry must re-fire the direction that actually failed.

**Session death navigates.** A `session.revoked` WS event or a failed
refresh resets the store, but Vue Router's auth guard only runs on
navigation — the user stayed on an authenticated screen with a dead
session until the next click. `watch(session.authed)` in `App.vue`
bounces to S1 the moment auth dies. The guard alone is not enough when
auth can die *while sitting still*.

**Group view merged into S5, S16 dev-gated.** The `/groups/:chatId`
route pointed at a placeholder nothing links to — group chats render in
the same chat view (`members` in the subtitle). Removed the route;
unknown paths fall through a catch-all to `/chats` with a `console.warn`.
`/states` (S16 component checklist) stays reachable only under
`import.meta.env.DEV`.

**Dead Vue props became real behavior.** `AppInput` has a fragment root
(label + error `<p>`), so Vue silently dropped `required`/`maxlength` —
HTML validation was dead markup. `inheritAttrs: false` + `v-bind="$attrs"`
on the input turned the cosmetic `vue warn` in tests into working
attributes.

**Documentation gets a maturity matrix.** The big defect the D.3 audit
found wasn't missing docs — it was that *designed* read like *shipped*.
`02-private-layer.md` and `05-threat-model.md` described E2EE guarantees
in present tense. Every component now carries IMPLEMENTED / DESIGNED /
STUBBED labels, and the threat model states bluntly: today everything is
public-layer; the E2EE guarantee is conditional on SAS verification and
the private layer is not built yet.

## Bugs / findings this phase actually caught

**`jwt.NumericDate` truncates to whole seconds.** A WS test token with a
400 ms TTL was born expired (exp ≈ now); even a 1 s TTL could live ~1 ms
if minted at `t.999`. Expiry tests need ≥2 s TTL. **Lesson: sub-second
lifetimes don't exist in JWT time.**

**My own coverage claim was wrong.** The review said "internal/ws has
zero tests" — but `internal/api/ws_test.go` already carried ~570 lines
of hub integration tests. The real gaps were point paths (expiry close,
non-auth first frame, non-member typing, grace-flap suppression, slow
consumer). Verify "untested" against the codebase, not memory.

**Docs lied about close codes and replay storage.** `errors.md`
documented 4403/4429 close codes the hub never emits (real: 4401 for bad
token *and* session.revoked, 4408 for auth timeout); `ws-events.md`
claimed a "~60 s Redis-backed" replay buffer (real: in-memory ring,
ReplayCap=256, idle eviction at 10 min). Contracts drift the moment
nobody diffs them against code.

**`internal` vs `internal_error` — two codes for one fault.** Both 500s
exist in `internal/api`. Documented as-is; a cleanup candidate rather
than a doc fix.

## Status

- **C.3/C.4 complete**: installable PWA (manifest + service worker +
  install prompt + global connectivity banner); full S16 state coverage —
  load errors with directed retry, chat not-found, catch-all redirect,
  session-death navigation.
- **D.1 complete**: silent action failures surfaced (pin/delete/search/
  copy/logout), AppInput attr forwarding fixed.
- **D.2 complete**: WS hub coverage closed — 6 integration + 4 unit tests
  for expiry/backpressure/grace-flap/ring eviction; `go test -race` green.
- **D.3 in review**: README rewritten; architecture series synced to
  reality (maturity matrix, trust model scoped to designed-but-unshipped
  private layer); API error/WS catalogs diffed against code; UX flow
  table gains ship-status column; SECURITY/CONTRIBUTING freshened.
