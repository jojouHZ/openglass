// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import { RelayClient, type RelayEvent } from "./relay";
import { usePrivateStore, type PrivateSession } from "./store";

/**
 * FakeRelay — loopback stand-in for the real socket: every sendEnvelope
 * from side A is delivered as a relay.msg frame to side B's listeners.
 */
class FakeRelay extends RelayClient {
  peer: FakeRelay | null = null;
  sent: { type: string; data: Record<string, unknown> }[] = [];
  private cbs = new Map<string, Set<(ev: never) => void>>();

  override connect(): Promise<void> {
    return Promise.resolve();
  }
  override disconnect(): void {}

  emit(ev: RelayEvent): void {
    for (const cb of this.cbs.get(ev.type) ?? []) (cb as (e: RelayEvent) => void)(ev);
  }

  override on<T extends RelayEvent["type"]>(
    type: T,
    cb: (ev: Extract<RelayEvent, { type: T }>) => void,
  ): () => void {
    let set = this.cbs.get(type);
    if (!set) {
      set = new Set();
      this.cbs.set(type, set);
    }
    set.add(cb as never);
    return () => set.delete(cb as never);
  }

  // server msgSeq is per-session monotonic across BOTH directions —
  // the loopback must reproduce that or the client's replay-dedup
  // drops every envelope after the first
  private seqs = new Map<string, number>();

  override sendEnvelope(sessionId: string, blob: string): void {
    this.sent.push({ type: "relay.send", data: { sessionId, blob } });
    const seq = (this.seqCounter(sessionId) ?? 0) + 1;
    this.seqCounterSet(sessionId, seq);
    queueMicrotask(() =>
      this.peer?.emit({ type: "relay.msg", data: { sessionId, msgSeq: seq, blob } }),
    );
  }

  private seqCounter(sid: string): number | undefined {
    return this.seqPair ? this.seqPair.get(sid) : undefined;
  }
  private seqCounterSet(sid: string, v: number): void {
    this.seqPair?.set(sid, v);
  }
  /** shared per-session counter — both loopback ends read/write it */
  private seqPair: Map<string, number> | null = null;
  linkSeq(): void {
    if (!this.seqPair) this.seqPair = this.peer?.seqPair ?? new Map();
    if (this.peer && !this.peer.seqPair) this.peer.seqPair = this.seqPair;
  }

  override invite(toUserId: string, opts?: Record<string, unknown>): void {
    this.sent.push({ type: "relay.invite", data: { toUserId, ...opts } });
  }
  override accept(sessionId: string): void {
    this.sent.push({ type: "relay.accept", data: { sessionId } });
  }
  override decline(sessionId: string, reason?: "busy"): void {
    this.sent.push({ type: "relay.decline", data: reason ? { sessionId, reason } : { sessionId } });
  }
  override burn(sessionId: string): void {
    this.sent.push({ type: "relay.burn", data: { sessionId } });
    queueMicrotask(() => {
      this.emit({ type: "relay.closed", data: { sessionId, reason: "burned" } });
      this.peer?.emit({ type: "relay.closed", data: { sessionId, reason: "burned" } });
    });
  }
  override resume(sessionId: string, resumeToken: string): void {
    this.sent.push({ type: "relay.resume", data: { sessionId, resumeToken } });
  }
  override ping(): void {}
}

function makePair(): { a: FakeRelay; b: FakeRelay } {
  const a = new FakeRelay("/relay");
  const b = new FakeRelay("/relay");
  a.peer = b;
  b.peer = a;
  a.linkSeq();
  return { a, b };
}

const USER_A = { id: "ua", displayName: "Alice", tag: "alice#1" };
const USER_B = { id: "ub", displayName: "Bob", tag: "bob#1" };

