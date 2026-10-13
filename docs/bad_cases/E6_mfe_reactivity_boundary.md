# E6 MFE Reactivity Boundary Bad Case

## Problem
The real-browser E2E test for the private layer (`apps/pwa/e2e/invite-flow.spec.js`)
failed consistently at the message-sending step. The browser logs showed that the
private store successfully encrypted and stored the outgoing message
(`messages.length === 1`), but the host `S12PrivateChat.vue` component still
rendered the empty placeholder (`no messages — nothing is stored, everything is
encrypted`).

## Root Cause Analysis
1. **MFE boundary violation.** The PWA host (`apps/pwa`) imports and uses
   `usePrivateStore` directly from `@openglass/core/private/store`. In a
   micro-frontend architecture the host should not depend on the remote core
   module's internal state.
2. **Reactivity across the boundary is fragile.** The core store mutates
   `s.messages.push(...)` and the host's `computed(() => priv.sessionByPeer(...))`
   does not reliably re-render. In `happy-dom` unit tests the mutation was
   reactive, but in the real Chromium/Vite dev build it was not.
3. **Missing event contract.** There is no typed event bus between the core
   private engine and the PWA shell. The host reads `priv.pSession.messages`
   directly instead of subscribing to a public contract such as
   `private:session-change` / `private:new-message`.

## Evidence from the C diagnostic run

CI run: https://github.com/jojouHZ/openglass/actions/runs/38376992880

```
[main] pinia active true priv id private sessions 0
[S12 send] identity { textLen: 18, hasSession: true, hasKey: true,
  mainPiniaSame: true, privId: "private" }
```

`mainPiniaSame: true` proves that `S12PrivateChat.vue` and `main.ts` share the
same Pinia instance and the same `usePrivateStore()`. The failure is therefore
not two independent stores; it is the fragile reactivity of a host that reads
remote state directly.

## Error Pattern
```ts
// BAD: host reaches into remote store
// apps/pwa/src/views/private/S12PrivateChat.vue
const priv = usePrivateStore();
const pSession = computed(() =>
  peer.value ? priv.sessionByPeer(peer.value.id) : null
);

// BAD: in-place mutation of nested array in a Map-based Pinia state
// packages/core/src/private/store.ts
s.messages.push({ id, fromMe: true, text, ts: Date.now() });
```

## Resolution
- Introduce a typed event bus contract between the PWA host and the private
  core module.
- Remove `usePrivateStore()` calls from `apps/pwa`; the host receives UI events
  or mounts remote components from `@openglass/core`.
- If a quick tactical fix is required, replace `s.messages.push(...)` with
  `s.messages = [...s.messages, msg]` to force reactive reassignment, but treat
  this as a temporary workaround while the MFE contract is implemented.

## Post-B evidence — the reactivity diagnosis was incomplete

CI run: https://github.com/jojouHZ/openglass/actions/runs/38382435529
(commit `97b4812`, facade + emit/subscribe counters)

```
[alice] [S12 send] {len: 18, hasView: true, canSend: true, msgs: 0}
[alice] [og.remote] emit 1 session subs ...
[alice] [S12 send] resolved, msgs 1        <- host ref HAS the message
[alice] [og.remote] emit 1 session subs ... <- Bob's receipt arrives ~16ms later
```

The host-owned ref held `messages.length === 1` and the render effect was
alive (the ttl countdown re-rendered every second), yet the DOM showed the
empty placeholder at assertion time. The Playwright trace resolved it:

- Bob's page screenshot renders the `burn after reading` bubble with the
  view-once mark — delivery, decryption and rendering all worked.
- The emit at +16ms after `send` is Alice's `k:"r"` receipt handler:
  Bob's `watch(messages.length)` calls `markDisplayed` the instant the
  decrypted snapshot arrives, the receipt envelope returns, and
  `s.messages = s.messages.filter(m => !(m.fromMe && ids.has(m.id)))`
  burns Alice's copy — the designed zero-trace semantics
  (`store.ts`: "peer read our view-once messages — burn our copies now").

So the DOM was empty because the message was **legitimately burned**, not
because reactivity failed. The spec's "Alice's own copy renders immediately"
assertion asked Playwright to observe a sub-20ms transient — un-observable
by construction. The B refactor was still the right architectural fix (the
host must not read remote state), but it was not the E2E blocker.

## Spec fix (post-B)

`invite-flow.spec.js` no longer asserts Alice's outgoing bubble. Instead:
`priv-input` clearing proves `remote.send()` resolved; Bob's
`toContainText("burn after reading")` proves E2E delivery; Alice's
`not.toContainText(...)` proves the receipt burn. The burn assertion is the
real guarantee — the transient bubble was never a user-facing contract.

## Impact
- The E2E private flow (invite → SAS → message → burn) could not be validated
  in a real browser.
- The PWA host became coupled to the core store, blocking future native
  shell hosts (iOS/Android/desktop) that must consume the same private engine
  through the same contract.

## Prevention
- Host modules must never import remote stores directly.
- Define explicit `private:*` event contracts before adding new UI surfaces.
- Run real-browser E2E early in the slice instead of relying only on unit tests
  that do not reproduce cross-module reactivity and MFE boundaries.
