// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

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

  override sendEnvelope(sessionId: string, blob: string): void {
    this.sent.push({ type: "relay.send", data: { sessionId, blob } });
    queueMicrotask(() =>
      this.peer?.emit({ type: "relay.msg", data: { sessionId, msgSeq: 1, blob } }),
    );
  }

  override invite(toUserId: string, opts?: Record<string, unknown>): void {
    this.sent.push({ type: "relay.invite", data: { toUserId, ...opts } });
  }
  override accept(sessionId: string): void {
    this.sent.push({ type: "relay.accept", data: { sessionId } });
  }
  override decline(sessionId: string): void {
    this.sent.push({ type: "relay.decline", data: { sessionId } });
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
  return { a, b };
}

const USER_A = { id: "ua", displayName: "Alice", tag: "alice#1" };
const USER_B = { id: "ub", displayName: "Bob", tag: "bob#1" };

/** Wait out crypto + queued deliveries (WebCrypto ops are real async). */
function flush(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Two independent party stores — one pinia per "device". */
function twoParties(): {
  sa: ReturnType<typeof usePrivateStore>;
  sb: ReturnType<typeof usePrivateStore>;
  ra: FakeRelay;
  rb: FakeRelay;
} {
  const { a: ra, b: rb } = makePair();
  setActivePinia(createPinia());
  const sa = usePrivateStore();
  sa.boot("/relay", () => "tok", ra);
  setActivePinia(createPinia());
  const sb = usePrivateStore();
  sb.boot("/relay", () => "tok", rb);
  return { sa, sb, ra, rb };
}

function established(
  relay: FakeRelay,
  sessionId: string,
  peer: typeof USER_A,
  resumeToken = "rt",
): void {
  relay.emit({
    type: "relay.established",
    data: { sessionId, peer, resumeToken, ttlEndsAt: "2099-01-01T00:00:00Z" },
  });
}

describe("private store — session lifecycle", () => {
  it("invite → established → key exchange → unverified → encrypted send", async () => {
    const { sa, sb, ra, rb } = twoParties();

    // b gets an invite
    rb.emit({
      type: "relay.invite",
      data: { sessionId: "s1", from: USER_A, ttlSeconds: 600, burnOnRead: false, strict: false },
    });
    expect(sb.sessions.get("s1")?.status).toBe("incoming");
    sb.accept("s1");
    expect(rb.sent.some((f) => f.type === "relay.accept")).toBe(true);

    // both sides get established → both send key envelopes
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();

    const a = sa.sessions.get("s1")!;
    const b = sb.sessions.get("s1")!;
    expect(a.status).toBe("unverified");
    expect(b.status).toBe("unverified");
    expect(a.sas).not.toBeNull();
    // both sides see the same emoji grid
    expect(a.sas).toEqual(b.sas);

    // encrypted send — delivered + decrypted on the other side
    await sa.send("s1", "ghp_secret_token");
    await flush();
    expect(b.messages).toHaveLength(1);
    expect(b.messages[0].text).toBe("ghp_secret_token");
    expect(b.messages[0].fromMe).toBe(false);

    sa.markVerified("s1");
    expect(sa.sessions.get("s1")!.status).toBe("verified");
  });

  it("burn wipes secrets but keeps the closed session entry", async () => {
    const { sa, sb, ra, rb } = twoParties();

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
    const { sa, ra } = twoParties();
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
    const { sa, ra } = twoParties();
    established(ra, "s1", USER_B);
    established(ra, "s2", USER_A);
    await flush();
    await sa.teardown();
    expect(sa.sessions.size).toBe(0);
    expect(sa.client).toBeNull();
    // no persistence paths touched: sessions map is the only state
  });

  it("undecryptable envelopes are dropped silently", async () => {
    const { sb, ra, rb } = twoParties();
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
    const { sa, sb, ra, rb } = twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    await sa.send("s1", "before");
    await flush();
    sa.markVerified("s1");
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

  it("a new peer key envelope downgrades verified → unverified", async () => {
    const { sa, sb, ra, rb } = twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    sa.markVerified("s1");
    sb.markVerified("s1");
    expect(sb.sessions.get("s1")!.status).toBe("verified");

    // peer reloaded / re-keyed: fresh key envelope arrives
    const { generateSessionKeyPair } = await import("./engine");
    const fresh = await generateSessionKeyPair();
    const keyEnv = btoa(
      new TextEncoder()
        .encode(JSON.stringify({ t: "key", k: fresh.rawPub }))
        .reduce((s, c) => s + String.fromCharCode(c), ""),
    );
    rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: 7, blob: keyEnv } });
    await flush();
    expect(sb.sessions.get("s1")!.status).toBe("unverified");
    expect(sb.sessions.get("s1")!.sas).not.toEqual(sa.sessions.get("s1")!.sas);
  });

  it("a malformed (non-base64/JSON) blob is dropped, not thrown", async () => {
    const { sb, ra, rb } = twoParties();
    established(ra, "s1", USER_B);
    established(rb, "s1", USER_A);
    await flush();
    expect(() =>
      rb.emit({ type: "relay.msg", data: { sessionId: "s1", msgSeq: 5, blob: "!!not-base64!!" } }),
    ).not.toThrow();
    await flush();
    expect(sb.sessions.get("s1")!.messages).toHaveLength(0);
  });

  it("inviter's own flags survive via pendingInvites; outgoingInvites tracks", async () => {
    const { sa, sb, ra, rb } = twoParties();
    sa.startInvite(USER_B, { burnOnRead: true, strict: true, ttlSeconds: 300 });
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
    established(ra, "s9", USER_B);
    established(rb, "s9", USER_A);
    await flush();
    expect(sa.outgoingInvites).not.toContain("ub"); // consumed by established
    const a = sa.sessions.get("s9")!;
    expect(a.burnOnRead).toBe(true);
    expect(a.strict).toBe(true);
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
      sessionKey: null,
      sas: null,
      messages: [],
      lastSeq: 0,
    };
    expect(s.sas).toBeNull();
  });
});
