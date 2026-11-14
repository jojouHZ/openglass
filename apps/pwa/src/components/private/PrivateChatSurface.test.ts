// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, ChatSummary, User } from "@openglass/core";
import { bindApiClient, useChatsStore } from "@openglass/core";
import type { PrivateSessionView } from "@openglass/core/private/remote";
import PrivateChatSurface from "./PrivateChatSurface.vue";
import PrivateSheet from "./PrivateSheet.vue";

const events = { typingStart: vi.fn(), typingStop: vi.fn() };
bindApiClient({ events } as unknown as ApiClient);

function setup(verified = true) {
  const snapshot: PrivateSessionView = {
    sessionId: "session", peerId: "peer", status: verified ? "verified" : "exchanging",
    sas: null, messages: [], ttlEndsAt: null, peerOfflineUntil: null, canSend: verified,
  };
  const remote = {
    watchSession: (_: string, cb: (value: PrivateSessionView) => void) => { cb(snapshot); return vi.fn(); },
    watchVerification: (_: string, cb: (value: unknown) => void) => { cb({ state: "verified" }); return vi.fn(); },
    watchRelayState: (cb: (value: string) => void) => { cb("online"); return vi.fn(); },
    watchInvites: (cb: (value: unknown) => void) => { cb({ incoming: [], outgoing: [] }); return vi.fn(); },
    watchActiveSessions: (cb: (value: PrivateSessionView[]) => void) => { cb([snapshot]); return vi.fn(); },
    send: vi.fn(async () => {}), purgeRead: vi.fn(), markDisplayed: vi.fn(), burn: vi.fn(),
    startInvite: vi.fn(), accept: vi.fn(),
  };
  const pinia = createPinia();
  const chats = useChatsStore(pinia);
  chats.chats.push({
    id: "chat", type: "direct", title: null, memberCount: 2, pinned: false,
    lastActivityAt: new Date(0).toISOString(), unreadCount: 0,
    peer: { id: "peer", displayName: "Bob" } as User,
  } as ChatSummary);
  const wrapper = mount(PrivateChatSurface, {
    props: { peerId: "peer", peerName: "Bob", blocked: false },
    global: { provide: { "og.private": remote }, plugins: [pinia] },
  });
  return { wrapper, remote };
}

describe("same-window private surface", () => {
  it("sends through the private remote with the view-once choice and purges on exit", async () => {
    const { wrapper, remote } = setup();
    await wrapper.get('[data-testid="priv-input"]').setValue("private only");
    await wrapper.get('[data-testid="view-once-toggle"]').trigger("click");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(remote.send).toHaveBeenCalledWith("session", "private only", { viewOnce: true });
    expect((wrapper.get('[data-testid="priv-input"]').element as HTMLTextAreaElement).value).toBe("");
    wrapper.unmount();
    expect(remote.purgeRead).toHaveBeenCalledWith("session");
  });

  it("emits typing.start over the public channel while typing privately", async () => {
    events.typingStart.mockClear();
    events.typingStop.mockClear();
    const { wrapper } = setup();
    await wrapper.get('[data-testid="priv-input"]').setValue("draft");
    expect(events.typingStart).toHaveBeenCalledWith("chat");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(events.typingStop).toHaveBeenCalledWith("chat");
  });

  it("cannot send while keys are exchanging or contact consent is removed", async () => {
    const { wrapper, remote } = setup(false);
    expect(wrapper.get('[data-testid="priv-input"]').attributes("disabled")).toBeDefined();
    await wrapper.get("form").trigger("submit");
    expect(remote.send).not.toHaveBeenCalled();
    wrapper.unmount();
    const ready = setup();
    await ready.wrapper.setProps({ blocked: true });
    expect(ready.wrapper.get('[data-testid="priv-input"]').attributes("disabled")).toBeDefined();
    await ready.wrapper.get("form").trigger("submit");
    expect(ready.remote.send).not.toHaveBeenCalled();
    ready.wrapper.unmount();
  });
});

describe("private session settings sheet", () => {
  it("emits chosen options and persists only lifetime/strict when asked", async () => {
    localStorage.clear();
    const wrapper = mount(PrivateSheet, { props: { open: true } });
    await wrapper.get('[data-testid="ttl-300"]').trigger("click");
    await wrapper.get('[data-testid="opt-remember"]').trigger("click");
    expect(wrapper.text()).toContain("can't read messages");
    await wrapper.get('[data-testid="sheet-start"]').trigger("click");
    expect(wrapper.emitted("start")).toEqual([[{ ttlSeconds: 300, strict: false }]]);
    expect(JSON.parse(localStorage.getItem("og.private.prefs")!)).toEqual({ ttlSeconds: 300, strict: false, pattern: true });
    wrapper.unmount();
    localStorage.clear();
  });

  it("rejects malformed stored preferences instead of crashing", () => {
    localStorage.setItem("og.private.prefs", "{broken");
    expect(() => mount(PrivateSheet, { props: { open: true } })).not.toThrow();
    localStorage.clear();
  });
});
