// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S15 — PWA prompt cards: install state machine (deferred prompt /
// manual iOS / already installed) + live connectivity card.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { useChatsStore, useSessionStore } from "@openglass/core";

import App from "../App.vue";
import { pinia } from "../pinia";
import { initInstallPrompt } from "../pwa/install";
import { createAppRouter } from "../router";
import S15Pwa from "./S15Pwa.vue";

const flush = async (ms = 50) => new Promise((r) => setTimeout(r, ms));

class FakeInstallPromptEvent extends Event {
  prompt = vi.fn(async () => {});
  userChoice = Promise.resolve({ outcome: "accepted" as const });
}

describe("S15 PWA prompts", () => {
  const mountView = async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push({ name: "s15-pwa" });
    const w = mount(S15Pwa, { global: { plugins: [router, pinia] } });
    await flush();
    return w;
  };

  beforeAll(() => {
    initInstallPrompt();
  });

  it("shows the manual/unavailable install state when no prompt event fired", async () => {
    const w = await mountView();
    expect(w.find('[data-testid="card-install"]').exists()).toBe(true);
    expect(w.find('[data-testid="install-unavailable"]').exists()).toBe(true);
    expect(w.find('[data-testid="install-prompt"]').exists()).toBe(false);
  });

  it("shows the install button once beforeinstallprompt was captured", async () => {
    const ev = new FakeInstallPromptEvent("beforeinstallprompt");
    window.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), {
      prompt: ev.prompt,
      userChoice: ev.userChoice,
    }));
    const w = await mountView();
    const btn = w.find('[data-testid="install-prompt"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    await flush();
    expect(ev.prompt).toHaveBeenCalled();
    // accepted → installed state
    expect(w.find('[data-testid="install-done"]').exists()).toBe(true);
  });

  it("reflects the realtime connectivity state in the offline card", async () => {
    const chats = useChatsStore(pinia);
    chats.connState = "offline";
    const w = await mountView();
    expect(w.find('[data-testid="offline-state"]').text()).toContain("offline now");
    chats.connState = "online";
    await w.vm.$nextTick();
    expect(w.find('[data-testid="offline-state"]').text()).toContain("online now");
  });

  it("App shell shows the conn banner only after a realtime attempt", async () => {
    const session = useSessionStore(pinia);
    session.user = {
      id: "u1", tag: "t#1", displayName: "T", avatarUrl: null, createdAt: "",
    };
    const chats = useChatsStore(pinia);
    const router = createAppRouter(createMemoryHistory());
    const w = mount(App, { global: { plugins: [router, pinia] } });

    // authed but WS never attempted → no false "offline" flash
    chats.connState = "offline";
    await w.vm.$nextTick();
    expect(w.find('[data-testid="conn-banner"]').exists()).toBe(false);

    chats.wsConnected = true;
    await w.vm.$nextTick();
    expect(w.find('[data-testid="conn-banner"]').text()).toContain("offline");

    session.user = null;
    chats.wsConnected = false;
    chats.connState = "online";
  });
});
