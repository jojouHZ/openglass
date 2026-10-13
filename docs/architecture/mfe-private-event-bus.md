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
(`"og.private"`, exported from `@openglass/core`):

```ts
app.provide(PRIVATE_REMOTE_KEY, createPrivateRemote(priv));
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

`usePrivateStore` remains referenced only in `main.ts` (bootstrap owner) and
`privateBoot.ts` (`import type`, lifecycle wiring). All views and components
— S10, S11, S11b, S12, `PrivateInviteCard`, S5's private toggle — consume
`PrivateRemote` exclusively.
