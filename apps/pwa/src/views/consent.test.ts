// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// F1 consent surfaces on S4: the contact-request badge and the group
// invitation strip (an invitation is NOT a membership — the group only
// reaches the chat list after "join").

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bindApiClient, useChatsStore, useContactsStore, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { groupInviteFx } from "@openglass/core/api/mock/fixtures";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S4ChatList from "./S4ChatList.vue";

const ctx = createMockNodeApiClient({ mode: "mock", baseUrl: "/api/v1", wsUrl: "/api/v1/ws" });
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

const chats = () => useChatsStore(pinia);
const contacts = () => useContactsStore(pinia);

async function flush(ms = 400) {
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  localStorage.clear();
  const session = useSessionStore(pinia);
  await session.requestOtp("jojou@openglass.demo");
  await session.verifyOtp("123456", "vitest");
});
afterAll(() => ctx.server.close());

describe("S4 consent surfaces", () => {
  it("shows the pending-request count on the contacts entry", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await flush();
    expect(contacts().requestCount).toBe(2);
    expect(w.find('[data-testid="requests-badge"]').text()).toBe("2");
  });

  it("lists the group invitation but not the group itself", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await flush();
    const inv = w.findAll('[data-testid="group-invite"]');
    expect(inv).toHaveLength(1);
    expect(inv[0]!.text()).toContain(groupInviteFx.title);
    expect(inv[0]!.text()).toContain(groupInviteFx.inviter.displayName);
    // an invitation is not a chat: the list shows no row for it
    expect(chats().chats.some((c) => c.id === groupInviteFx.chatId)).toBe(false);
  });

  it("join turns the invitation into a chat", async () => {
    const w = mount(S4ChatList, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="invite-accept"]').trigger("click");
    await flush();
    expect(chats().invites).toHaveLength(0);
    expect(chats().chats.some((c) => c.id === groupInviteFx.chatId)).toBe(true);
    expect(w.find('[data-testid="group-invites"]').exists()).toBe(false);
  });

  it("ws group.invite lists an invitation once; group.invite.resolved clears it", async () => {
    const inv = { ...groupInviteFx, chatId: "c0000000-0000-4000-8000-0000000000aa", title: "late" };
    chats().onGroupInvite(inv);
    chats().onGroupInvite(inv); // replay-safe
    expect(chats().invites.filter((i) => i.chatId === inv.chatId)).toHaveLength(1);
    expect(chats().chats.some((c) => c.id === inv.chatId)).toBe(false);
    chats().onGroupInviteResolved(inv.chatId);
    expect(chats().invites.some((i) => i.chatId === inv.chatId)).toBe(false);
  });
});
