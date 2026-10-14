# MFE Private-Layer Remote Contract

## Scope

This contract defines how the PWA shell host (`apps/pwa`) communicates with the
private-layer remote module (`@openglass/core/private`) without importing the
remote's internal Pinia store.

**Status:** implemented (slice B). The event-bus draft was replaced by a
typed *facade + immutable snapshot* design — `createPrivateRemote` in
`packages/core/src/private/remote.ts`.

## Design principle

- The host must never read `usePrivateStore()` or any remote state.
- The remote owns all cryptography, session state, relay connection, and
  volatile messages.
- The host subscribes to UI-safe snapshots and sends commands back through
  the `PrivateRemote` interface.
- Snapshots are emitted **imperatively**: `store.notify()` ticks after every
  mutation. Host↔remote updates do NOT rely on Vue's deep reactivity across
  the module boundary — that was the root cause of the E.6 failure
  (`docs/bad_cases/E6_mfe_reactivity_boundary.md`).

## Injection

`main.ts` provides the facade under the public key `PRIVATE_REMOTE_KEY`
(`"og.private"`, exported from `@openglass/core`). Composition root uses
the factory so the host never holds the store instance:

```ts
const remote = createPrivateRemoteFor(pinia); // store stays inside core
app.provide(PRIVATE_REMOTE_KEY, remote);
remote.boot("/api/v1/relay", () => session.accessToken);
```

Host views consume it via `apps/pwa/src/privateRemote.ts`:

- `usePrivateRemote()` — throws when the remote is absent (private views)
- `injectPrivateRemote()` — nullable, for public screens (S5) that may run
  in the mvp bundle where the remote does not exist
- `usePrivateSession(getPeerId)` — host-owned `Ref<PrivateSessionView|null>`
  fed by remote emissions, resubscribes on peer change, unsubscribes on unmount

## Remote-to-host snapshots

```ts
interface PrivateSessionView {
  sessionId: string;
  peerId: string;
  status: PrivateStatus;          // inviting | incoming | exchanging |
                                  // unverified | verified | closed
  sas: readonly string[] | null;  // emoji grid for out-of-band comparison
  messages: readonly PrivateMessageView[];  // decrypted display payloads
  ttlEndsAt: string | null;
  peerOfflineUntil: string | null;
  canSend: boolean;               // session key exists — key never crosses
}

interface PrivateInvitesView {
  incoming: readonly PrivateInviteView[];  // { sessionId, peerId, peerName, strict, burnOnRead }
  outgoing: readonly string[];             // peerIds with our pending invite
}
```

Subscriptions:

```ts
remote.watchSession(peerId, cb): () => void;   // immediate + every mutation
remote.watchInvites(cb): () => void;
remote.watchRelayState(cb): () => void;        // ConnState
```

A session that burns or disappears emits `null` — `sessionByPeer` excludes
closed sessions, so the host sees "gone" rather than a dead object.

## Host-to-remote commands

```ts
// lifecycle — the host owns platform lifecycle and maps it onto the
// contract; the core never touches window/document itself
remote.boot(relayUrl, getAccessToken);  // once, at app boot
remote.connect();                       // relay online while authed
remote.teardown();                      // Promise<void> — zero-trace wipe

remote.startInvite(peer, { ttlSeconds, burnOnRead, strict });
remote.cancelInvite(peerId);     // drops the local pre-ack invite marker
remote.accept(sessionId);
remote.decline(sessionId);
remote.confirmSas(sessionId);    // out-of-band fingerprint matched
remote.burn(sessionId);
remote.send(sessionId, text, { viewOnce });   // Promise<void>
remote.markDisplayed(sessionId);              // receipt view-once messages
remote.purgeRead(sessionId);                  // view-once purge on unmount
```

## Security notes

- Snapshots are whitelist-mapped in `toSessionView()`: `sessionKey`,
  `ownKeys`, `pendingPeerPub`, `resumeToken`, `lastSeq`, raw relay blobs and
  SAS key material never cross the boundary. `sas` exposes only the emoji
  display strings.
- `messages[].text` is plaintext after remote decryption — safe for host
  rendering because the host already displays public messages.
- `remote.test.ts` asserts the whitelist: the serialized view contains no
  key material or internals.
- Receipt timing (`markDisplayed`) stays a UI act; the server learns nothing
  beyond the opaque envelope.

## Lifecycle mapping (per shell)

Every shell translates its own platform events into the same two commands —
`remote.connect()` / `remote.teardown()`:

| Shell | Connect trigger | Teardown triggers |
|---|---|---|
| PWA | `session.authed` watch | `pagehide`, logout |
| Capacitor (post-MVP) | authed | `App.pause`/`appStateChange`, `beforeunload` fallback, logout |
| Electron (post-MVP) | authed | `before-quit` / renderer `pagehide`, logout |
| Native (post-MVP) | authed | OS suspend/terminate hooks, logout |

Deliberate choices:

- **`pagehide`, not `beforeunload`/`visibilitychange`** — `pagehide` is the
  only reliable unload event on all browsers (iOS Safari skips
  `beforeunload`); `visibilitychange` would kill the session on a plain
  alt-tab.
- **bfcache restore = dead session** — `pagehide` fires on bfcache entry
  and we tear down anyway: coming back means a fresh invite, which is the
  honest zero-trace semantic.
- **Fire-and-forget is not enough for IDB** — `teardown()` is async and the
  browser may kill the renderer before `indexedDB.deleteDatabase` lands.
  `prepareIdentityStore()` in `store.boot()` sweeps any surviving
  `openglass-private` DB on next boot: a DB that exists before boot is by
  definition a dirty leftover, so the identity is wiped and regenerated.
- **Multi-tab** is out of scope for MVP — two tabs share the identity DB;
  a teardown in one kills the other's identity. Documented limitation.

## Bundle boundary

- `createPrivateRemote` lives in the dev-host chunk graph only: `main.ts`
  dynamically imports it inside the `VITE_PRIVATE_MODULE=1 &&
  VITE_API_MODE!=="mock"` gate.
- `apps/pwa/src/privateRemote.ts` imports only the erased types and the
  string key — safe to include in the mvp bundle (verified by
  `check-mvp-bundle`).
- The `PrivateSession` interface, `usePrivateStore`, engine, relay and keys
  modules never enter `apps/pwa`'s static graph.

## Host inventory after migration

No host file references `usePrivateStore` at runtime — `main.ts` builds the
remote via `createPrivateRemoteFor(pinia)` and `privateBoot.ts` types its
wiring as `Pick<PrivateRemote, "connect" | "teardown">`. All views and
components — S10, S11, S11b, S12, `PrivateInviteCard`, S5's private toggle —
consume `PrivateRemote` exclusively.
