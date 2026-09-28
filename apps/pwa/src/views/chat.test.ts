// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S4 chat list + S5 conversation — real HttpApiClient against MSW
// node server; the composer test exercises send end-to-end.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bindApiClient,
  useChatsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S4ChatList from "./S4ChatList.vue";
import S5ChatView from "./S5ChatView.vue";

const DIRECT = "c0000000-0000-4000-8000-000000000001";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

const session = () => useSessionStore(pinia);
const chats = () => useChatsStore(pinia);

async function flush(ms = 250) {
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  localStorage.clear();
  await session().requestOtp("jojou@openglass.demo");
  await session().verifyOtp("123456", "vitest");
});
afterAll(() => {
  chats().disconnectRealtime();
  ctx.server.close();
});

describe("S4 chat list", () => {
  it("renders fixture chats pinned-first with saved messages + unread badge", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await flush(400);

    const items = w.findAll('[data-testid="chat-item"]');
    expect(items.length).toBe(3);
    // pinned chats (saved + group) come before the direct chat
    expect(items[2]!.text()).toContain("anna");
    expect(w.text()).toContain("saved messages");
    expect(w.find('[data-testid="unread"]').text()).toBe("3");
    expect(w.find('[data-testid="empty"]').exists()).toBe(false);
  });
});

describe("S5 chat view", () => {
  it("renders history and sends a message into the bubble flow", async () => {
    await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await flush(500);

    // tail window = last 50 of 60 fixture messages
    expect(w.find('[data-testid="msg-scroll"]').text()).toContain(
      "fixture message 60",
    );
    expect(w.find('[data-testid="load-older"]').exists()).toBe(true);
    expect(w.find('[data-testid="pinned-bar"]').exists()).toBe(true);
    // unread cleared on open via markRead
    expect(chats().chats.find((c) => c.id === DIRECT)?.unreadCount).toBe(0);

    await w.find('[data-testid="composer-input"]').setValue("hello from s5 test");
    await w.find('[data-testid="send"]').trigger("click");
    await flush(400);

    expect(w.text()).toContain("hello from s5 test");
  });

  it("context menu shows edit only on own messages", async () => {
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await flush(300);
    const bubbles = w.findAll("[data-mid]");
    // own message (sent above) → edit visible; incoming → no edit
    const own = bubbles.find((b) =>
      b.find(".bg-bubble-own").exists(),
    )!;
    await own.trigger("contextmenu", { clientX: 10, clientY: 10 });
    expect(document.querySelector('[data-testid="mi-edit"]')).toBeTruthy();
    document.querySelector('[data-testid="menu-scrim"]')?.dispatchEvent(
      new MouseEvent("click"),
    );

    const incoming = bubbles.find((b) => !b.find(".bg-bubble-own").exists())!;
    await incoming.trigger("contextmenu", { clientX: 10, clientY: 10 });
    expect(document.querySelector('[data-testid="mi-edit"]')).toBeFalsy();

    // reply on an incoming message → reply strip shows
    document.querySelector('[data-testid="mi-reply"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flush(50);
    expect(w.find('[data-testid="strip-reply"]').exists()).toBe(true);
    w.unmount();
  });

  it("offline state shows the banner and disables the composer", async () => {
    chats().connState = "offline";
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await flush(300);
    expect(w.find('[data-testid="offline-banner"]').exists()).toBe(true);
    expect(
      (w.find('[data-testid="composer-input"]').element as HTMLInputElement)
        .disabled,
    ).toBe(true);
    chats().connState = "online";
    w.unmount();
  });
});
