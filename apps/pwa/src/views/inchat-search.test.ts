// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S5 in-chat search — a live-QA find: valid no-match queries and
// sub-minLength input produced zero feedback, looking like a dead box.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bindApiClient, useChatsStore, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S5ChatView from "./S5ChatView.vue";

const DIRECT = "c0000000-0000-4000-8000-000000000001";

const ctx = createMockNodeApiClient({ mode: "mock", baseUrl: "/api/v1", wsUrl: "/api/v1/ws" });
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());
const session = () => useSessionStore(pinia);
const chats = () => useChatsStore(pinia);
const flush = async (ms = 400) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  localStorage.clear();
  await session().requestOtp("jojou@openglass.demo");
  await session().verifyOtp("123456", "vitest");
});
afterAll(() => { chats().disconnectRealtime(); ctx.server.close(); });

async function mountSearch() {
  await router.push({ name: "s5-chat-view", params: { chatId: DIRECT } });
  const w = mount(S5ChatView, {
    global: { plugins: [router, pinia] },
    attachTo: document.body,
  });
  await flush(600);
  await w.find('[aria-label="chat menu"]').trigger("click");
  await w.findAll("button").find((b) => b.text() === "search")!.trigger("click");
  return w;
}

describe("S5 in-chat search", () => {
  it("finds a fragment, shows the counter, jumps to the match", async () => {
    const w = await mountSearch();
    const target = chats().window(DIRECT).messages.find((m) => (m.text?.length ?? 0) > 4)!;
    await w.find('[data-testid="search-input"]').setValue(target.text!.slice(0, 6));
    await flush();
    const count = w.find('[data-testid="search-count"]');
    expect(count.exists()).toBe(true);
    expect(count.text()).toMatch(/^1 of \d+$/);
    // the window was re-centered around the match via `around`
    expect(chats().window(DIRECT).messages.some((m) => m.id === target.id)).toBe(true);
    w.unmount();
  });

  it("valid query with zero matches shows feedback instead of silence", async () => {
    const w = await mountSearch();
    await w.find('[data-testid="search-input"]').setValue("zzz-no-match");
    await flush();
    expect(w.find('[data-testid="search-empty"]').text()).toBe("no results");
    expect(w.find('[data-testid="search-count"]').exists()).toBe(false);
    w.unmount();
  });

  it("single-char query hits the server — marker-prefix use case", async () => {
    const w = await mountSearch();
    // fixture texts "fixture message N" all contain "x" → matches exist
    await w.find('[data-testid="search-input"]').setValue("x");
    await flush();
    expect(w.find('[data-testid="search-count"]').exists()).toBe(true);
    w.unmount();
  });
});