/** Records directory calls — no HTTP: proves what the store publishes. */
class FakeDirectory {
  published: { keyId?: string; publicKey?: string; label?: string }[] = [];
  revoked: string[] = [];
  publish(body: { keyId?: string; publicKey?: string; label?: string }) {
    this.published.push(body);
    return Promise.resolve({ keyId: body.keyId, publicKey: body.publicKey });
  }
  listMine() {
    return Promise.resolve([]);
  }
  listPeer() {
    return Promise.resolve([]);
  }
  revoke(keyId: string) {
    this.revoked.push(keyId);
    return Promise.resolve();
  }
}

/** Wait out crypto + queued deliveries (WebCrypto ops are real async). */
function flush(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Two independent party stores — one pinia per "device". Boots with
 *  identity + cross-pins (handshake v2): sa pins B's identity key and
 *  vice versa, so signed envelopes verify and the pair is "verified"
 *  by construction — no manual SAS step. */
async function twoParties(): Promise<{
  sa: ReturnType<typeof usePrivateStore>;
  sb: ReturnType<typeof usePrivateStore>;
  ra: FakeRelay;
  rb: FakeRelay;
}> {
  const { a: ra, b: rb } = makePair();
  setActivePinia(createPinia());
  const sa = usePrivateStore();
  sa.boot("/relay", () => "tok", ra, USER_A.id);
  setActivePinia(createPinia());
  const sb = usePrivateStore();
  sb.boot("/relay", () => "tok", rb, USER_B.id);
  await sa.ready;
  await sb.ready;
  const pin = (peer: ReturnType<typeof usePrivateStore>) =>
    peer.identity
      ? {
          peerUserId: peer.meUserId,
          keyId: peer.identity.keyId,
          publicKey: peer.identity.pubB64,
          verifiedAt: new Date().toISOString(),
        }
      : null;
  const pA = pin(sa)!;
  const pB = pin(sb)!;
  sa.pins.set(USER_B.id, { ...pB, peerUserId: USER_B.id });
  sb.pins.set(USER_A.id, { ...pA, peerUserId: USER_A.id });
  return { sa, sb, ra, rb };
}

function established(
  relay: FakeRelay,
  sessionId: string,
  peer: typeof USER_A,
  resumeToken = "rt",
  flags = { burnOnRead: false, strict: false },
): void {
  relay.emit({ type: "relay.invited", data: { sessionId, to: peer, ttlSeconds: 600, ...flags } });
  relay.emit({
    type: "relay.established",
    data: { sessionId, peer, resumeToken, ttlEndsAt: "2099-01-01T00:00:00Z" },
  });
}

describe("private store — session lifecycle", () => {
  it("rejects relay replay of a session absent from volatile state", async () => {
    const { sa, ra } = await twoParties();
    ra.emit({
      type: "relay.established",
      data: { sessionId: "old-session", peer: USER_B, resumeToken: "old-token", ttlEndsAt: "2099-01-01T00:00:00Z" },
    });
    await flush();
    expect(sa.sessions.size).toBe(0);
    expect(ra.sent).toContainEqual({ type: "relay.burn", data: { sessionId: "old-session" } });
    await sa.teardown();
  });
  it("stop clears volatile state but reboot retains identity and the owner's pins", async () => {
    const { sa, ra } = await twoParties();
    const { savePin } = await import("./pins");
    const identity = sa.identity!;
    const pin = { ...sa.pins.get(USER_B.id)! };
    await savePin(USER_A.id, pin);
    established(ra, "persist-test", USER_B);
    await flush();
    sa.stop();
    expect(sa.sessions.size).toBe(0);
    expect(sa.identity).toBeNull();
    expect(sa.pins.size).toBe(0);
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), USER_A.id);
    await sa.ready;
    expect(sa.identity?.pubB64).toBe(identity.pubB64);
    expect(sa.pins.get(USER_B.id)).toEqual(pin);
    expect(sa.sessions.size).toBe(0);
    await sa.teardown();
    const { getPin } = await import("./pins");
    expect(await getPin(USER_A.id, USER_B.id)).toBeUndefined();
  });

  it("identity loads when the user id becomes known after boot", async () => {
    setActivePinia(createPinia());
    const sa = usePrivateStore();
    let uid = "";
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), () => uid);
    sa.connect();
    await flush();
    expect(sa.identity).toBeNull();
    expect(sa.meUserId).toBe("");
    uid = USER_A.id;
    sa.connect();
    await sa.ready;
    expect(sa.meUserId).toBe(USER_A.id);
    expect(sa.identity?.pubB64).toBeTruthy();
    await sa.teardown();
  });

  it("re-login as another user loads that user's identity and pins only", async () => {
    const { sa } = await twoParties();
    const { savePin } = await import("./pins");
    await savePin(USER_A.id, { ...sa.pins.get(USER_B.id)! });
    let uid = USER_A.id;
    sa.stop();
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), () => uid);
    await sa.ready;
    expect(sa.pins.get(USER_B.id)).toBeTruthy();
    uid = USER_B.id;
    sa.stop();
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), () => uid);
    await sa.ready;
    expect(sa.meUserId).toBe(USER_B.id);
    // A's pins are scoped to A — B must not see them
    expect(sa.pins.size).toBe(0);
    await sa.teardown();
  });

  it("publishes the device identity key after authenticated bootstrap", async () => {
    setActivePinia(createPinia());
    const dir = new FakeDirectory();
    const sa = usePrivateStore();
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), USER_A.id, dir as never);
    await sa.ready;
    expect(dir.published).toHaveLength(1);
    expect(dir.published[0].keyId).toBe(sa.identity!.keyId);
    expect(dir.published[0].publicKey).toBe(sa.identity!.pubB64);
    await sa.teardown();
  });

  it("re-boot after stop keeps publishing identity (directory preserved)", async () => {
    setActivePinia(createPinia());
    const dir = new FakeDirectory();
    const sa = usePrivateStore();
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), USER_A.id, dir as never);
    await sa.ready;
    expect(dir.published).toHaveLength(1);
    sa.stop();
    // the lifecycle-driven re-boot passes no directory — publish must
    // still fire (was lost before: directory was reset to null)
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), USER_A.id);
    await sa.ready;
    expect(dir.published).toHaveLength(2);
    expect(dir.published[1].keyId).toBe(sa.identity!.keyId);
    await sa.teardown();
  });

  it("actual connect after stop and logout resolves the current owner", async () => {
    const connect = vi.spyOn(RelayClient.prototype, "connect").mockResolvedValue();
    setActivePinia(createPinia());
    const dir = new FakeDirectory();
    const store = usePrivateStore();
    let uid = USER_A.id;
    try {
      store.boot("/relay", () => "tok", new FakeRelay("/relay"), () => uid, dir as never);
      await store.ready;
      const originalKey = store.identity!.keyId;
      store.stop();
      store.connect();
      await store.ready;
      expect(store.meUserId).toBe(USER_A.id);
      expect(store.identity?.keyId).toBe(originalKey);
      expect(dir.published).toHaveLength(2);
      await store.teardown();
      uid = USER_B.id;
      store.connect();
      await store.ready;
      expect(store.meUserId).toBe(USER_B.id);
      expect(store.identity?.keyId).toBeTruthy();
      expect(store.identity?.keyId).not.toBe(originalKey);
      expect(store.pins.size).toBe(0);
    } finally {
      await store.teardown();
      connect.mockRestore();
    }
  });

  it("teardown revokes the published identity key before wiping", async () => {
    setActivePinia(createPinia());
    const dir = new FakeDirectory();
    const sa = usePrivateStore();
    sa.boot("/relay", () => "tok", new FakeRelay("/relay"), USER_A.id, dir as never);
    await sa.ready;
    const keyId = sa.identity!.keyId;
    await sa.teardown();
    expect(dir.revoked).toEqual([keyId]);
  });

  it("boot of another user waits for logout cleanup", async () => {
    const { sa } = await twoParties();
    const previousIdentity = sa.identity!.pubB64;
    const cleanup = sa.teardown();
    sa.boot("/relay", () => "next-token", new FakeRelay("/relay"), "next-user");
    await cleanup;
    await sa.ready;
    expect(sa.meUserId).toBe("next-user");
    expect(sa.identity?.pubB64).toBeTruthy();
    expect(sa.identity?.pubB64).not.toBe(previousIdentity);
    expect(sa.pins.size).toBe(0);
    await sa.teardown();
  });

  it("logout waits for initialization and prevents late state resurrection", async () => {
    setActivePinia(createPinia());
    const store = usePrivateStore();
    store.boot("/relay", () => "tok", new FakeRelay("/relay"), "logout-user");
    await store.teardown();
    expect(store.identity).toBeNull();
    expect(store.pins.size).toBe(0);
    expect(store.meUserId).toBe("");
    expect((await indexedDB.databases()).some((db) => db.name === "openglass-private")).toBe(false);
  });

  it("invite → established → key exchange → unverified → encrypted send", async () => {
    const { sa, sb, ra, rb } = await twoParties();

    // b gets an invite
    rb.emit({
      type: "relay.invite",
      data: { sessionId: "s1", from: USER_A, ttlSeconds: 600, burnOnRead: false, strict: false },
    });
    expect(sb.sessions.get("s1")?.status).toBe("incoming");
    sb.accept("s1");
    await flush(); // accept is pin-gated — async now
    expect(rb.sent.some((f) => f.type === "relay.accept")).toBe(true);

    // both sides get established → both send signed key envelopes;
    // pinned pair verifies by construction — no manual SAS step
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();

    const a = sa.sessions.get("s1")!;
    const b = sb.sessions.get("s1")!;
    expect(a.status).toBe("verified");
    expect(b.status).toBe("verified");
    expect(a.sas).not.toBeNull();
    // both sides derive the same session fingerprint
    expect(a.sas).toEqual(b.sas);

    // encrypted send — delivered + decrypted on the other side
    await sa.send("s1", "ghp_secret_token");
    await flush();
    expect(b.messages).toHaveLength(1);
    expect(b.messages[0].text).toBe("ghp_secret_token");
    expect(b.messages[0].fromMe).toBe(false);
  });

  it("late handshake work and old relay events cannot populate a new owner's module", async () => {
    const { sa, ra } = await twoParties();
    established(ra, "old-handshake", USER_B);
    sa.stop();
    const nextRelay = new FakeRelay("/relay");
    sa.boot("/relay", () => "next-token", nextRelay, "next-owner");
    ra.emit({ type: "relay.invite", data: { sessionId: "late-invite", from: USER_B, ttlSeconds: 300, strict: false, burnOnRead: false } });
    await sa.ready;
    await flush();
    expect(sa.sessions.size).toBe(0);
    expect(nextRelay.sent).toEqual([]);
    await sa.teardown();
  });

  it("an in-flight send cannot use a new owner's relay after stop", async () => {
    const { sa, ra, rb } = await twoParties();
    established(ra, "stale-send", USER_B);
    established(rb, "stale-send", USER_A);
    await flush();
    const sending = sa.send("stale-send", "old-owner-message");
    sa.stop();
    const nextRelay = new FakeRelay("/relay");
    sa.boot("/relay", () => "next-token", nextRelay, "next-owner");
    await expect(sending).rejects.toThrow();
    expect(nextRelay.sent).toEqual([]);
    await sa.teardown();
  });

  it("burn wipes secrets but keeps the closed session entry", async () => {
    const { sa, sb, ra, rb } = await twoParties();

    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    await sa.send("s1", "one");
    await flush();

    sa.burn("s1");
    await flush();
    const a = sa.sessions.get("s1")!;
    expect(a.status).toBe("closed");
    expect(a.ownKeys).toBeNull();
    expect(a.sessionKey).toBeNull();
    expect(a.sas).toBeNull();
    expect(a.messages).toHaveLength(0);
    // peer's copy is wiped by its own relay.closed handler
    const b = sb.sessions.get("s1");
    expect(b === undefined || b.status === "closed").toBe(true);
    if (b) expect(b.messages).toHaveLength(0);
  });

  it("peer-offline sets a deadline; peer-online clears it", async () => {
    const { sa, ra } = await twoParties();
    established(ra, "s1", USER_B);
    await flush();
    ra.emit({
      type: "relay.peer-offline",
      data: { sessionId: "s1", graceEndsAt: "2099-01-01T00:01:00Z" },
    });
    expect(sa.sessions.get("s1")!.peerOfflineUntil).toBe("2099-01-01T00:01:00Z");
    ra.emit({ type: "relay.peer-online", data: { sessionId: "s1" } });
    expect(sa.sessions.get("s1")!.peerOfflineUntil).toBeNull();
  });

  it("teardown wipes every session, disconnects and clears the map", async () => {
    const { sa, ra } = await twoParties();
    established(ra, "s1", USER_B);
    established(ra, "s2", USER_A);
    await flush();
    await sa.teardown();
    expect(sa.sessions.size).toBe(0);
    expect(sa.client).toBeNull();
    // no persistence paths touched: sessions map is the only state
  });

  it("undecryptable envelopes are dropped silently", async () => {
    const { sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();

    // forged blob — valid base64 JSON of a msg envelope with garbage ct
    const fake = { t: "msg", iv: btoa("0123456789ab"), ct: btoa("garbage") };
    const blob = btoa(new TextEncoder().encode(JSON.stringify(fake)).reduce(
      (s, c) => s + String.fromCharCode(c), ""));
    rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: 99, blob } });
    await flush();
    expect(sb.sessions.get("s1")!.messages).toHaveLength(0);
  });

  it("re-emitted established (reconnect) keeps keys and verification", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    await sa.send("s1", "before");
    await flush();
    const keyBefore = sa.sessions.get("s1")!.sessionKey;
    const sasBefore = sa.sessions.get("s1")!.sas;

    // server re-emits established after our socket re-authed
    established(ra, "s1", USER_B, "rt-2");
    await flush();
    const a = sa.sessions.get("s1")!;
    expect(a.sessionKey).toBe(keyBefore); // RAM keys survive a reconnect
    expect(a.sas).toEqual(sasBefore);
    expect(a.status).toBe("verified");
    // channel still works both ways
    await sa.send("s1", "after");
    await flush();
    expect(sb.sessions.get("s1")!.messages.map((m) => m.text)).toContain("after");
  });

  it("handshake v2: an unsigned or forged peer key envelope closes the session", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    expect(sb.sessions.get("s1")!.status).toBe("verified");

    // adversarial relay: substitutes a fresh ephemeral key, unsigned —
    // must NOT silently establish (the old downgrade path is gone)
    const { generateSessionKeyPair } = await import("./engine");
    const fresh = await generateSessionKeyPair();
    const keyEnv = btoa(
      new TextEncoder()
        .encode(JSON.stringify({ t: "key", k: fresh.rawPub }))
        .reduce((s, c) => s + String.fromCharCode(c), ""),
    );
    rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: 7, blob: keyEnv } });
    await flush();
    expect(sb.sessions.get("s1")!.status).toBe("closed");
    expect(sb.sessions.get("s1")!.sessionKey).toBeNull();
    expect(sb.sessions.get("s1")!.sas).toBeNull();
  });

  it("handshake v2: a key signed by the WRONG identity closes the session", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();

    // forged envelope: valid signature but under a DIFFERENT identity
    // than the pinned one → pin mismatch → closed
    const { getOrCreateDeviceIdentity, signWithIdentity } = await import("./identity");
    const evil = await getOrCreateDeviceIdentity("mallory");
    const { generateSessionKeyPair } = await import("./engine");
    const fresh = await generateSessionKeyPair();
    const { fromB64 } = await import("./engine");
    const sig = await signWithIdentity(evil, fromB64(fresh.rawPub));
    const keyEnv = btoa(
      new TextEncoder()
        .encode(JSON.stringify({ t: "key", k: fresh.rawPub, s: sig, i: evil.pubB64 }))
        .reduce((s, c) => s + String.fromCharCode(c), ""),
    );
    rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: 7, blob: keyEnv } });
    await flush();
    expect(sb.sessions.get("s1")!.status).toBe("closed");
  });

  it("a malformed (non-base64/JSON) blob is dropped, not thrown", async () => {
    const { sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    expect(() =>
      rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: 5, blob: "!!not-base64!!" } }),
    ).not.toThrow();
    await flush();
    expect(sb.sessions.get("s1")!.messages).toHaveLength(0);
  });

  it("relay.invited acks the invite; declined/expired correlate by sessionId", async () => {
    const { sa, ra } = await twoParties();
    sa.startInvite(USER_B, { burnOnRead: true, ttlSeconds: 300 });
    await flush(); // invite is pin-gated — async now
    expect(sa.outgoingInvites).toContain("ub"); // pre-ack pending marker

    // server ack — the session gets a real id and echo'd flags
    ra.emit({
      type: "relay.invited",
      data: { sessionId: "s-ack", to: USER_B, ttlSeconds: 300, burnOnRead: true, strict: false },
    });
    const s = sa.sessions.get("s-ack")!;
    expect(s.status).toBe("inviting");
    expect(s.burnOnRead).toBe(true);
    expect(sa.outgoingInvites).toContain("ub"); // now via the inviting session

    // peer declines — inviter correlates by sessionId and drops it
    ra.emit({ type: "relay.declined", data: { sessionId: "s-ack" } });
    expect(sa.sessions.has("s-ack")).toBe(false);
    expect(sa.outgoingInvites).not.toContain("ub");
  });

  it("expired pendingInvites are filtered from outgoingInvites", async () => {
    const { sa } = await twoParties();
    sa.pendingInvites.set("ub", {
      burnOnRead: false,
      strict: false,
      expiresAt: Date.now() - 1,
    });
    expect(sa.outgoingInvites).not.toContain("ub");
  });

  it("connect self-heals after teardown (logout→login in the same page)", async () => {
    const { sa } = await twoParties();
    await sa.teardown();
    expect(sa.client).toBeNull();
    sa.connect(); // must rebuild + re-wire the client, not no-op
    expect(sa.client).not.toBeNull();
  });

  it("view-once: display receipts burn the sender's copy, exit purges ours", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();

    await sa.send("s1", "ordinary");
    await sa.send("s1", "read me once", { viewOnce: true });
    await flush();
    const b = sb.sessions.get("s1")!;
    expect(b.messages).toHaveLength(2);
    expect(b.messages[1].viewOnce).toBe(true);

    // render: receipt goes out for the flagged message only
    sb.markDisplayed("s1");
    await flush();
    expect(b.messages[1].read).toBe(true);
    const a = sa.sessions.get("s1")!;
    // sender's view-once copy is gone, the ordinary one stays
    expect(a.messages.map((m) => m.text)).toEqual(["ordinary"]);

    // reader keeps it for this view; leaving the screen purges it
    expect(b.messages.map((m) => m.text)).toContain("read me once");
    sb.purgeRead("s1");
    expect(b.messages.map((m) => m.text)).toEqual(["ordinary"]);
  });

  it("replayed msgSeq is deduplicated (resume buffer flush)", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    await sa.send("s1", "once only");
    await flush();
    // simulate the server replaying the same buffered envelope
    const last = sb.sessions.get("s1")!.lastSeq;
    const blob = ra.sent.filter((f) => f.type === "relay.send").at(-1)!.data
      .blob as string;
    rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: last, blob } });
    await flush();
    expect(
      sb.sessions.get("s1")!.messages.filter((m) => m.text === "once only"),
    ).toHaveLength(1);
  });

  it("inviter's own flags survive via pendingInvites; outgoingInvites tracks", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    sa.startInvite(USER_B, { burnOnRead: true, strict: true, ttlSeconds: 300 });
    await flush(); // invite is pin-gated — async now
    expect(sa.outgoingInvites).toContain("ub");
    expect(ra.sent[0]).toMatchObject({
      type: "relay.invite",
      data: { toUserId: "ub", burnOnRead: true, strict: true, ttlSeconds: 300 },
    });
    rb.emit({
      type: "relay.invite",
      data: { sessionId: "s9", from: USER_A, ttlSeconds: 300, burnOnRead: true, strict: true },
    });
    sb.accept("s9");
    established(ra, "s9", USER_B, "rt", { burnOnRead: true, strict: true });
    established(rb, "s9", USER_A);
    await flush();
    expect(sa.outgoingInvites).not.toContain("ub"); // consumed by established
    const a = sa.sessions.get("s9")!;
    expect(a.burnOnRead).toBe(true);
    expect(a.strict).toBe(true);
  });
});

