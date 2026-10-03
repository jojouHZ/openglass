// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S4 chat list + S5 conversation — real HttpApiClient against MSW
// node server; the composer test exercises send end-to-end.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApiRequestError,
  bindApiClient,
  useChatsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import { groupChatId } from "@openglass/core/api/mock/fixtures";

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

  it("unknown path redirects to the chat list", async () => {
    await router.push("/totally/bogus/path");
    expect(router.currentRoute.value.name).toBe("s4-chat-list");
  });

  it("dropped /groups/:chatId route falls into the catch-all", async () => {
    await router.push("/groups/some-chat-id");
    expect(router.currentRoute.value.name).toBe("s4-chat-list");
  });

  it("load failure shows a retry banner instead of a false empty", async () => {
    const orig = ctx.api.chats.list;
    ctx.api.chats.list = () =>
      Promise.reject(
        new ApiRequestError(500, { code: "server_error", message: "boom" }),
      );
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await flush(300);
    try {
      expect(w.find('[data-testid="load-error"]').exists()).toBe(true);
      expect(w.find('[data-testid="empty"]').exists()).toBe(false);
      ctx.api.chats.list = orig;
      await w.find('[data-testid="chats-retry"]').trigger("click");
      await flush(300);
      expect(w.find('[data-testid="load-error"]').exists()).toBe(false);
    } finally {
      ctx.api.chats.list = orig;
      w.unmount();
    }
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

  it("unknown chatId renders the not-found state", async () => {
    await router.push({
      name: "s5-chat-view",
      params: { chatId: "00000000-0000-4000-8000-000000000000" },
    });
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await flush(400);
    expect(w.find('[data-testid="not-found"]').exists()).toBe(true);
    expect(w.text()).toContain("chat not found");
    w.unmount();
    await router.push({ name: "s4-chat-list" });
  });

  it("history load failure shows a retry row that recovers", async () => {
    // drop the cached window so openChat fetches the tail again
    delete chats().windows[DIRECT];
    const orig = ctx.api.messages.list;
    ctx.api.messages.list = () =>
      Promise.reject(
        new ApiRequestError(500, { code: "server_error", message: "boom" }),
      );
    await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await flush(400);
    try {
      expect(w.find('[data-testid="history-error"]').exists()).toBe(true);
      ctx.api.messages.list = orig;
      await w.find('[data-testid="history-retry"]').trigger("click");
      await flush(400);
      expect(w.find('[data-testid="history-error"]').exists()).toBe(false);
      expect(w.find('[data-testid="msg-scroll"]').text()).toContain(
        "fixture message",
      );
    } finally {
      ctx.api.messages.list = orig;
      w.unmount();
    }
  });

  it("failed message action surfaces an error, not silence", async () => {
    const orig = ctx.api.messages.delete;
    ctx.api.messages.delete = () =>
      Promise.reject(
        new ApiRequestError(500, { code: "server_error", message: "boom" }),
      );
    try {
      await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
      const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
      await flush(400);
      const own = w
        .findAll("[data-mid]")
        .find((b) => b.find(".bg-bubble-own").exists())!;
      await own.trigger("contextmenu", { clientX: 10, clientY: 10 });
      document
        .querySelector('[data-testid="mi-delete"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush(150);
      expect(w.find('[data-testid="action-error"]').text()).toContain(
        "delete failed",
      );
      w.unmount();
    } finally {
      ctx.api.messages.delete = orig;
    }
  });

  it("group subtitle stays empty while the detail is unavailable", async () => {
    const orig = ctx.api.chats.get;
    ctx.api.chats.get = () =>
      Promise.reject(
        new ApiRequestError(500, { code: "server_error", message: "boom" }),
      );
    try {
      delete chats().details[groupChatId];
      await router.push({
        name: "s5-chat-view",
        params: { chatId: groupChatId },
      });
      const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
      await flush(400);
      expect(w.text()).not.toContain("0 members");
      w.unmount();
    } finally {
      ctx.api.chats.get = orig;
      await router.push({ name: "s4-chat-list" });
    }
  });

  it("offline state shows the banner and disables the composer", async () => {
    await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
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
