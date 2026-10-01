// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S9a group management — real HttpApiClient against the MSW node server.
// Fixture group: jojou=owner (all rights), anna=member+invite, dima=member.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bindApiClient,
  useChatsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { groupChatId, groupPal } from "@openglass/core/api/mock/fixtures";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S9aGroupManage from "./S9aGroupManage.vue";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

const session = () => useSessionStore(pinia);
const chats = () => useChatsStore(pinia);

async function flush(ms = 350) {
  await new Promise((r) => setTimeout(r, ms));
}

async function mountManage() {
  await router.push({ name: "s9a-group-manage", params: { chatId: groupChatId } });
  const w = mount(S9aGroupManage, { global: { plugins: [router, pinia] } });
  await flush();
  return w;
}

beforeAll(async () => {
  localStorage.clear();
  await session().requestOtp("jojou@openglass.demo");
  await session().verifyOtp("123456", "vitest");
});
afterAll(() => ctx.server.close());

describe("S9a group management", () => {
  it("lists members with role and rights labels", async () => {
    const w = await mountManage();
    const rows = w.findAll('[data-testid="member-row"]');
    expect(rows).toHaveLength(3);
    expect(w.text()).toContain("3 members");
    // owner row labeled, anna shows her invite chip, dima shows tag
    expect(w.findAll('[data-testid="user-tag"]').map((t) => t.text())).toEqual(
      expect.arrayContaining(["you", "invite", "dima#5150"]),
    );
  });

  it("owner opens member sheet; rights toggle patches the member", async () => {
    const w = await mountManage();
    const dimaRow = w.findAll('[data-testid="member-row"]').find((r) => r.text().includes("dima"));
    await dimaRow!.trigger("click");
    const sheet = w.find('[data-testid="member-sheet"]');
    expect(sheet.exists()).toBe(true);
    // grant pinMessages — label moves from tag to a chip list
    await sheet.find('[data-testid="right-pinMessages"]').trigger("click");
    await vi.waitFor(() => {
      const dima = chats().details[groupChatId]?.members?.find((m) => m.user.id === groupPal.id);
      expect(dima?.rights?.pinMessages).toBe(true);
    });
  });

  it("add member picker excludes existing members", async () => {
    const w = await mountManage();
    await w.find('[data-testid="add-member"]').trigger("click");
    await flush();
    const names = w.findAll('[data-testid="add-row"] [data-testid="user-name"]').map((n) => n.text());
    expect(names).not.toContain("anna");
    expect(names).not.toContain("dima");
    expect(names).toContain("kostya");
    await w.find('[data-testid="add-row"]').trigger("click");
    await w.find('[data-testid="add-confirm"]').trigger("click");
    await vi.waitFor(() => {
      expect(chats().details[groupChatId]?.members).toHaveLength(4);
    });
  });

  it("leave group removes the chat locally and returns to S4", async () => {
    const w = await mountManage();
    await w.find('[data-testid="leave-group"]').trigger("click");
    await w.find('[data-testid="confirm-action"]').trigger("click");
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s4-chat-list");
    });
    expect(chats().details[groupChatId]).toBeUndefined();
    await vi.waitFor(() => {
      expect(chats().chats.find((c) => c.id === groupChatId)).toBeUndefined();
    });
  });
});