describe("private store — one-connection policy", () => {
  const USER_C = { id: "uc", displayName: "Carol", tag: "carol#1" };
  const pinC = (store: ReturnType<typeof usePrivateStore>) =>
    store.pins.set(USER_C.id, {
      peerUserId: USER_C.id,
      keyId: "kc",
      publicKey: "pub-c",
      verifiedAt: new Date().toISOString(),
    });

  it("auto-declines an incoming invite with reason=busy while a session is live", async () => {
    const { sa, sb, ra, rb } = await twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    expect(sb.hasLiveSession).toBe(true);

    rb.emit({
      type: "relay.invite",
      data: { sessionId: "s-c", from: USER_C, ttlSeconds: 600, burnOnRead: false, strict: false },
    });
    // the invite never becomes a session and is declined busy
    expect(sb.sessions.has("s-c")).toBe(false);
    expect(rb.sent).toContainEqual({
      type: "relay.decline",
      data: { sessionId: "s-c", reason: "busy" },
    });
    expect(sb.missedInvites.get("uc")?.peerName).toBe("Carol");
    void sa;
  });

  it("inviter learns the decline reason — busy vs plain", async () => {
    const { sa, ra } = await twoParties();
    sa.startInvite(USER_B);
    await flush();
    ra.emit({ type: "relay.invited", data: { sessionId: "s-out", to: USER_B, ttlSeconds: 600, burnOnRead: false, strict: false } });
    ra.emit({ type: "relay.declined", data: { sessionId: "s-out", reason: "busy" } });
    expect(sa.sessions.has("s-out")).toBe(false);
    expect(sa.declinedOutgoing.get("ub")).toEqual({ peerName: "Bob", busy: true });
    // retrying the same peer clears the note
    sa.startInvite(USER_B);
    await flush();
    expect(sa.declinedOutgoing.has("ub")).toBe(false);
  });

  it("accept after a session went live declines busy instead of stacking", async () => {
    const { sb, ra, rb } = await twoParties();
    pinC(sb);
    // invite arrives while free — it stays incoming
    rb.emit({
      type: "relay.invite",
      data: { sessionId: "s-c", from: USER_C, ttlSeconds: 600, burnOnRead: false, strict: false },
    });
    expect(sb.sessions.get("s-c")?.status).toBe("incoming");
    // another session goes live first
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    sb.accept("s-c");
    await flush();
    expect(rb.sent).toContainEqual({
      type: "relay.decline",
      data: { sessionId: "s-c", reason: "busy" },
    });
    expect(rb.sent.some((f) => f.type === "relay.accept" && f.data.sessionId === "s-c")).toBe(false);
    expect(sb.missedInvites.has("uc")).toBe(true);
  });

  it("starting or accepting drops our stale outgoing invites to other peers", async () => {
    const { sa } = await twoParties();
    pinC(sa);
    sa.startInvite(USER_B);
    await flush();
    expect(sa.pendingInvites.has("ub")).toBe(true);
    sa.startInvite(USER_C);
    await flush();
    expect(sa.pendingInvites.has("ub")).toBe(false);
    expect(sa.pendingInvites.has("uc")).toBe(true);
  });
});

describe("private session — type surface", () => {
  it("sas is null until both keys exchanged", () => {
    const s: PrivateSession = {
      id: "x",
      peer: { id: "p" },
      status: "exchanging",
      strict: false,
      burnOnRead: false,
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
    expect(s.sas).toBeNull();
  });
});
