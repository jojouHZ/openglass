// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S8 group creation — real HttpApiClient against the MSW node server.
// Picker must offer contacts only (B3 rule), create must land the chat
// in the store and navigate to the conversation (S9 lands in A.4).

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bindApiClient,
  useChatsStore,
  useContactsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S8GroupCreate from "./S8GroupCreate.vue";
import S6ContactSearch from "./S6ContactSearch.vue";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

const session = () => useSessionStore(pinia);
const chats = () => useChatsStore(pinia);
const contacts = () => useContactsStore(pinia);

async function flush(ms = 350) {
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  localStorage.clear();
  await session().requestOtp("jojou@openglass.demo");
  await session().verifyOtp("123456", "vitest");
});
afterAll(() => ctx.server.close());

describe("S8 group creation", () => {
  it("picker lists contacts only — no strangers, no self", async () => {
    await router.push({ name: "s8-group-create" });
    const w = mount(S8GroupCreate, { global: { plugins: [router, pinia] } });
    await flush();
    const names = w.findAll('[data-testid="member-row"] [data-testid="user-name"]').map((n) => n.text());
    // fixture roster: anna, kostya, dima — mira is incoming-only, not in the list
    expect(names).toContain("anna");
    expect(names).toContain("dima");
    expect(names).not.toContain("mira");
    expect(names).not.toContain("jojou");
    // create disabled until title + ≥1 member
    expect(w.find('[data-testid="create"]').attributes("disabled")).toBeDefined();
  });

  it("select toggles the counter; create posts and navigates to the chat", async () => {
    const w = mount(S8GroupCreate, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('input[placeholder="ops room"]').setValue("test crew");
    const rows = w.findAll('[data-testid="member-row"]');
    await rows[0]!.trigger("click");
    await rows[1]!.trigger("click");
    // toggle off once — selection must shrink
    await rows[1]!.trigger("click");
    await vi.waitFor(() => {
      expect(w.find('[data-testid="member-count"]').text()).toContain("1 selected");
    });
    await rows[1]!.trigger("click");
    await vi.waitFor(() => {
      expect(w.find('[data-testid="member-count"]').text()).toContain("2 selected");
    });

    await w.find('[data-testid="create"]').trigger("click");
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s5-chat-view");
    });
    const chatId = String(router.currentRoute.value.params.chatId);
    const detail = chats().details[chatId];
    expect(detail?.type).toBe("group");
    expect(detail?.title).toBe("test crew");
    // owner + 2 picked members
    expect(detail?.members).toHaveLength(3);
    expect(contacts().list.length).toBeGreaterThan(0);
  });

  it("S6 exposes the new-group entry", async () => {
    await router.push({ name: "s6-contact-search" });
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="new-group"]').trigger("click");
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s8-group-create");
    });
  });
});
