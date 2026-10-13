// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// PrivateRemote contract tests — the host↔remote boundary is what the
// MFE contract promises: immutable UI snapshots, whitelisted fields,
// imperative notify-driven emission (no cross-module Vue reactivity).

import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";

import { RelayClient, type RelayEvent } from "./relay";
import { createPrivateRemote, type PrivateSessionView } from "./remote";
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
      sas: ["😀", "😁"],
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

  it("watchInvites reports incoming and outgoing; cancelInvite clears ours", () => {
    const { store, relay, remote } = setup();
    const seen: { incoming: number; outgoing: string[] }[] = [];
    remote.watchInvites((v) =>
      seen.push({ incoming: v.incoming.length, outgoing: [...v.outgoing] }),
    );
    expect(seen.at(-1)).toEqual({ incoming: 0, outgoing: [] });

    remote.startInvite(PEER, { ttlSeconds: 60 });
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
});
