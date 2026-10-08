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
  type SessionKeyPair,
} from "./engine";
import { wipeIdentityStore } from "./keys";
import { RelayClient, type ConnState, type PeerUser } from "./relay";

export type PrivateStatus =
  | "inviting" // we sent relay.invite, waiting for accept
  | "incoming" // we received relay.invite
  | "exchanging" // established, key material in flight
  | "unverified" // session key derived — SAS shown, NOT confirmed
  | "verified" // SAS confirmed out-of-band — the E2EE guarantee applies
  | "closed";

export interface PrivateMessage {
  id: string;
  fromMe: boolean;
  text: string;
  ts: number;
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
  sessionKey: CryptoKey | null;
  sas: string[] | null;
  messages: PrivateMessage[];
  lastSeq: number;
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
    /** envelopes that arrived before the session existed locally */
    pendingEnvelopes: new Map<string, string[]>(),
    /** our outbound invites by peerId — the pre-ack window between
     *  relay.invite and the server's relay.invited echo. Entries expire
     *  (server invite TTL ≈60 s) so a rejected invite can't leak */
    pendingInvites: new Map<
      string,
      { burnOnRead: boolean; strict: boolean; expiresAt: number }
    >(),
    relayState: "offline" as ConnState,
    reconnectTimer: null as ReturnType<typeof setTimeout> | null,
    reconnectDelay: 1000,
    relayUrl: "",
    getAccessToken: null as null | (() => string | null),
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
  },

  actions: {
    /** Wire the relay — called once when the private module boots.
     *  `client` is injectable for tests. */
    boot(
      relayUrl: string,
      getAccessToken: () => string | null,
      client?: RelayClient,
    ): void {
      if (this.client) return;
      this.relayUrl = relayUrl;
      this.getAccessToken = getAccessToken;
      this.client = client ?? new RelayClient(relayUrl);
      const c = this.client;

      c.on("relay.invite", (ev) => {
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
          sessionKey: null,
          sas: null,
          messages: [],
          lastSeq: 0,
        };
        this.sessions.set(s.id, s);
      });

      // ack: server accepted our invite — the session now has a real
      // id, so declined/expired frames correlate by sessionId
      c.on("relay.invited", (ev) => {
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
          sessionKey: null,
          sas: null,
          messages: [],
          lastSeq: 0,
        };
        this.sessions.set(s.id, s);
      });

      c.on("relay.established", (ev) => {
        void this.onEstablished(ev.data);
      });

      c.on("relay.declined", (ev) => this.dropSession(ev.data.sessionId));

      c.on("relay.msg", (ev) => {
        void this.onMessage(ev.data.sessionId, ev.data.msgSeq, ev.data.blob);
      });

      c.on("relay.error", () => {
        // quota/not_found/etc — surfaced via session state, not logged:
        // error.code contains no private content
      });

      c.on("relay.peer-offline", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) s.peerOfflineUntil = ev.data.graceEndsAt;
      });

      c.on("relay.peer-online", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) s.peerOfflineUntil = null;
      });

      c.on("relay.closed", (ev) => {
        const s = this.sessions.get(ev.data.sessionId);
        if (s) {
          s.status = "closed";
          this.wipeSessionSecrets(s);
        } else {
          this.sessions.delete(ev.data.sessionId);
        }
        this.pendingEnvelopes.delete(ev.data.sessionId);
      });

      c.onStateChange((s) => {
        this.relayState = s;
        if (s === "online") this.reconnectDelay = 1000;
        if (s === "offline") this.scheduleReconnect();
      });
    },

    /** Connect the relay — failures surface via relayState, never throw.
     *  Self-heals after teardown(): the SPA keeps running across a
     *  logout→login cycle, so a null client is rebuilt and re-wired. */
    connect(): void {
      if (!this.client && this.relayUrl && this.getAccessToken) {
        this.boot(this.relayUrl, this.getAccessToken);
      }
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

    /** Inviter flow — S10. The session appears on relay.established;
     *  our own flags travel via pendingInvites (the contract doesn't
     *  echo them back to the inviter). */
    startInvite(
      peer: PeerUser,
      opts: { ttlSeconds?: number; burnOnRead?: boolean; strict?: boolean } = {},
    ): void {
      // server invite TTL is 60 s — if relay.invited never arrives the
      // invite was rejected and this marker must die with it
      this.pendingInvites.set(peer.id, {
        burnOnRead: opts.burnOnRead ?? false,
        strict: opts.strict ?? false,
        expiresAt: Date.now() + 70_000,
      });
      this.client?.invite(peer.id, opts);
    },

    accept(sessionId: string): void {
      this.client?.accept(sessionId);
    },
    decline(sessionId: string): void {
      this.client?.decline(sessionId);
      this.dropSession(sessionId);
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
      if (!s.ownKeys) {
        const own = await generateSessionKeyPair();
        s.ownKeys = own;
        this.client?.sendEnvelope(d.sessionId, encodeEnv({ t: "key", k: own.rawPub }));
      }
      // envelopes may have arrived before the session existed locally —
      // drain in wire order (key envelope first, then msgs)
      const queued = this.pendingEnvelopes.get(d.sessionId) ?? [];
      this.pendingEnvelopes.delete(d.sessionId);
      for (const blob of queued) {
        await this.onMessage(d.sessionId, 0, blob);
      }
      // peer's key may have arrived while our pair was generating
      if (s.pendingPeerPub) {
        await this.onPeerKey(d.sessionId, s.pendingPeerPub);
      }
      // reconnect path — drain anything buffered for us
      this.client?.resume(d.sessionId, d.resumeToken);
    },

    async onPeerKey(sessionId: string, peerRawPub: string): Promise<void> {
      const s = this.sessions.get(sessionId);
      if (!s?.ownKeys) return;
      s.sessionKey = await deriveSessionKey(s.ownKeys, peerRawPub);
      s.sas = await sasFingerprint(s.ownKeys.rawPub, peerRawPub);
      s.pendingPeerPub = null;
      // any new key material invalidates the old SAS — a re-keyed or
      // re-established session MUST be re-verified, a "verified" flag
      // can never survive a key change
      if (s.status !== "closed") s.status = "unverified";
    },

    async onMessage(sessionId: string, _seq: number, blob: string): Promise<void> {
      const s = this.sessions.get(sessionId);
      if (!s) {
        const q = this.pendingEnvelopes.get(sessionId) ?? [];
        q.push(blob);
        this.pendingEnvelopes.set(sessionId, q);
        return;
      }
      let env: Envelope;
      try {
        env = decodeEnv(blob);
      } catch {
        return; // malformed base64/JSON — drop like bad ciphertext
      }
      if (env.t === "key") {
        if (!s.ownKeys) {
          s.pendingPeerPub = env.k;
          return;
        }
        await this.onPeerKey(sessionId, env.k);
        return;
      }
      if (env.t === "msg" && s.sessionKey) {
        try {
          const pt = await decryptEnvelope(s.sessionKey, env);
          s.messages.push({
            id: `${sessionId}:${s.lastSeq++}`,
            fromMe: false,
            text: pt.text,
            ts: Date.now(),
          });
        } catch {
          // undecryptable envelope — stale key after a re-keyed resume,
          // or a forged blob. Drop, don't surface: plaintext safety first.
        }
      }
    },

    /** S12 send — requires a derived session key (unverified OK to send? —
     *  yes, but the UI must show the session as unverified). */
    async send(sessionId: string, text: string): Promise<void> {
      const s = this.sessions.get(sessionId);
      if (!s?.sessionKey || !this.client) throw new Error("no session key");
      const env = await encryptEnvelope(s.sessionKey, { text });
      this.client.sendEnvelope(sessionId, encodeEnv(env));
      s.messages.push({
        id: `${sessionId}:${s.lastSeq++}`,
        fromMe: true,
        text,
        ts: Date.now(),
      });
    },

    /** User compared the emoji grid out-of-band — NOW the guarantee holds. */
    markVerified(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (s?.sessionKey) s.status = "verified";
    },

    burn(sessionId: string): void {
      this.client?.burn(sessionId);
      const s = this.sessions.get(sessionId);
      if (s) {
        s.status = "closed";
        this.wipeSessionSecrets(s);
      }
    },

    resume(sessionId: string): void {
      const s = this.sessions.get(sessionId);
      if (s?.resumeToken) this.client?.resume(sessionId, s.resumeToken);
    },

    /** Zero-trace: erase secrets from one session. */
    wipeSessionSecrets(s: PrivateSession): void {
      s.ownKeys = null;
      s.pendingPeerPub = null;
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
    },

    /**
     * Full zero-trace teardown — burn/beforeunload/module-unload path:
     * all sessions wiped, relay disconnected, IndexedDB deleted.
     * After this call the private module leaves no trace on the device.
     */
    async teardown(): Promise<void> {
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
      this.relayState = "offline";
      await wipeIdentityStore();
    },
  },
});
