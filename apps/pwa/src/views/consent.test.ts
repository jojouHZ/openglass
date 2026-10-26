// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// F1 consent surfaces on S4: the contact-request badge and the group
// invitation strip (an invitation is NOT a membership — the group only
// reaches the chat list after "join").

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ApiRequestError,
  bindApiClient,
  useChatsStore,
  useContactsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { directChatId, groupInviteFx, selfUser, wife } from "@openglass/core/api/mock/fixtures";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S4ChatList from "./S4ChatList.vue";
import S5ChatView from "./S5ChatView.vue";

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

describe("S5 after the pair stops being contacts", () => {
  it("shows a banner and disables sending; reconnecting restores it", async () => {
    await contacts().refresh();
    await router.push({ name: "s5-chat-view", params: { chatId: directChatId } });
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    const input = () => w.find('[data-testid="composer-input"]').element as HTMLTextAreaElement;
    await vi.waitFor(() => {
      expect(w.find('[data-testid="composer-input"]').exists()).toBe(true);
      expect(input().disabled).toBe(false);
    });
    expect(w.find('[data-testid="not-contacts-banner"]').exists()).toBe(false);

    contacts().onContactRemoved(wife.id); // ws contact.removed
    await vi.waitFor(() => {
      expect(w.find('[data-testid="not-contacts-banner"]').text()).toContain("messaging is off");
      expect(input().disabled).toBe(true);
    });
    expect(w.find('[data-testid="msg-scroll"]').exists()).toBe(true); // history still readable

    contacts().onContactAccepted(wife); // ws contact.accepted
    await vi.waitFor(() => {
      expect(w.find('[data-testid="not-contacts-banner"]').exists()).toBe(false);
      expect(input().disabled).toBe(false);
    });
    w.unmount();
  });
});

describe("S5 timeline events (F1.2)", () => {
  async function openDirect() {
    await router.push({ name: "s5-chat-view", params: { chatId: directChatId } });
    const w = mount(S5ChatView, { global: { plugins: [router, pinia] } });
    await vi.waitFor(() => {
      expect(w.find('[data-testid="msg-scroll"] [data-mid]').exists()).toBe(true);
    });
    return w;
  }
  const sys = (id: string, actorId: string) => ({
    id,
    chatId: directChatId,
    seq: 900,
    senderId: actorId,
    text: null,
    clientNonce: id,
    sentAt: new Date().toISOString(),
    pinned: false,
    kind: "system" as const,
    systemEvent: { type: "contact_removed" as const, actorId },
  });

  it("system line reads differently for the actor and for the other party", async () => {
    const w = await openDirect();
    const win = chats().windows[directChatId]!;
    win.messages.push(sys("s-peer", wife.id), sys("s-me", selfUser.id));
    await vi.waitFor(() => {
      expect(w.findAll('[data-testid="system-line"]')).toHaveLength(2);
    });
    const lines = w.findAll('[data-testid="system-line"]').map((l) => l.text());
    expect(lines[0]).toMatch(/^anna removed you from contacts/);
    expect(lines[1]).toMatch(/^You removed anna from contacts/);
    expect(lines[0]).toContain("archive");
    // no actions on a system line
    await w.find('[data-mid="s-peer"]').trigger("contextmenu", { clientX: 5, clientY: 5 });
    expect(document.querySelector('[data-testid="message-menu"]')).toBeFalsy();
    w.unmount();
  });

  it("a retracted message becomes a 'message deleted' tombstone, content gone", async () => {
    const w = await openDirect();
    const target = chats().windows[directChatId]!.messages.find(
      (m) => m.kind !== "system" && m.text,
    )!;
    const text = target.text!;
    chats().markDeleted(target.id);
    await vi.waitFor(() => {
      expect(w.find(`[data-mid="${target.id}"] [data-testid="tombstone"]`).exists()).toBe(true);
    });
    expect(w.find(`[data-mid="${target.id}"]`).text()).not.toContain(text);
    w.unmount();
  });

  it("messages older than 15 minutes offer no edit action", async () => {
    const w = await openDirect();
    const own = chats().windows[directChatId]!.messages.find(
      (m) => m.senderId === selfUser.id && m.kind !== "system" && !m.deletedAt,
    )!;
    // fixture history is days old — outside the window
    await w.find(`[data-mid="${own.id}"]`).trigger("contextmenu", { clientX: 5, clientY: 5 });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="message-menu"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-testid="mi-edit"]')).toBeFalsy();
    expect(document.querySelector('[data-testid="mi-delete"]')).toBeTruthy(); // retract stays
    document.querySelector('[data-testid="menu-scrim"]')?.dispatchEvent(new MouseEvent("click"));
    w.unmount();
  });

  it("a server 403 not_contacts locks the composer even if the list says otherwise", async () => {
    const orig = ctx.api.messages.send;
    ctx.api.messages.send = () =>
      Promise.reject(
        new ApiRequestError(403, {
          code: "forbidden",
          message: "nope",
          details: { reason: "not_contacts" },
        }),
      );
    try {
      contacts().onContactAccepted(wife); // earlier tests left the pair removed
      const w = await openDirect();
      expect(w.find('[data-testid="not-contacts-banner"]').exists()).toBe(false);
      await w.find('[data-testid="composer-input"]').setValue("hello?");
      await w.find('[data-testid="send"]').trigger("click");
      await vi.waitFor(() => {
        expect(w.find('[data-testid="not-contacts-banner"]').exists()).toBe(true);
      });
      expect(
        (w.find('[data-testid="composer-input"]').element as HTMLTextAreaElement).disabled,
      ).toBe(true);
      w.unmount();
    } finally {
      ctx.api.messages.send = orig;
    }
  });
});
