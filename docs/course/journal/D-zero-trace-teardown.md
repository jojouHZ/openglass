# Journal D — zero-trace teardown becomes a contract obligation

**Phase:** D — closes the E.6 remainder: lifecycle wiring through the
`PrivateRemote` contract, dirty-boot sweep, real-browser teardown proof.

## Context

`teardown()` existed in the private store, and `privateBoot.ts` already
wired `pagehide`/logout to it — but through `Pick<usePrivateStore>`, the
last runtime dependency the host held on remote internals. The B boundary
stopped one file short. Slice D finishes it and proves the zero-trace
promise in Chromium.

## Design decisions

1. **Lifecycle is a host responsibility; teardown is a contract command.**
   `PrivateRemote` gained `boot()`, `connect()`, `teardown()`. The core
   never touches `window`/`document` — each shell maps its own platform
   events (PWA `pagehide`, Capacitor `pause`, Electron `before-quit`) onto
   the same two commands. A native shell without DOM stays implementable.

2. **Composition root goes through the factory.** `main.ts` now calls
   `createPrivateRemoteFor(pinia)` — the store instance never crosses the
   MFE boundary even at bootstrap. `privateBoot.ts` types its parameter as
   `Pick<PrivateRemote, "connect" | "teardown">` — no store import at all.

3. **A surviving identity DB means a dirty death.** `teardown()` deletes
   the whole `openglass-private` DB — so if the DB exists at boot, the
   previous session died without teardown (hard kill, crash, or a pagehide
   the renderer didn't finish). `prepareIdentityStore()` detects this via
   `onupgradeneeded` (fires only when the DB is created, i.e. absent
   before) and wipes the leftover before any identity work. Identity is
   regenerated, never reused after a dirty shutdown.

4. **Strict sessions make teardown testable.** The relay's peer-offline
   grace is 60 s — too slow for E2E. Strict sessions close instantly on
   peer disconnect (`closeSessionLocked`), so the teardown spec closes
   Bob's tab and asserts Alice's eject in milliseconds.

## War stories worth teaching

1. **`bob.goto()` is not navigation — it is a death.** The previous E2E
   "purge on leave" check reloaded the page, wiping the volatile store, so
   `priv-empty` proved nothing. In-app `private-toggle` re-entry keeps the
   session alive and makes the purge assertion real.

2. **`flushPromises` is not a crypto barrier.** The view-once unit test
   flaked again under full-suite load: real AES-GCM resolves off the
   microtask drain. `vi.waitFor` on the condition is the deterministic
   wait — timers and drains are guesses.

3. **Two independent wipe paths, one invariant.** The E2E cannot control
   whether `pagehide → teardown()` or the next boot's sweep wins the race —
   and doesn't need to: the assertion (`openglass-private` absent from
   `indexedDB.databases()`) is the postcondition either path must satisfy.

## Test surface

- `pnpm --filter @openglass/core test` — 72 tests (+ lifecycle contract,
  +2 boot-sweep cases)
- `pnpm --filter @openglass/pwa test` — 59 tests, `setTimeout(0)` gone
- New E2E: `zero-trace teardown: tab close ejects peer and leaves no
  IndexedDB` — strict session, real `page.close()`, IDB postcondition
- `check-mvp-bundle` — clean

## Contract additions

| Method | Host trigger | Effect |
|---|---|---|
| `boot(url, tokenFn)` | app bootstrap | relay client + dirty-boot sweep |
| `connect()` | `session.authed` → true | relay online |
| `teardown()` | `pagehide` / logout | wipe sessions + secrets + IDB, disconnect |
