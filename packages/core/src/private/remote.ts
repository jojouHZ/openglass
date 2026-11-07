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

import { sasFingerprint, type SasFingerprint } from "./engine";
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
  /** SAS fingerprint for out-of-band comparison — symbol indexes into the
   *  shell's object set plus a digit code; display data only. */
  sas: SasFingerprint | null;
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

/** UI-safe view of one of the peer's published device keys — public
 *  directory data only; pins and key material stay inside the core. */
export interface VerificationDeviceView {
  keyId: string;
  publicKey: string;
  label: string | null;
}

/** UI-safe snapshot of a device-verification ritual for one peer. */
export interface VerificationView {
  peerId: string;
  /** unverified: no pin; pending: ritual open, awaiting OOB confirm;
   *  verified: confirmed pin matches the shown key; key-changed: the
   *  shown key differs from the existing pin — re-verification needed */
  state: "unverified" | "pending" | "verified" | "key-changed";
  /** SAS-style fingerprint over both identity public keys — display
   *  data only, for out-of-band comparison */
  fingerprint: SasFingerprint | null;
  devices: readonly VerificationDeviceView[];
}

/** Everything a host may ask of the private module. */
export interface PrivateRemote {
  // lifecycle — the host owns platform lifecycle (pagehide, app pause,
  // logout) and maps it to these commands; the core never touches
  // window/document itself, so every shell can drive the same contract.
  boot(
    relayUrl: string,
    getAccessToken: () => string | null,
    meUserId?: string | (() => string),
    /** REST base for the identity-key directory (e.g. "/api/v1"); the
     *  transport is built inside the core — the host never sees it */
    apiBaseUrl?: string,
  ): void;
  connect(): void;
  stop(): void;
  /** Forget device trust: wipe volatile state, disconnect and delete
   *  the IndexedDB identity store. Ordinary pagehide uses stop instead. */
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

  // device verification (F7) — the ritual lives in the ordinary chat
  // window; the host renders safe snapshots, the core owns pins
  /** Snapshot per peer: pin state, published device keys, ritual
   *  fingerprint. Emits immediately and on every mutation. */
  watchVerification(
    peerId: string,
    cb: (view: VerificationView) => void,
  ): () => void;
  /** Fetch the peer's published keys and open the ritual for `keyId`
   *  (defaults to the first key). Computes the OOB fingerprint. */
  startVerification(peerId: string, keyId?: string): Promise<void>;
  /** OOB comparison succeeded — persist the pin for the shown key. */
  confirmVerification(peerId: string): Promise<void>;
  /** OOB comparison failed or aborted — discard the pending ritual. */
  rejectVerification(peerId: string): void;
  /** All live private sessions as safe views. */
  watchActiveSessions(
    cb: (views: PrivateSessionView[]) => void,
  ): () => void;
  /** Forget this device: revoke the published key, wipe identity, pins
   *  and volatile state. Same destructive path as logout. */
  forgetDevice(): Promise<void>;
}

function toSessionView(
  s: PrivateSession | null | undefined,
): PrivateSessionView | null {
  if (!s) return null;
  return {
    sessionId: s.id,
    peerId: s.peer.id,
    status: s.status,
    sas: s.sas
      ? { symbols: [...s.sas.symbols], digits: s.sas.digits }
      : null,
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
  const verifSubs = new Map<
    string,
    Set<(view: VerificationView) => void>
  >();
  const activeSubs = new Set<(views: PrivateSessionView[]) => void>();
  /** per-peer open ritual — the device key being compared and its
   *  fingerprint; discarded by confirm/reject */
  const verifPending = new Map<string, { keyId: string; publicKey: string }>();
  const verifFingerprint = new Map<string, SasFingerprint>();
  const verifDevices = new Map<string, VerificationDeviceView[]>();

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

  function verificationView(peerId: string): VerificationView {
    const pin = store.pins.get(peerId);
    const pending = verifPending.get(peerId);
    let state: VerificationView["state"] = "unverified";
    if (pending) {
      state = !pin
        ? "pending"
        : pin.publicKey === pending.publicKey
          ? "verified"
          : "key-changed";
    } else if (pin) {
      state = "verified";
    }
    return {
      peerId,
      state,
      fingerprint: verifFingerprint.get(peerId) ?? null,
      devices: verifDevices.get(peerId) ?? [],
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
    for (const [peerId, subs] of verifSubs) {
      const view = verificationView(peerId);
      for (const cb of subs) cb(view);
    }
    const active = store.activeSessions.map((s) => toSessionView(s)!);
    for (const cb of activeSubs) cb(active);
  }

  store.onChange(emit);

  return {
    boot(relayUrl, getAccessToken, meUserId, apiBaseUrl) {
      store.boot(
        relayUrl,
        getAccessToken,
        undefined,
        meUserId,
        apiBaseUrl ?? undefined,
      );
    },
    connect() {
      store.connect();
    },
    stop() {
      store.stop();
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

    watchVerification(peerId, cb) {
      let subs = verifSubs.get(peerId);
      if (!subs) {
        subs = new Set();
        verifSubs.set(peerId, subs);
      }
      subs.add(cb);
      cb(verificationView(peerId));
      return () => {
        subs.delete(cb);
        if (!subs.size) verifSubs.delete(peerId);
      };
    },
    async startVerification(peerId, keyId) {
      await store.ready;
      const keys = await store.listPeerKeys(peerId);
      verifDevices.set(
        peerId,
        keys.map((k) => ({
          keyId: k.keyId,
          publicKey: k.publicKey,
          label: k.label ?? null,
        })),
      );
      const key = keyId ? keys.find((k) => k.keyId === keyId) : keys[0];
      if (key && store.identity) {
        verifPending.set(peerId, {
          keyId: key.keyId,
          publicKey: key.publicKey,
        });
        verifFingerprint.set(
          peerId,
          await sasFingerprint(store.identity.pubB64, key.publicKey),
        );
      }
      emit();
    },
    async confirmVerification(peerId) {
      const pending = verifPending.get(peerId);
      if (!pending) return;
      await store.ready;
      await store.addPin({
        peerUserId: peerId,
        keyId: pending.keyId,
        publicKey: pending.publicKey,
        verifiedAt: new Date().toISOString(),
      });
      verifPending.delete(peerId);
      emit();
    },
    rejectVerification(peerId) {
      verifPending.delete(peerId);
      verifFingerprint.delete(peerId);
      emit();
    },
    watchActiveSessions(cb) {
      activeSubs.add(cb);
      cb(store.activeSessions.map((s) => toSessionView(s)!));
      return () => activeSubs.delete(cb);
    },
    forgetDevice() {
      return store.teardown();
    },
  };
}

/** Composition-root helper — the host builds the remote through this
 *  factory and never holds the store instance at all. */
export function createPrivateRemoteFor(pinia: Pinia): PrivateRemote {
  return createPrivateRemote(usePrivateStore(pinia));
}
