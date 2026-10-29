// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S4 chat list + S5 conversation — real HttpApiClient against MSW
// node server; the composer test exercises send end-to-end.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

  it("rows carry avatars: saved = bookmark, group = coloured initial + group badge, direct = tag colour", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => expect(w.findAll('[data-testid="chat-item"]')).toHaveLength(3));
    const rows = w.findAll('[data-testid="chat-item"]');
    const saved = rows.filter((r) => r.find('[data-testid="saved-avatar"]').exists());
    const groups = rows.filter((r) => r.find('[data-testid="group-badge"]').exists());
    expect(saved).toHaveLength(1);
    expect(groups).toHaveLength(1);
    const direct = rows.find((r) => r.text().includes("anna"))!;
    expect(direct.find("[style*='hsl(']").exists()).toBe(true);
    expect(direct.find('[data-testid="group-badge"]').exists()).toBe(false);
    // unread count uses the primary colour, not an ad-hoc accent
    expect(direct.find('[data-testid="unread"]').classes()).toContain("bg-primary");
    w.unmount();
  });

  it("searching filters by title, shows a message when nothing matches, and clears", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => expect(w.findAll('[data-testid="chat-item"]')).toHaveLength(3));
    const input = w.find('[data-testid="chat-search"]');
    await input.setValue("ANN");
    expect(w.findAll('[data-testid="chat-item"]')).toHaveLength(1);
    expect(w.find('[data-testid="chat-item"]').text()).toContain("anna");
    await input.setValue("zzz");
    expect(w.findAll('[data-testid="chat-item"]')).toHaveLength(0);
    expect(w.find('[data-testid="chat-search-empty"]').text()).toContain('"zzz"');
    expect(w.find('[data-testid="empty"]').exists()).toBe(false); // not the "no chats yet" state
    await input.setValue("");
    expect(w.findAll('[data-testid="chat-item"]')).toHaveLength(3);
    w.unmount();
  });

  it("is a root screen: title left, no folder placeholder, new chat + settings avatar", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    expect(w.find("h1").text()).toBe("Chats");
    expect(w.find('[data-testid="new-folder"]').exists()).toBe(false);
    expect(w.find('[data-testid="new-chat"]').exists()).toBe(true);
    expect(w.find('[data-testid="avatar-to-settings"]').exists()).toBe(true);
    w.unmount();
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
    try {
      await vi.waitFor(() => {
        expect(w.find('[data-testid="load-error"]').exists()).toBe(true);
      });
      expect(w.find('[data-testid="empty"]').exists()).toBe(false);
      ctx.api.chats.list = orig;
      await w.find('[data-testid="chats-retry"]').trigger("click");
      await vi.waitFor(() => {
        expect(w.find('[data-testid="load-error"]').exists()).toBe(false);
      });
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
    const own = bubbles.find(
      (b) => b.find(".bg-bubble-own").exists() && !b.find('[data-testid="tombstone"]').exists(),
    )!;
    // edit is offered for 15 minutes after sending — freshen the fixture message
    const mine = chats().windows[DIRECT]!.messages.find((m) => m.id === own.attributes("data-mid"))!;
    mine.sentAt = new Date().toISOString();
    await flush(20);
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
        .find((b) => b.find(".bg-bubble-own").exists() && !b.find('[data-testid="tombstone"]').exists())!;
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

  it("bubbles: incoming has a border, own is primary; groups show sender avatars, directs do not", async () => {
    await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => expect(w.findAll("[data-mid]").length).toBeGreaterThan(2));
    const own = w.findAll(".bg-bubble-own");
    const incoming = w.findAll(".bg-bubble-in");
    expect(own.length).toBeGreaterThan(0);
    expect(incoming.length).toBeGreaterThan(0);
    expect(own[0]!.classes()).toContain("text-own-fg");
    expect(incoming[0]!.classes()).toEqual(expect.arrayContaining(["border", "text-in-fg"]));
    // a direct chat needs no per-message avatars
    expect(w.findAll("[data-mid] [style*='hsl(']")).toHaveLength(0);
    // day separators are pills
    expect(w.find('[data-testid="day-label"] span').classes()).toContain("rounded-pill");
    w.unmount();
  });

  it("header title opens group settings (group) or the peer profile (direct)", async () => {
    // the title only becomes a button once the chat is known — wait for
    // the condition, never for a fixed delay (slow CI)
    const clickTitle = async (w: ReturnType<typeof mount>) => {
      await vi.waitFor(() => {
        expect(w.find("button.min-w-0.flex-1").exists()).toBe(true);
      });
      await w.find("button.min-w-0.flex-1").trigger("click");
    };

    await router.push({ name: "s5-chat-view", params: { chatId: groupChatId } });
    let w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await clickTitle(w);
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s9a-group-manage");
    });
    w.unmount();

    await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
    w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await clickTitle(w);
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s7-contact-profile");
    });
    w.unmount();
    await router.push({ name: "s4-chat-list" });
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

// must run last — handleSessionRevoked tears the session down
describe("app shell", () => {
  it("session loss on an authed route bounces to the invite screen", async () => {
    const { default: App } = await import("../App.vue");
    await router.push({ name: "s4-chat-list" });
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await flush(100);
    await chats().handleSessionRevoked();
    await flush(100);
    expect(router.currentRoute.value.name).toBe("s1-invite");
    w.unmount();
  });
});
