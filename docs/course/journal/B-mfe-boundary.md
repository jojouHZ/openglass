# Journal B — the private layer gets a real host↔remote boundary

**Phase:** B — MFE boundary refactor between the C diagnostic slice and the
real-browser E2E completion (E).

## Context

C proved with CI evidence (`mainPiniaSame: true`) that the E.6 failure was
not two Pinia instances — it was the host reaching into remote state:
`S12PrivateChat.vue` computed `pSession` straight out of
`priv.sessionByPeer()`, and `s.messages.push()` inside a `Map`-based Pinia
state never re-rendered the real Chromium build.

## Design decisions

1. **Facade + immutable snapshots, not a literal event emitter.**
   `createPrivateRemote(store)` in `packages/core/src/private/remote.ts`
   exposes `watchSession(peerId, cb)` / `watchInvites` / `watchRelayState`
   subscriptions and command methods (`send`, `accept`, `confirmSas`,
   `burn`, …). Events would have forced the host to re-assemble state; a
   snapshot keeps the host's mental model trivial: *set the ref, render it.*
2. **Imperative notify, not deep reactivity.** `store.notify()` ticks after
   every mutation site; the remote rebuilds whitelisted snapshots and pushes
   them to subscribers. No `Map`+`push()` reactivity puzzles can cross the
   boundary because nothing reactive does.
3. **Whitelist mapping, explicit fields.** `toSessionView()` lists exactly
   what the host may see — `sessionId`, `peerId`, `status`, `sas` (display
   emojis), decrypted `messages`, `ttlEndsAt`, `peerOfflineUntil`,
   `canSend`. `sessionKey`, `ownKeys`, `pendingPeerPub`, `resumeToken` and
   `lastSeq` cannot leak by accident; a contract test asserts the serialized
   view contains none of them.
4. **The contract key is public, the implementation is private.**
   `PRIVATE_REMOTE_KEY` (`"og.private"`) is exported from
   `@openglass/core`'s public barrel — a 10-char string in the mvp bundle.
   `createPrivateRemote` is dynamically imported inside the
   `VITE_PRIVATE_MODULE` gate, so the mvp bundle still ships zero
   private-module code.
5. **Host keeps a nullable inject on public surfaces.** S5 uses
   `injectPrivateRemote()` (null in mvp); private views use the throwing
   `usePrivateRemote()` — a missing provider is a wiring bug, not a silent
   empty screen.

## War stories worth teaching

1. **"It works in happy-dom" is not evidence.** Unit tests passed with the
   old direct-store reads; Chromium didn't. The boundary fix, not a
   reactivity tweak, is what actually holds across builds.
2. **Watch the definition site, not the usage site.** Moving the S5 private
   subscription below the `peer` computed declaration mattered —
   `watch(..., { immediate: true })` evaluates its source eagerly, and a
   lazily-imported store would have hidden a TDZ crash behind the dynamic
   `import()`.
3. **Test through the real boundary.** `private-screens.test.ts` mounts
   views with `createPrivateRemote(realStore)` provided — the suite now
   exercises store → snapshot → DOM, the same path the browser takes.
   `enableAutoUnmount` was added because remote subscribers are real
   callbacks: an un-unmounted wrapper with a live subscription can navigate
   the shared router mid-test.
4. **The reactivity story was a red herring.** Post-B CI diagnostics
   (emit/subscriber counters only, no content) showed the host ref already
   held `messages.length === 1` while the DOM showed the empty state. The
   Playwright trace revealed the truth: Bob's client sent a display receipt
   ~16ms after delivery, and Alice's `k:"r"` handler burned her own
   view-once copy exactly as designed. The spec was asserting a sub-20ms
   transient bubble. Lesson: when "the ref has it but the DOM doesn't",
   check whether the data legitimately changed again before assuming a
   render bug — log the emitted view, not just the send path.

## Test surface

- `pnpm --filter @openglass/core test` — 69 tests (+5 remote contract tests)
- `pnpm --filter @openglass/pwa test` — 59 tests
- `pnpm --filter @openglass/pwa typecheck` — clean
- `check-mvp-bundle` — clean; `remote-*.js` chunk exists only in dev-host
- `go test` — unchanged

## Next steps

- **E:** Re-run the real-browser E2E with the corrected assertion — Bob's
  render proves delivery; Alice's `priv-empty` reappearance proves the
  receipt burn. Then resume the remaining E.6 scope (pagehide/IndexedDB
  teardown).
