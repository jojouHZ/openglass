// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// PrivateRemote contract tests — the host↔remote boundary is what the
// MFE contract promises: immutable UI snapshots, whitelisted fields,
// imperative notify-driven emission (no cross-module Vue reactivity).

import "fake-indexeddb/auto";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { RelayClient, type RelayEvent } from "./relay";
import {
  createPrivateRemote,
  type PrivateSessionView,
  type VerificationView,
} from "./remote";
import { usePrivateStore, type PrivateSession } from "./store";

class SilentRelay extends RelayClient {
  sent: { type: string; data: Record<string, unknown> }[] = [];
  private cbs = new Map<string, Set<(ev: never) => void>>();
  emit(ev: RelayEvent): void {
    for (const cb of this.cbs.get(ev.type) ?? [])
      (cb as (e: RelayEvent) => void)(ev);
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
  override connect(): Promise<void> {
    return Promise.resolve();
  }
  override disconnect(): void {}
  override invite(toUserId: string): void {
    this.sent.push({ type: "relay.invite", data: { toUserId } });
  }
  override accept(sessionId: string): void {
    this.sent.push({ type: "relay.accept", data: { sessionId } });
  }
  override decline(sessionId: string): void {
    this.sent.push({ type: "relay.decline", data: { sessionId } });
  }
  override sendEnvelope(sessionId: string): void {
    this.sent.push({ type: "relay.send", data: { sessionId } });
  }
  override resume(): void {}
  override burn(sessionId: string): void {
    this.sent.push({ type: "relay.burn", data: { sessionId } });
  }
  override ping(): void {}
}

const PEER = { id: "peer-1", displayName: "Bob", tag: "bob#1" };

class FakeDir {
  keys: { keyId: string; publicKey: string; label?: string }[] = [];
  revoked: string[] = [];
  publish() {
    return Promise.resolve({});
  }
  listMine() {
    return Promise.resolve([]);
  }
  listPeer() {
    return Promise.resolve(this.keys);
  }
  revoke(keyId: string) {
    this.revoked.push(keyId);
    return Promise.resolve();
  }
}

function seeded(store: ReturnType<typeof usePrivateStore>, over: Partial<PrivateSession> = {}) {
  const s: PrivateSession = {
    id: "ps-1",
    peer: PEER,
    status: "unverified",
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
    ...over,
  };
  store.sessions.set(s.id, s);
  return s;
}

function setup() {
  setActivePinia(createPinia());
  const store = usePrivateStore();
  const relay = new SilentRelay("/relay");
  store.boot("/relay", () => "tok", relay);
  const remote = createPrivateRemote(store);
  return { store, relay, remote };
}

describe("PrivateRemote — host boundary", () => {
  it("watchSession emits null then the snapshot on mutation", () => {
    const { store, remote } = setup();
    const seen: (PrivateSessionView | null)[] = [];
    remote.watchSession(PEER.id, (v) => seen.push(v));
    expect(seen).toEqual([null]);

    seeded(store);
    store.notify();
    expect(seen.at(-1)).toMatchObject({
      sessionId: "ps-1",
      peerId: PEER.id,
      status: "unverified",
      canSend: false,
    });
  });

  it("snapshot whitelists UI fields — no key material or internals", async () => {
    const { store, remote } = setup();
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    seeded(store, {
      sessionKey: key,
      sas: { symbols: [0, 5, 42, 127, 3, 64], digits: "019283" },
      resumeToken: "secret-resume",
      pendingPeerPub: "b64pub",
      messages: [{ id: "m1", fromMe: false, text: "hi", ts: 1, viewOnce: true }],
    });
    store.notify();

    let view: PrivateSessionView | null = null;
    remote.watchSession(PEER.id, (v) => (view = v));
    expect(view!.canSend).toBe(true);
    const json = JSON.stringify(view);
    for (const forbidden of [
      "sessionKey",
      "ownKeys",
      "pendingPeerPub",
      "resumeToken",
      "lastSeq",
      "b64pub",
      "secret-resume",
      "CryptoKey",
    ]) {
      expect(json).not.toContain(forbidden);
    }
    expect(Object.keys(view!)).toEqual([
      "sessionId",
      "peerId",
      "status",
      "sas",
      "messages",
      "ttlEndsAt",
      "peerOfflineUntil",
      "canSend",
    ]);
  });

  it("mutations emit fresh snapshots; unsubscribe stops them", async () => {
    const { store, remote } = setup();
    seeded(store, {
      sessionKey: await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      ),
    });
    store.notify();

    const seen: (PrivateSessionView | null)[] = [];
    const unsub = remote.watchSession(PEER.id, (v) => seen.push(v));
    await remote.send("ps-1", "hello", { viewOnce: true });
    expect(seen.at(-1)!.messages.at(-1)).toMatchObject({
      fromMe: true,
      text: "hello",
      viewOnce: true,
    });

    remote.burn("ps-1");
    // burned sessions vanish from the host view — sessionByPeer skips
    // closed ones, so the snapshot is null, not "closed"
    expect(seen.at(-1)).toBeNull();

    unsub();
    const n = seen.length;
    store.dropSession("ps-1"); // notifies → subscriber must not fire
    expect(seen.length).toBe(n);
  });

  it("watchInvites reports incoming and outgoing; cancelInvite clears ours", async () => {
    const { store, relay, remote } = setup();
    const seen: { incoming: number; outgoing: string[] }[] = [];
    remote.watchInvites((v) =>
      seen.push({ incoming: v.incoming.length, outgoing: [...v.outgoing] }),
    );
    expect(seen.at(-1)).toEqual({ incoming: 0, outgoing: [] });

    // handshake v2: invites are pin-gated — seed a pin for the peer
    store.pins.set(PEER.id, {
      peerUserId: PEER.id,
      keyId: "k",
      publicKey: "pk",
      verifiedAt: new Date().toISOString(),
    });
    remote.startInvite(PEER, { ttlSeconds: 60 });
    await new Promise((r) => setTimeout(r, 10)); // pin-gate is async
    expect(seen.at(-1)!.outgoing).toEqual([PEER.id]);
    expect(relay.sent.at(-1)!.type).toBe("relay.invite");

    remote.cancelInvite(PEER.id);
    expect(seen.at(-1)!.outgoing).toEqual([]);

    relay.emit({
      type: "relay.invite",
      data: {
        sessionId: "ps-in",
        from: PEER,
        ttlSeconds: 60,
        burnOnRead: false,
        strict: false,
      },
    });
    expect(seen.at(-1)!.incoming).toBe(1);
  });

  it("watchRelayState emits the live connection state", () => {
    const { store, remote } = setup();
    const seen: string[] = [];
    remote.watchRelayState((s) => seen.push(s));
    expect(seen).toEqual(["offline"]);
    store.relayState = "online";
    store.notify();
    expect(seen.at(-1)).toBe("online");
  });

  it("lifecycle: boot/connect/teardown are contract commands — the host never holds the store", async () => {
    setActivePinia(createPinia());
    const store = usePrivateStore();
    const remote = createPrivateRemote(store);

    // boot delegates: relay client is created through the contract only
    remote.boot("/relay", () => "tok");
    expect(store.client).not.toBeNull();

    // connect is fire-and-forget safe even without a live socket
    expect(() => remote.connect()).not.toThrow();

    // teardown is the zero-trace command: volatile state + client gone
    seeded(store);
    await remote.teardown();
    expect(store.sessions.size).toBe(0);
    expect(store.client).toBeNull();
    expect(store.relayState).toBe("offline");
  });
});

