// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Chats store tests — run against the MSW node mock, so pagination /
// nonce-dedup / markRead exercise the real contract semantics.

import { createPinia, setActivePinia } from "pinia";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bindApiClient, useChatsStore, useSessionStore } from "../index";
import { createMockNodeApiClient } from "../api/mock/node";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);

setActivePinia(createPinia());
const session = useSessionStore();
const chats = useChatsStore();

const DIRECT = "c0000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  localStorage.clear();
  await session.requestOtp("jojou@openglass.demo");
  await session.verifyOtp("123456", "vitest"); // fixture self-user, authed
});
afterAll(() => ctx.server.close());

describe("chat list", () => {
  it("loads chats sorted pinned-first then by activity", async () => {
    await chats.refreshChats();
    expect(chats.chats.length).toBe(3);
    // contract: pinned before unpinned, then lastActivityAt desc
    expect(chats.chats[0]!.pinned).toBe(true);
    expect(chats.chats[1]!.pinned).toBe(true);
    expect(chats.chats[2]!.id).toBe(DIRECT);
    const saved = chats.chats.find((c) => chats.isSaved(c))!;
    expect(chats.chatTitle(saved)).toBe("saved messages");
  });
});

describe("message windows", () => {
  it("openChat loads the tail and marks read", async () => {
    await chats.openChat(DIRECT);
    const w = chats.window(DIRECT);
    expect(w.messages.length).toBeGreaterThan(10);
    expect(w.atTail).toBe(true);
    expect(chats.chats.find((c) => c.id === DIRECT)?.unreadCount).toBe(0);
  });

  it("loadOlder prepends the previous page", async () => {
    const w = () => chats.window(DIRECT);
    const before = w().messages.length;
    const firstSeq = w().messages[0]!.seq;
    await chats.loadOlder(DIRECT);
    expect(w().messages.length).toBeGreaterThan(before);
    expect(w().messages[0]!.seq).toBeLessThan(firstSeq);
  });

  it("jumpTo centers a window; loadNewer walks forward", async () => {
    const w = () => chats.window(DIRECT);
    const target = w().messages[5]!;
    await chats.jumpTo(DIRECT, target.id);
    expect(w().messages.map((m) => m.id)).toContain(target.id);
    // forward cursor exists when the window doesn't reach the tail
    while (w().newerCursor) {
      const last = w().messages.at(-1)!.seq;
      await chats.loadNewer(DIRECT);
      expect(w().messages.at(-1)!.seq).toBeGreaterThan(last);
    }
    expect(w().atTail).toBe(true);
  });
});

describe("send", () => {
  it("sends with a generated nonce and replaces the optimistic bubble", async () => {
    const w = () => chats.window(DIRECT);
    const before = w().messages.length;
    await chats.send(DIRECT, { text: "store test ping" });
    const last = w().messages.at(-1)!;
    expect(last.text).toBe("store test ping");
    expect(last.clientNonce).toBeTruthy();
    expect(last.pending).toBeUndefined();
    expect(w().messages.length).toBe(before + 1);
    // one send → one message (no duplicate from nonce echo)
    expect(w().messages.filter((m) => m.clientNonce === last.clientNonce)).toHaveLength(1);
  });

  it("search finds the sent text, pinned lists pinned", async () => {
    const hits = await chats.search(DIRECT, "store test");
    expect(hits.some((m) => m.text === "store test ping")).toBe(true);
    const pinned = await chats.pinnedMessages(DIRECT);
    expect(pinned.every((m) => m.pinned)).toBe(true);
  });
});

describe("realtime", () => {
  it("connectRealtime plays auth → presence → scenario", async () => {
    await chats.connectRealtime();
    await new Promise((r) => setTimeout(r, 200));
    expect(chats.connState).toBe("online");
    expect(Object.values(chats.online)).toContain(true);

    await new Promise((r) => setTimeout(r, 3500)); // typing@1500, msg@3000
    const w = chats.window(DIRECT);
    expect(w.messages.some((m) => m.text?.includes("mock) websocket"))).toBe(true);
    chats.disconnectRealtime();
  });

  it("message.new bumps summary + unread for inactive chats", async () => {
    chats.closeChat();
    const s = () => chats.chats.find((c) => c.id === DIRECT)!;
    const unread = s().unreadCount;
    chats.onMessageNew({
      id: "11111111-1111-4111-8111-111111111111",
      chatId: DIRECT,
      seq: 999,
      senderId: "22222222-2222-4222-8222-222222222222",
      text: "ws bump",
      clientNonce: "n1",
      sentAt: new Date().toISOString(),
      pinned: false,
    });
    expect(s().unreadCount).toBe(unread + 1);
    expect(s().lastMessage?.text).toBe("ws bump");
  });
});
