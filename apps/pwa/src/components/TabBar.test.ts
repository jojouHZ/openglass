// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Root navigation: Chats · Contacts · Settings. The bar belongs to the shell
// and appears on root screens only — never inside a chat or a sub-screen.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { bindApiClient, useContactsStore, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import App from "../App.vue";
import { pinia } from "../pinia";
import { createAppRouter, routes } from "../router";
import TabBar from "./TabBar.vue";

const ctx = createMockNodeApiClient({ mode: "mock", baseUrl: "/api/v1", wsUrl: "/api/v1/ws" });
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

beforeAll(async () => {
  localStorage.clear();
  const session = useSessionStore(pinia);
  await session.requestOtp("jojou@openglass.demo");
  await session.verifyOtp("123456", "vitest");
});
afterAll(() => ctx.server.close());

describe("which routes show the bar", () => {
  it("exactly the three root screens opt in", () => {
    const withNav = routes.filter((r) => r.meta?.nav).map((r) => r.name);
    expect(withNav.sort()).toEqual(["s13-settings", "s4-chat-list", "s6-contact-search"]);
  });

  it("every other screen — chat, profile, group, security, auth, private — has no bar", () => {
    for (const r of routes) {
      if (["s4-chat-list", "s6-contact-search", "s13-settings"].includes(String(r.name))) continue;
      expect(r.meta?.nav, String(r.name)).toBeFalsy();
    }
  });

  it("the shell renders the bar on a root screen and drops it inside a chat", async () => {
    await router.push({ name: "s4-chat-list" });
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => {
      expect(w.find('[data-testid="tab-bar"]').exists()).toBe(true);
    });
    await router.push({ name: "s5-chat-view", params: { chatId: "anything" } });
    await vi.waitFor(() => {
      expect(w.find('[data-testid="tab-bar"]').exists()).toBe(false);
    });
    await router.push({ name: "s13-settings" });
    await vi.waitFor(() => {
      expect(w.find('[data-testid="tab-bar"]').exists()).toBe(true);
    });
    await router.push({ name: "s14-security" });
    await vi.waitFor(() => {
      expect(w.find('[data-testid="tab-bar"]').exists()).toBe(false);
    });
    w.unmount();
  });
});

describe("TabBar", () => {
  it("marks the current tab and navigates between roots", async () => {
    await router.push({ name: "s4-chat-list" });
    const w = mount(TabBar, { global: { plugins: [router, pinia] } });
    const cur = (id: string) => w.find(`[data-testid="tab-${id}"]`).attributes("aria-current");
    expect(cur("chats")).toBe("page");
    expect(cur("contacts")).toBeUndefined();

    await w.find('[data-testid="tab-contacts"]').trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("s6-contact-search"));
    expect(cur("contacts")).toBe("page");
    expect(cur("chats")).toBeUndefined();

    await w.find('[data-testid="tab-settings"]').trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("s13-settings"));
    expect(cur("settings")).toBe("page");
    w.unmount();
  });

  it("the legacy /search path still lights up the Contacts tab", async () => {
    await router.push("/search");
    const w = mount(TabBar, { global: { plugins: [router, pinia] } });
    expect(w.find('[data-testid="tab-contacts"]').attributes("aria-current")).toBe("page");
    w.unmount();
  });

  it("badges pending contact requests on Contacts only, live", async () => {
    await router.push({ name: "s4-chat-list" });
    const w = mount(TabBar, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => {
      expect(w.find('[data-testid="requests-badge"]').exists()).toBe(true);
    });
    expect(w.find('[data-testid="requests-badge"]').text()).toBe("2");
    expect(w.find('[data-testid="tab-contacts"] [data-testid="requests-badge"]').exists()).toBe(true);
    expect(w.find('[data-testid="tab-chats"] [data-testid="requests-badge"]').exists()).toBe(false);

    const contacts = useContactsStore(pinia);
    await contacts.accept(contacts.incoming[0]!.user.id);
    await vi.waitFor(() => expect(w.find('[data-testid="requests-badge"]').text()).toBe("1"));
    for (const r of [...contacts.incoming]) await contacts.accept(r.user.id);
    await vi.waitFor(() => expect(w.find('[data-testid="requests-badge"]').exists()).toBe(false));
    w.unmount();
  });
});

describe("signed out", () => {
  it("there is no bar — the auth screens are not root screens", async () => {
    await useSessionStore(pinia).logout().catch(() => undefined);
    await router.push({ name: "s4-chat-list" }); // guard bounces to the invite screen
    const w = mount(App, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("s1-invite"));
    expect(w.find('[data-testid="tab-bar"]').exists()).toBe(false);
    w.unmount();
  });
});
