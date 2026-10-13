# Journal C — MFE diagnosis and private-layer host boundary (E.6 pause)

**Phase:** C — diagnostic slice before the MFE boundary refactor (B) and the
real-browser E2E completion (E).

## Context

The real-browser Playwright E2E for the private layer consistently failed at
the message-sending step. Browser logs showed that the outgoing message was
successfully encrypted and stored (`priv.send` resolved, `messages.length === 1`),
but `S12PrivateChat.vue` still rendered the empty placeholder. The initial
suspect was Vue reactivity (`messages.push` on a `Map`-based Pinia state), but
the deeper issue is that the PWA host imports `usePrivateStore` directly from
`@openglass/core/private/store` — a violation of the MFE boundary.

## Design decisions

1. **C is diagnosis, not a fix.** We add `pinia`/`store` identity logging and
document the event-bus contract before changing any architecture. Guessing
between "two Pinia instances" and "readonly reactivity failure" is replaced
with measured evidence.
2. **Identity logging only, no sensitive data.** Logs print `pinia` equality,
store `$id`, `sessions.size`, and `messages.length` — never `sessionKey`, SAS,
relay blobs, or plaintext text.
3. **Event-bus contract first.** `docs/architecture/mfe-private-event-bus.md`
defines `private:*` events before any code is moved. Host and remote agree on
the contract; the implementation follows.
4. **No `force:` actionability hacks.** The Playwright `fill`/`click` calls
revert to normal actionability so the E2E honestly reflects the UI state.

## War stories worth teaching

1. **The same code works in `happy-dom` but not Chromium.** Unit tests with
`fake-indexeddb` passed because the reactive graph is the same process and
`push()` was observed. The real browser build exposed that the host's
`computed(() => priv.sessionByPeer(...))` does not reliably re-render when the
remote mutates `messages.push()`. Lesson: browser E2E is the only acceptance
criterion for MFE reactivity.
2. **Reaching into a remote store hides the real boundary.** Direct
`usePrivateStore()` calls in `S12` and other host views made the issue look like
a reactivity bug; the root cause is an MFE anti-pattern. Lesson: host modules
should subscribe to events, not read remote state.
3. **Instrument then clean.** Temporary `console.log` lines were added to
pinpoint the failure and are removed in this slice. Diagnostic output should
never become permanent noise.

## Test surface

- `pnpm --filter @openglass/pwa test` and `pnpm --filter @openglass/core test`
- `pnpm --filter @openglass/pwa typecheck`
- `go test ./...`
- One CI run of `E2E` to capture the `console.debug` identity output and
  confirm whether the failure is one store or reactivity.

## Next steps

- **B:** Implement the `PrivateEventBus`, make `usePrivateStore` internal, and
  replace host `usePrivateStore()` calls with event subscriptions or remote
  component mounts.
- **E:** Re-run the real-browser E2E once the MFE boundary is clean and the
  message list updates through the event bus.
