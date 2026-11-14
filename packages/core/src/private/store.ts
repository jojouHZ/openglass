// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Volatile private-layer store — pwa-dev only (VITE_PRIVATE_MODULE=1).
 *
 * Zero-trace discipline (docs/api/relay-events.md §Client zero-trace):
 *   - session state, messages and key handles live ONLY in this store's
 *     memory — nothing touches localStorage/sessionStorage/cookies or
 *     any persistence path except the dev-tier IndexedDB identity key;
 *   - teardown() wipes everything and deletes the IndexedDB itself;
 *   - no console.log of blobs, session ids or peer pairing.
 */

import { defineStore } from "pinia";

import {
  decryptEnvelope,
  deriveSessionKey,
  encryptEnvelope,
  fromB64,
  generateSessionKeyPair,
  sasFingerprint,
  toB64,
  type Envelope,
  type SasFingerprint,
  type SessionKeyPair,
} from "./engine";
import { prepareDeviceStore, wipeIdentityStore } from "./keys";
import {
  getOrCreateDeviceIdentity,
  signWithIdentity,
  verifyIdentitySignature,
  type DeviceIdentity,
} from "./identity";
import { IdentityDirectory } from "./directory";
import { getPin, listPins, savePin, type DevicePin } from "./pins";
import { RelayClient, type ConnState, type PeerUser, type RelayEvent } from "./relay";

export type PrivateStatus =
  | "inviting" // we sent relay.invite, waiting for accept
  | "incoming" // we received relay.invite
  | "exchanging" // established, key material in flight
  | "unverified" // session key derived — SAS shown, NOT confirmed
  | "verified" // SAS confirmed out-of-band — the E2EE guarantee applies
  | "closed";

export interface PrivateMessage {
  /** client-generated uuid inside the ciphertext — receipts reference it */
  id: string;
  fromMe: boolean;
  text: string;
  ts: number;
  /** burn-on-read: peer must send a read receipt once displayed */
  viewOnce?: boolean;
  /** receipt sent (for peer's view-once msgs) — purged on view exit */
  read?: boolean;
}

export interface PrivateSession {
  id: string;
  peer: PeerUser;
  status: PrivateStatus;
  strict: boolean;
  burnOnRead: boolean;
  ttlEndsAt: string | null;
  /** peer disconnected — session dies at this ts unless they resume */
  peerOfflineUntil: string | null;
  resumeToken: string | null;
  ownKeys: SessionKeyPair | null;
  /** peer's key arrived before our established finished — process later */
  pendingPeerPub: string | null;
  pendingPeerSig: string | null;
  pendingPeerIdent: string | null;
  sessionKey: CryptoKey | null;
  sas: SasFingerprint | null;
  messages: PrivateMessage[];
  lastSeq: number;
  /** onEstablished is draining pre-session envelopes — live arrivals
   *  must queue instead of jumping the seq watermark */
  draining?: boolean;
}

const te = new TextEncoder();

function encodeEnv(env: Envelope): string {
  return toB64(te.encode(JSON.stringify(env)));
}

function decodeEnv(blob: string): Envelope {
  return JSON.parse(new TextDecoder().decode(fromB64(blob))) as Envelope;
}

