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
