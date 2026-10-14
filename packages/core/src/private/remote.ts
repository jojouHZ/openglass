// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PrivateRemote — the typed host↔remote boundary for the private layer.
 *
 * The PWA host must never reach into `usePrivateStore`: session keys,
 * pending key material, resume tokens and raw relay envelopes stay
 * inside the core module. The host receives immutable UI snapshots —
 * already-decrypted display payloads only — and sends commands back
 * through this interface (see docs/architecture/mfe-private-event-bus.md).
 *
 * Snapshots are emitted imperatively: `store.notify()` ticks after every
 * mutation. Host↔remote updates deliberately do NOT depend on Vue deep
 * reactivity across the module boundary.
 */

import type { Pinia } from "pinia";

import type { ConnState, PeerUser } from "./relay";
import {
  usePrivateStore,
  type PrivateSession,
  type PrivateStatus,
} from "./store";

export type { PrivateStatus } from "./store";
export type { ConnState, PeerUser } from "./relay";

export type PrivateStoreInstance = ReturnType<typeof usePrivateStore>;

/** UI-safe snapshot of one private message — no crypto material. */
export interface PrivateMessageView {
  id: string;
  fromMe: boolean;
  text: string;
  ts: number;
  viewOnce: boolean;
  read: boolean;
}

/** UI-safe snapshot of a private session — whitelist-mapped from the
 *  internal PrivateSession; `sessionKey`, `ownKeys`, `pendingPeerPub`,
 *  `resumeToken` and `lastSeq` never cross the boundary. */
export interface PrivateSessionView {
  sessionId: string;
  peerId: string;
  status: PrivateStatus;
  /** SAS emoji grid for out-of-band comparison — display strings only. */
  sas: readonly string[] | null;
  messages: readonly PrivateMessageView[];
  ttlEndsAt: string | null;
  peerOfflineUntil: string | null;
  /** A session key exists — the composer may send. The CryptoKey
   *  itself never crosses this boundary. */
  canSend: boolean;
}

export interface PrivateInviteView {
  sessionId: string;
  peerId: string;
  peerName: string;
  strict: boolean;
  burnOnRead: boolean;
}

export interface PrivateInvitesView {
  /** invites addressed to us, still unanswered */
  incoming: readonly PrivateInviteView[];
  /** peerIds with our unanswered outgoing invite */
  outgoing: readonly string[];
}

/** Everything a host may ask of the private module. */
export interface PrivateRemote {
  // lifecycle — the host owns platform lifecycle (pagehide, app pause,
  // logout) and maps it to these commands; the core never touches
  // window/document itself, so every shell can drive the same contract.
  boot(relayUrl: string, getAccessToken: () => string | null): void;
  connect(): void;
  /** zero-trace: wipe all volatile state, disconnect, delete the
   *  IndexedDB identity store. Fire-and-forget on pagehide. */
  teardown(): Promise<void>;

  /** Subscribe to the session view for a peer — immediate snapshot plus
   *  every subsequent mutation. Returns an unsubscribe handle. */
  watchSession(
    peerId: string,
    cb: (view: PrivateSessionView | null) => void,
  ): () => void;
  watchInvites(cb: (view: PrivateInvitesView) => void): () => void;
  watchRelayState(cb: (state: ConnState) => void): () => void;

  // commands — the host may ask, never inspect
  startInvite(
    peer: PeerUser,
    opts?: { ttlSeconds?: number; burnOnRead?: boolean; strict?: boolean },
  ): void;
  cancelInvite(peerId: string): void;
  accept(sessionId: string): void;
  decline(sessionId: string): void;
  confirmSas(sessionId: string): void;
  burn(sessionId: string): void;
  send(
    sessionId: string,
    text: string,
    opts?: { viewOnce?: boolean },
  ): Promise<void>;
  markDisplayed(sessionId: string): void;
  purgeRead(sessionId: string): void;
}

function toSessionView(
  s: PrivateSession | null | undefined,
): PrivateSessionView | null {
  if (!s) return null;
  return {
    sessionId: s.id,
    peerId: s.peer.id,
    status: s.status,
    sas: s.sas ? [...s.sas] : null,
    messages: s.messages.map((m) => ({
      id: m.id,
      fromMe: m.fromMe,
      text: m.text,
      ts: m.ts,
      viewOnce: !!m.viewOnce,
      read: !!m.read,
    })),
    ttlEndsAt: s.ttlEndsAt,
    peerOfflineUntil: s.peerOfflineUntil,
    canSend: !!s.sessionKey,
  };
}

/** Wrap the private store in the host-facing contract. */
export function createPrivateRemote(
  store: PrivateStoreInstance,
): PrivateRemote {
  const sessionSubs = new Map<
    string,
    Set<(view: PrivateSessionView | null) => void>
  >();
  const inviteSubs = new Set<(view: PrivateInvitesView) => void>();
  const relaySubs = new Set<(state: ConnState) => void>();

  function invitesView(): PrivateInvitesView {
    return {
      incoming: store.incomingInvites.map((s) => ({
        sessionId: s.id,
        peerId: s.peer.id,
        peerName: s.peer.displayName ?? s.peer.tag ?? s.peer.id,
        strict: s.strict,
        burnOnRead: s.burnOnRead,
      })),
      outgoing: [...store.outgoingInvites],
    };
  }

  function emit(): void {
    for (const [peerId, subs] of sessionSubs) {
      const view = toSessionView(store.sessionByPeer(peerId));
      for (const cb of subs) cb(view);
    }
    const invites = invitesView();
    for (const cb of inviteSubs) cb(invites);
    for (const cb of relaySubs) cb(store.relayState);
  }

  store.onChange(emit);

  return {
    boot(relayUrl, getAccessToken) {
      store.boot(relayUrl, getAccessToken);
    },
    connect() {
      store.connect();
    },
    teardown() {
      return store.teardown();
    },
    watchSession(peerId, cb) {
      let subs = sessionSubs.get(peerId);
      if (!subs) {
        subs = new Set();
        sessionSubs.set(peerId, subs);
      }
      subs.add(cb);
      cb(toSessionView(store.sessionByPeer(peerId)));
      return () => {
        subs.delete(cb);
        if (!subs.size) sessionSubs.delete(peerId);
      };
    },
    watchInvites(cb) {
      inviteSubs.add(cb);
      cb(invitesView());
      return () => inviteSubs.delete(cb);
    },
    watchRelayState(cb) {
      relaySubs.add(cb);
      cb(store.relayState);
      return () => relaySubs.delete(cb);
    },

    startInvite(peer, opts) {
      store.startInvite(peer, opts);
    },
    cancelInvite(peerId) {
      store.cancelInvite(peerId);
    },
    accept(sessionId) {
      store.accept(sessionId);
    },
    decline(sessionId) {
      store.decline(sessionId);
    },
    confirmSas(sessionId) {
      store.markVerified(sessionId);
    },
    burn(sessionId) {
      store.burn(sessionId);
    },
    send(sessionId, text, opts) {
      return store.send(sessionId, text, opts);
    },
    markDisplayed(sessionId) {
      store.markDisplayed(sessionId);
    },
    purgeRead(sessionId) {
      store.purgeRead(sessionId);
    },
  };
}

/** Composition-root helper — the host builds the remote through this
 *  factory and never holds the store instance at all. */
export function createPrivateRemoteFor(pinia: Pinia): PrivateRemote {
  return createPrivateRemote(usePrivateStore(pinia));
}