export const usePrivateStore = defineStore("private", {
  state: () => ({
    client: null as RelayClient | null,
    sessions: new Map<string, PrivateSession>(),
    /** envelopes that arrived before the session existed locally —
     *  wire seq kept so replay-dedup still applies after the drain */
    pendingEnvelopes: new Map<string, { seq: number; blob: string }[]>(),
    /** our outbound invites by peerId — the pre-ack window between
     *  relay.invite and the server's relay.invited echo. Entries expire
     *  (server invite TTL ≈60 s) so a rejected invite can't leak */
    pendingInvites: new Map<
      string,
      { burnOnRead: boolean; strict: boolean; expiresAt: number }
    >(),
    /** peers whose incoming invite was auto-declined while a live
     *  session existed — volatile UI notes, cleared with the module */
    missedInvites: new Map<string, { peerName: string; at: number }>(),
    /** peers who declined our outgoing invite — busy = they were in a
     *  live session; cleared when we invite that peer again */
    declinedOutgoing: new Map<string, { peerName: string; busy: boolean }>(),
    relayState: "offline" as ConnState,
    reconnectTimer: null as ReturnType<typeof setTimeout> | null,
    reconnectDelay: 1000,
    relayUrl: "",
    getAccessToken: null as null | (() => string | null),
    /** F7 — signed-in user id + this device's ECDSA identity (loaded
     *  once the id is known); pins are cached for synchronous invite
     *  gating. getMeUserId mirrors getAccessToken: the host may not
     *  have a user at boot, so the id is resolved lazily. */
    meUserId: "",
    getMeUserId: null as null | (() => string),
    /** F7 — untrusted key directory transport; injectable for tests.
     *  Publish/revoke only — a directory answer is never a proof of
     *  verification (pins are). directoryBaseUrl survives stop()/boot
     *  cycles so a re-boot can rebuild the client lazily. */
    directory: null as IdentityDirectory | null,
    directoryBaseUrl: "",
    identity: null as DeviceIdentity | null,
    pins: new Map<string, DevicePin>(), // peerUserId → pin
    /** resolves once identity + pin cache are loaded — gates await it */
    ready: null as Promise<void> | null,
    storageWork: null as Promise<void> | null,
    generation: 0,
    /** remote facade listeners — callbacks only, no private data; the
     *  imperative tick keeps host↔remote updates independent of Vue's
     *  deep reactivity across the module boundary */
    listeners: new Set<() => void>(),
  }),

  getters: {
    activeSessions(state): PrivateSession[] {
      return [...state.sessions.values()].filter((s) => s.status !== "closed");
    },
    /** peerIds with an unanswered invite — the "inviting" state (the
     *  pre-ack window or a pending session the server has acked) */
    outgoingInvites(state): string[] {
      const now = Date.now();
      const pending = [...state.pendingInvites]
        .filter(([, v]) => v.expiresAt > now)
        .map(([k]) => k);
      const acked = [...state.sessions.values()]
        .filter((s) => s.status === "inviting")
        .map((s) => s.peer.id);
      return [...new Set([...pending, ...acked])];
    },
    /** live private session with this peer, if any — chatId→session
     *  bridge: the public DM resolves the peer, this resolves the session.
     *  The server allows parallel sessions per pair, so when several
     *  exist prefer the most advanced phase (live > inviting > incoming). */
    sessionByPeer(state): (peerId: string) => PrivateSession | null {
      const rank = (s: PrivateStatus): number =>
        s === "verified" || s === "unverified" || s === "exchanging"
          ? 0
          : s === "inviting"
            ? 1
            : 2;
      return (peerId) => {
        let best: PrivateSession | null = null;
        for (const s of state.sessions.values()) {
          if (s.peer.id !== peerId || s.status === "closed") continue;
          if (!best || rank(s.status) < rank(best.status)) best = s;
        }
        return best;
      };
    },
    /** invites addressed to us, still unanswered — the S5 invite cards */
    incomingInvites(state): PrivateSession[] {
      return [...state.sessions.values()].filter((s) => s.status === "incoming");
    },
    /** a real connection exists — exchanging keys or later. Pending
     *  invites (incoming/outgoing) do NOT count: they are not a
     *  connection, and counting them would let invite spam lock the
     *  owner out of private messaging entirely */
    hasLiveSession(state): boolean {
      return [...state.sessions.values()].some(
        (s) => s.status === "exchanging" || s.status === "unverified" || s.status === "verified",
      );
    },
  },

  actions: {
    /** Wire the relay — called once when the private module boots.
     *  `client` is injectable for tests. */
    boot(
      relayUrl: string,
      getAccessToken: () => string | null,
      client?: RelayClient,
      meUserId: string | (() => string) = "",
      directory?: IdentityDirectory | string,
    ): void {
      if (this.client) return;
      this.relayUrl = relayUrl;
      this.getAccessToken = getAccessToken;
      this.getMeUserId =
        typeof meUserId === "function" ? meUserId : () => meUserId;
      // re-boots (stop→connect, logout→login) call with no directory —
      // keep the injected/base config instead of dropping it
      if (typeof directory === "object" && directory) {
        this.directory = directory;
      } else if (typeof directory === "string") {
        this.directoryBaseUrl = directory;
      }
      this.client = client ?? new RelayClient(relayUrl);
      this.ensureIdentity();
      const c = this.client;
      const on = <T extends RelayEvent["type"]>(type: T, handler: (event: Extract<RelayEvent, { type: T }>) => void) =>
        c.on<T>(type, (event) => { if (this.client === c) handler(event); });

      on("relay.invite", (ev) => {
        // one private connection per client: an incoming invite while a
        // session is live is auto-declined "busy" — the peer is told we
        // cannot join, and the invite never reaches the accept UI (a
        // pending invite must not be able to block or displace the live
        // session — otherwise invite spam becomes a lock-out attack)
        if (this.hasLiveSession) {
          this.missedInvites.set(ev.data.from.id, {
            peerName: ev.data.from.displayName ?? ev.data.from.tag ?? ev.data.from.id,
            at: Date.now(),
          });
          c.decline(ev.data.sessionId, "busy");
          this.notify();
          return;
        }
        const s: PrivateSession = {
          id: ev.data.sessionId,
          peer: ev.data.from,
          status: "incoming",
          strict: ev.data.strict,
          burnOnRead: ev.data.burnOnRead,
          ttlEndsAt: null,
          peerOfflineUntil: null,
          resumeToken: null,
          ownKeys: null,
          pendingPeerPub: null,
          pendingPeerSig: null,
          pendingPeerIdent: null,
          sessionKey: null,
          sas: null,
          messages: [],
          lastSeq: 0,
        };
        this.sessions.set(s.id, s);
        this.notify();
      });

      // ack: server accepted our invite — the session now has a real
      // id, so declined/expired frames correlate by sessionId
      on("relay.invited", (ev) => {
        const existing = this.sessions.get(ev.data.sessionId);
        // dup/late ack after establishment must not regress the status
        if (existing && existing.status !== "inviting") return;
        const flags = this.pendingInvites.get(ev.data.to.id);
        this.pendingInvites.delete(ev.data.to.id);
        const s: PrivateSession = {
          id: ev.data.sessionId,
          peer: ev.data.to,
          status: "inviting",
          strict: ev.data.strict ?? flags?.strict ?? false,
          burnOnRead: ev.data.burnOnRead ?? flags?.burnOnRead ?? false,
          ttlEndsAt: null,
          peerOfflineUntil: null,
          resumeToken: null,
          ownKeys: null,
          pendingPeerPub: null,
          pendingPeerSig: null,
          pendingPeerIdent: null,
          sessionKey: null,
          sas: null,
          messages: [],
          lastSeq: 0,
        };
        this.sessions.set(s.id, s);
        this.notify();
      });

      on("relay.established", (ev) => {
        if (!this.sessions.has(ev.data.sessionId) && !this.pendingInvites.has(ev.data.peer.id)) {
          c.burn(ev.data.sessionId);
          return;
        }
        void this.onEstablished(ev.data);
      });

      on("relay.declined", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) {
          this.declinedOutgoing.set(s.peer.id, {
            peerName: s.peer.displayName ?? s.peer.tag ?? s.peer.id,
            busy: ev.data.reason === "busy",
          });
        }
        this.dropSession(ev.data.sessionId);
      });

      on("relay.msg", (ev) => {
        void this.onMessage(ev.data.sessionId, ev.data.msgSeq, ev.data.blob);
      });

      on("relay.error", () => {
        // quota/not_found/etc — surfaced via session state, not logged:
        // error.code contains no private content
      });

      on("relay.peer-offline", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) {
          s.peerOfflineUntil = ev.data.graceEndsAt;
          this.notify();
        }
      });

      on("relay.peer-online", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) {
          s.peerOfflineUntil = null;
          this.notify();
        }
      });

      on("relay.closed", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) {
          s.status = "closed";
          this.wipeSessionSecrets(s);
        } else {
          this.sessions.delete(ev.data.sessionId);
        }
        this.pendingEnvelopes.delete(ev.data.sessionId);
        this.notify();
      });

      c.onStateChange((s) => {
        if (this.client !== c) return;
        this.relayState = s;
        if (s === "online") this.reconnectDelay = 1000;
        if (s === "offline") this.scheduleReconnect();
        this.notify();
      });
    },

    /** Load identity + pin cache once the signed-in user id is known.
     *  Identity and pins survive ordinary restarts; storage work is
     *  serialized so a previous logout finishes before loading. Re-runs
     *  when the id changes (login as another user) — the generation
     *  guard stops a stale async load from resurrecting the previous
     *  owner's state. Gates must not see a half-loaded store: an invite
     *  fired before this resolves would wrongly fail the pin check, so
     *  pin-gated paths await this.ready first. */
    ensureIdentity(): void {
      const uid = this.getMeUserId?.() ?? "";
      if (!uid || uid === this.meUserId || !this.client) return;
      const generation = ++this.generation;
      const previousWork = this.storageWork;
      this.meUserId = uid;
      this.identity = null;
      this.pins.clear();
      this.ready = (async () => {
        try {
          await previousWork;
          if (generation !== this.generation) return;
          await prepareDeviceStore();
          const identity = await getOrCreateDeviceIdentity(uid);
          const pins = await listPins(uid);
          if (generation !== this.generation) return;
          this.identity = identity;
          this.pins = new Map(pins.map((p) => [p.peerUserId, p]));
          // best-effort idempotent publish — peers need our public key to
          // pin it; a failure retries on the next boot. Nothing private
          // leaves the device: keyId is a digest of the public SPKI.
          // Lazily build the transport when only a base URL was given.
          this.directory ??= this.directoryBaseUrl
            ? new IdentityDirectory(this.directoryBaseUrl, this.getAccessToken!)
            : null;
          void this.directory
            ?.publish({ keyId: identity.keyId, publicKey: identity.pubB64 })
            .catch(() => undefined);
        } finally {
          this.notify();
        }
      })();
      this.storageWork = this.ready;
      void this.ready.catch(() => undefined);
    },

    /** Connect the relay — failures surface via relayState, never throw.
     *  Self-heals after teardown(): the SPA keeps running across a
     *  logout→login cycle, so a null client is rebuilt and re-wired. */
    connect(): void {
      if (!this.client && this.relayUrl && this.getAccessToken) {
        this.boot(this.relayUrl, this.getAccessToken, undefined, this.getMeUserId ?? "");
      }
      this.ensureIdentity();
      const token = this.getAccessToken?.();
      if (!this.client || !token) return;
      void this.client.connect(token).catch(() => undefined);
    },

    /** Exponential backoff reconnect — skipped while torn down or
     *  while a retry is already armed. */
    scheduleReconnect(): void {
      if (this.reconnectTimer || !this.client || !this.getAccessToken?.()) {
        return;
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (this.client) this.connect();
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    },

    /** Remote-facing change tick — the facade rebuilds host-safe
     *  snapshots on each call. Invoked after every mutation below. */
    notify(): void {
      for (const fn of this.listeners) fn();
    },
    /** Subscribe to mutations — the remote facade's only inlet. */
    onChange(fn: () => void): () => void {
      this.listeners.add(fn);
      return () => {
        this.listeners.delete(fn);
      };
    },
    /** F7 directory reads — the peer's published PUBLIC keys. A directory
     *  answer is data for the ritual, never a proof: only a confirmed pin
     *  gates sessions. Missing directory → empty (fail closed). */
    async listPeerKeys(peerId: string) {
      return (await this.directory?.listPeer(peerId)) ?? [];
    },

    /** Ritual confirmation — persist the verified device pin for the
     *  signed-in user and refresh the sync gate cache. */
    addPin(pin: DevicePin): Promise<void> {
      const owner = this.meUserId;
      const generation = this.generation;
      if (!owner || !this.identity || !this.client) return Promise.resolve();
      const previousWork = this.storageWork;
      const work = (async () => {
        await previousWork;
        if (generation !== this.generation || owner !== this.meUserId) return;
        await savePin(owner, pin);
        if (generation !== this.generation || owner !== this.meUserId) return;
        this.pins.set(pin.peerUserId, pin);
        this.notify();
      })();
      this.storageWork = work;
      return work;
    },

    /** S10 cancel — drop the pre-ack invite marker; no relay frame
     *  exists for cancellation, the server-side invite dies on its TTL. */
    cancelInvite(peerId: string): void {
      this.pendingInvites.delete(peerId);
      this.notify();
    },

    /** Inviter flow — S10. The session appears on relay.established;
     *  our own flags travel via pendingInvites (the contract doesn't
     *  echo them back to the inviter). */
    /** F7 gate — a private session may be offered only to a peer whose
     *  device we have pinned out-of-band. Unpinned → the call is a
     *  no-op; the host shows the lock instead (never a silent wire send). */
    async pinned(peerId: string): Promise<boolean> {
      await this.ready;
      return this.pins.has(peerId);
    },

    startInvite(
      peer: PeerUser,
      opts: { ttlSeconds?: number; burnOnRead?: boolean; strict?: boolean } = {},
    ): void {
      const generation = this.generation;
      const client = this.client;
      void (async () => {
        if (!(await this.pinned(peer.id)) || generation !== this.generation || this.client !== client) return;
        // a stale invite elsewhere must never materialize into a second
        // live session later — silently drop our other pending invites
        this.cancelOutgoingExcept(peer.id);
        this.declinedOutgoing.delete(peer.id); // retry clears the note
        // server invite TTL is 60 s — if relay.invited never arrives the
        // invite was rejected and this marker must die with it
        this.pendingInvites.set(peer.id, {
          burnOnRead: opts.burnOnRead ?? false,
          strict: opts.strict ?? false,
          expiresAt: Date.now() + 70_000,
        });
        this.client?.invite(peer.id, opts);
        this.notify();
      })();
    },

    accept(sessionId: string): void {
      const generation = this.generation;
      const client = this.client;
      void (async () => {
        const s = this.sessions.get(sessionId);
        if (!s || !(await this.pinned(s.peer.id)) || generation !== this.generation || this.client !== client || this.sessions.get(sessionId) !== s) return;
        // fail closed on the one-connection rule: a live session may
        // have appeared after the invite arrived — decline busy instead
        // of stacking a second connection
        if (this.hasLiveSession) {
          this.missedInvites.set(s.peer.id, {
            peerName: s.peer.displayName ?? s.peer.tag ?? s.peer.id,
            at: Date.now(),
          });
          this.decline(sessionId, "busy");
          return;
        }
        this.cancelOutgoingExcept(s.peer.id);
        this.client?.accept(sessionId);
      })();
    },
    decline(sessionId: string, reason?: "busy"): void {
      this.client?.decline(sessionId, reason);
      this.dropSession(sessionId);
    },

    /** Drop our pending outgoing invites to every peer except `keep` —
     *  the wire has no cancel frame; server-side invites die on their
     *  TTL or fail closed via the established-check. */
    cancelOutgoingExcept(keepPeerId: string): void {
      for (const peerId of [...this.pendingInvites.keys()]) {
        if (peerId !== keepPeerId) this.pendingInvites.delete(peerId);
      }
      for (const s of [...this.sessions.values()]) {
        if (s.status === "inviting" && s.peer.id !== keepPeerId) this.sessions.delete(s.id);
      }
    },

    /** established for BOTH sides. Re-emitted by the server on every
     *  auth — a reconnecting client keeps its live RAM keys (the channel
     *  survives); only a session with no key material generates a pair. */
    async onEstablished(d: {
      sessionId: string;
      peer: PeerUser;
      resumeToken: string;
      ttlEndsAt: string;
    }): Promise<void> {
      const generation = this.generation;
      const client = this.client;
      const existing = this.sessions.get(d.sessionId);
      const invited = this.pendingInvites.get(d.peer.id);
      const s: PrivateSession = existing ?? {
        id: d.sessionId,
        peer: d.peer,
        status: "exchanging",
        strict: invited?.strict ?? false,
        burnOnRead: invited?.burnOnRead ?? false,
        ttlEndsAt: null,
        peerOfflineUntil: null,
        resumeToken: null,
        ownKeys: null,
        pendingPeerPub: null,
        pendingPeerSig: null,
        pendingPeerIdent: null,
        sessionKey: null,
        sas: null,
        messages: [],
        lastSeq: 0,
      };
      this.pendingInvites.delete(d.peer.id);
      s.peer = d.peer;
      s.resumeToken = d.resumeToken;
      s.ttlEndsAt = d.ttlEndsAt;
      if (s.status !== "verified") s.status = "exchanging";
      this.sessions.set(d.sessionId, s);
      this.notify();
      // crypto awaits interleave with live traffic — while draining,
      // onMessage must keep queueing or the seq watermark would skip
      // ahead of the buffered envelopes and drop them
      s.draining = true;
      try {
        if (!s.ownKeys) {
          const own = await generateSessionKeyPair();
          if (generation !== this.generation || this.client !== client || this.sessions.get(d.sessionId) !== s || (s.status as PrivateStatus) === "closed") return;
          s.ownKeys = own;
          await this.ready;
          if (generation !== this.generation || this.client !== client || !s.ownKeys) return;
          // handshake v2 — sign the ephemeral pub with this device's
          // identity; the peer verifies it against their pin of us
          const env: Envelope = { t: "key", k: own.rawPub };
          if (this.identity) {
            env.i = this.identity.pubB64;
            env.s = await signWithIdentity(this.identity, fromB64(own.rawPub));
          }
          if (generation !== this.generation || this.client !== client || !s.ownKeys) return;
          client?.sendEnvelope(d.sessionId, encodeEnv(env));
        }
        // envelopes may have arrived before the session existed locally —
        // drain in wire order (key envelope first, then msgs); arrivals
        // during the drain re-queue via onMessage's draining check, so
        // loop until the buffer stays empty
        for (;;) {
          if (generation !== this.generation || this.client !== client) return;
          const queued = this.pendingEnvelopes.get(d.sessionId) ?? [];
          this.pendingEnvelopes.delete(d.sessionId);
          if (!queued.length) break;
          for (const e of queued) {
            await this.deliverEnvelope(s, e.seq, e.blob);
          }
        }
      } finally {
        s.draining = false;
      }
      if (generation !== this.generation || this.client !== client || this.sessions.get(d.sessionId) !== s) return;
      // peer's key may have arrived while our pair was generating
      if (s.pendingPeerPub) {
        await this.onPeerKey(d.sessionId, s.pendingPeerPub, s.pendingPeerSig ?? undefined, s.pendingPeerIdent ?? undefined);
      }
      if (generation !== this.generation || this.client !== client || this.sessions.get(d.sessionId) !== s) return;
      this.notify();
      // reconnect path — drain anything buffered for us
      this.client?.resume(d.sessionId, d.resumeToken);
    },

    /** Handshake v2 — the peer's ephemeral key arrives signed by THEIR
     *  device identity. Pinned pair: pin.publicKey === claimed identity
     *  AND the signature verifies → session is `verified` by
     *  construction (the ritual already happened, per device pair).
     *  Anything else — unsigned, forged, unpinned, key-changed — closes
     *  the session; there is no unverified state left to abuse. */
    async onPeerKey(
      sessionId: string,
      peerRawPub: string,
      peerSig?: string,
      peerIdent?: string,
    ): Promise<void> {
      const s = this.sessions.get(sessionId);
      if (!s?.ownKeys) return;
      const generation = this.generation;
      const ownKeys = s.ownKeys;
      s.pendingPeerPub = null;
      s.pendingPeerSig = null;
      s.pendingPeerIdent = null;
      const pin = this.pins.get(s.peer.id) ?? (await getPin(this.meUserId, s.peer.id));
      const ok =
        !!pin &&
        !!peerIdent &&
        pin.publicKey === peerIdent &&
        !!peerSig &&
        (await verifyIdentitySignature(peerIdent, fromB64(peerRawPub), peerSig));
      if (generation !== this.generation || this.sessions.get(sessionId) !== s || s.ownKeys !== ownKeys) return;
      if (!ok) {
        s.status = "closed";
        this.wipeSessionSecrets(s);
        this.notify();
        return;
      }
      const sessionKey = await deriveSessionKey(ownKeys, peerRawPub);
      const sas = await sasFingerprint(ownKeys.rawPub, peerRawPub);
      if (generation !== this.generation || this.sessions.get(sessionId) !== s || s.ownKeys !== ownKeys || s.status === "closed") return;
      s.sessionKey = sessionKey;
      s.sas = sas;
      s.status = "verified";
      this.notify();
    },

    async onMessage(sessionId: string, seq: number, blob: string): Promise<void> {
      const s = this.sessions.get(sessionId);
      if (!s || s.draining) {
        const q = this.pendingEnvelopes.get(sessionId) ?? [];
        q.push({ seq, blob });
        this.pendingEnvelopes.set(sessionId, q);
        return;
      }
      await this.deliverEnvelope(s, seq, blob);
    },

    /** Wire→session delivery; callers queue via onMessage when the
     *  session isn't ready (absent or mid-establishment drain). */
    async deliverEnvelope(
      s: PrivateSession,
      seq: number,
      blob: string,
    ): Promise<void> {
      const sessionId = s.id;
      const generation = this.generation;
      // server msgSeq is per-session monotonic; resume can replay the
      // buffered tail — drop anything at-or-below the watermark
      if (seq <= s.lastSeq) return;
      s.lastSeq = seq;
      let env: Envelope;
      try {
        env = decodeEnv(blob);
      } catch {
        return; // malformed base64/JSON — drop like bad ciphertext
      }
      if (env.t === "key") {
        if (!s.ownKeys) {
          s.pendingPeerPub = env.k;
          s.pendingPeerSig = env.s ?? null;
          s.pendingPeerIdent = env.i ?? null;
          return;
        }
        await this.onPeerKey(sessionId, env.k, env.s, env.i);
        return;
      }
      if (env.t === "msg" && s.sessionKey) {
        try {
          const p = await decryptEnvelope(s.sessionKey, env);
          if (generation !== this.generation || this.sessions.get(sessionId) !== s || !s.sessionKey) return;
          if (p.k === "r") {
            // peer read our view-once messages — burn our copies now
            const ids = new Set(p.ids);
            s.messages = s.messages.filter((m) => !(m.fromMe && ids.has(m.id)));
            this.notify();
            return;
          }
          s.messages.push({
            id: p.id,
            fromMe: false,
            text: p.text,
            ts: Date.now(),
            viewOnce: p.bor || undefined,
          });
          this.notify();
        } catch {
          // undecryptable envelope — stale key after a re-keyed resume,
          // or a forged blob. Drop, don't surface: plaintext safety first.
        }
      }
    },

    /** S12 send — requires a derived session key (unverified OK to send? —
     *  yes, but the UI must show the session as unverified). */
    async send(
      sessionId: string,
      text: string,
      opts: { viewOnce?: boolean } = {},
    ): Promise<void> {
      const s = this.sessions.get(sessionId);
      if (!s?.sessionKey || !this.client) throw new Error("no session key");
      const generation = this.generation;
      const client = this.client;
      const id = crypto.randomUUID();
      const env = await encryptEnvelope(s.sessionKey, {
        k: "t",
        id,
        text,
        bor: opts.viewOnce || undefined,
      });
      if (generation !== this.generation || this.client !== client || this.sessions.get(sessionId) !== s || !s.sessionKey) {
        throw new Error("session ended during send");
      }
      client.sendEnvelope(sessionId, encodeEnv(env));
      s.messages.push({
        id,
        fromMe: true,
        text,
        ts: Date.now(),
        viewOnce: opts.viewOnce || undefined,
      });
      this.notify();
    },

    /** The UI displayed these messages — receipt the peer's view-once
     *  ones. Called from S12 render, NOT from decrypt: a receipt means
     *  "human saw it", and the server must not learn read timing. */
    markDisplayed(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (!s?.sessionKey || !this.client) return;
      const ids: string[] = [];
      for (const m of s.messages) {
        if (!m.fromMe && m.viewOnce && !m.read) {
          m.read = true;
          ids.push(m.id);
        }
      }
      if (!ids.length) return;
      this.notify();
      const generation = this.generation;
      const client = this.client;
      void encryptEnvelope(s.sessionKey, { k: "r", ids })
        .then((env) => {
          if (generation === this.generation && this.client === client && this.sessions.get(sessionId) === s && s.sessionKey) {
            client.sendEnvelope(sessionId, encodeEnv(env));
          }
        })
        .catch(() => undefined); // receipt loss → sender keeps its copy;
      // ours is still purged on view exit — degraded, not broken
    },

    /** S12 unmount — purge peer's view-once messages we already read.
     *  View-once means once: leaving the screen is the second view. */
    purgeRead(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      s.messages = s.messages.filter((m) => !(m.viewOnce && m.read));
      this.notify();
    },

    /** User compared the emoji grid out-of-band — NOW the guarantee holds. */
    markVerified(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (s?.sessionKey) {
        s.status = "verified";
        this.notify();
      }
    },

    burn(sessionId: string): void {
      this.client?.burn(sessionId);
      const s = this.sessions.get(sessionId);
      if (s) {
        s.status = "closed";
        this.wipeSessionSecrets(s);
      }
      this.notify();
    },

    resume(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (s?.resumeToken) this.client?.resume(sessionId, s.resumeToken);
    },

    /** Zero-trace: erase secrets from one session. */
    wipeSessionSecrets(s: PrivateSession): void {
      s.ownKeys = null;
      s.pendingPeerPub = null;
      s.pendingPeerSig = null;
      s.pendingPeerIdent = null;
      s.sessionKey = null;
      s.sas = null;
      s.messages = [];
      s.resumeToken = null;
    },

    dropSession(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (s) this.wipeSessionSecrets(s);
      this.sessions.delete(sessionId);
      this.pendingEnvelopes.delete(sessionId);
      this.notify();
    },

    /**
     * Stop the module: wipe volatile sessions and disconnect the relay.
     * Persistent identity and pins remain until destructive teardown.
     * Pending initialization cannot repopulate the stopped module.
     */
    stop(): void {
      this.generation++;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const c = this.client;
      this.client = null; // detach first — disconnect's offline callback
      // must not schedule a reconnect for a dead module
      c?.disconnect();
      for (const s of this.sessions.values()) this.wipeSessionSecrets(s);
      this.sessions.clear();
      this.pendingEnvelopes.clear();
      this.pendingInvites.clear();
      this.missedInvites.clear();
      this.declinedOutgoing.clear();
      this.identity = null;
      this.pins.clear();
      this.meUserId = "";
      this.ready = null;
      this.relayState = "offline";
      this.notify();
    },

    teardown(): Promise<void> {
      // capture before stop() nulls the identity — forget-device must
      // also unpublish the key; best-effort: the token may already be
      // gone, so a failed revoke still proceeds to the local wipe
      const keyId = this.identity?.keyId;
      const directory =
        this.directory ??
        (this.directoryBaseUrl && this.getAccessToken
          ? new IdentityDirectory(this.directoryBaseUrl, this.getAccessToken)
          : null);
      this.directory = null;
      this.stop();
      const previousWork = this.storageWork;
      const cleanup = (async () => {
        await previousWork?.catch(() => undefined);
        if (directory && keyId) {
          await directory.revoke(keyId).catch(() => undefined);
        }
        await wipeIdentityStore();
      })();
      this.storageWork = cleanup;
      return cleanup;
    },
  },
});