describe("PrivateRemote — device verification", () => {
  function vsetup() {
    setActivePinia(createPinia());
    const store = usePrivateStore();
    const dir = new FakeDir();
    store.boot("/relay", () => "tok", new SilentRelay("/relay"), "me", dir as never);
    const remote = createPrivateRemote(store);
    return { store, remote, dir };
  }

  it("start → pending fingerprint → confirm persists the pin", async () => {
    const { store, remote, dir } = vsetup();
    dir.keys = [{ keyId: "k1", publicKey: btoa("peer-pub-1"), label: "phone" }];
    await store.ready;
    const views: VerificationView[] = [];
    remote.watchVerification(PEER.id, (v) => views.push(v));
    expect(views[0].state).toBe("unverified");

    await remote.startVerification(PEER.id);
    expect(views.at(-1)?.state).toBe("pending");
    expect(views.at(-1)?.fingerprint).toBeTruthy();
    expect(views.at(-1)?.devices).toHaveLength(1);

    await remote.confirmVerification(PEER.id);
    expect(views.at(-1)?.state).toBe("verified");
    expect(store.pins.get(PEER.id)?.publicKey).toBe(btoa("peer-pub-1"));
    await store.teardown();
  });

  it("key-changed when the shown key differs from the pin", async () => {
    const { store, remote, dir } = vsetup();
    dir.keys = [{ keyId: "k1", publicKey: btoa("peer-pub-1") }];
    await store.ready;
    await remote.startVerification(PEER.id);
    await remote.confirmVerification(PEER.id);

    dir.keys = [{ keyId: "k2", publicKey: btoa("peer-pub-2") }];
    const views: VerificationView[] = [];
    remote.watchVerification(PEER.id, (v) => views.push(v));
    await remote.startVerification(PEER.id);
    expect(views.at(-1)?.state).toBe("key-changed");
    await store.teardown();
  });

  it("reject discards the pending ritual without pinning", async () => {
    const { store, remote, dir } = vsetup();
    dir.keys = [{ keyId: "k1", publicKey: btoa("peer-pub-1") }];
    await store.ready;
    const views: VerificationView[] = [];
    remote.watchVerification(PEER.id, (v) => views.push(v));
    await remote.startVerification(PEER.id);
    remote.rejectVerification(PEER.id);
    expect(views.at(-1)?.state).toBe("unverified");
    expect(store.pins.has(PEER.id)).toBe(false);
    await store.teardown();
  });

  it("stop discards rituals and a later owner cannot confirm them", async () => {
    const { store, remote, dir } = vsetup();
    dir.keys = [{ keyId: "k1", publicKey: btoa("peer") }];
    await store.ready;
    await remote.startVerification(PEER.id);
    const views: VerificationView[] = [];
    remote.watchVerification(PEER.id, (v) => views.push(v));
    remote.stop();
    expect(views.at(-1)).toMatchObject({ state: "unverified", fingerprint: null, devices: [] });
    store.boot("/relay", () => "tok", new SilentRelay("/relay"), "other");
    await store.ready;
    await remote.confirmVerification(PEER.id);
    expect(store.pins.size).toBe(0);
    await store.teardown();
  });

  it("late directory responses cannot reopen a rejected ritual", async () => {
    const { store, remote, dir } = vsetup();
    await store.ready;
    let resolve!: (keys: typeof dir.keys) => void;
    dir.listPeer = () => new Promise((r) => { resolve = r; });
    const starting = remote.startVerification(PEER.id);
    await Promise.resolve();
    remote.rejectVerification(PEER.id);
    resolve([{ keyId: "late", publicKey: btoa("late") }]);
    await starting;
    const views: VerificationView[] = [];
    remote.watchVerification(PEER.id, (v) => views.push(v));
    expect(views.at(-1)).toMatchObject({ state: "unverified", fingerprint: null });
    await remote.confirmVerification(PEER.id);
    expect(store.pins.size).toBe(0);
    await store.teardown();
  });

  it("logout during confirmation leaves no pin cache or database", async () => {
    const { store, remote, dir } = vsetup();
    dir.keys = [{ keyId: "k1", publicKey: btoa("peer") }];
    await store.ready;
    await remote.startVerification(PEER.id);
    const confirming = remote.confirmVerification(PEER.id);
    await remote.teardown();
    await confirming;
    expect(store.pins.size).toBe(0);
    expect((await indexedDB.databases()).some((db) => db.name === "openglass-private")).toBe(false);
  });

  it("watchActiveSessions emits live views; forgetDevice revokes and wipes", async () => {
    const { store, remote, dir } = vsetup();
    await store.ready;
    const keyId = store.identity!.keyId;
    const lists: PrivateSessionView[][] = [];
    remote.watchActiveSessions((v) => lists.push(v));
    expect(lists[0]).toEqual([]);
    seeded(store);
    store.notify();
    expect(lists.at(-1)).toHaveLength(1);
    expect(lists.at(-1)?.[0]?.peerId).toBe(PEER.id);

    await remote.forgetDevice();
    expect(dir.revoked).toEqual([keyId]);
    expect(store.identity).toBeNull();
    expect(
      (await indexedDB.databases()).some((db) => db.name === "openglass-private"),
    ).toBe(false);
  });
});
