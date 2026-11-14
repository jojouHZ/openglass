// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import type { PrivateInvitesView, PrivateSessionView } from "@openglass/core/private/remote";
import PrivateInviteCard from "./PrivateInviteCard.vue";

function setup(view: Partial<PrivateInvitesView>, active: PrivateSessionView[] = []) {
  const invites: PrivateInvitesView = { incoming: [], outgoing: [], missed: [], declined: [], ...view };
  const remote = {
    watchInvites: (cb: (v: PrivateInvitesView) => void) => { cb(invites); return vi.fn(); },
    watchActiveSessions: (cb: (v: PrivateSessionView[]) => void) => { cb(active); return vi.fn(); },
    watchSession: (_: string, cb: (v: PrivateSessionView | null) => void) => { cb(null); return vi.fn(); },
    accept: vi.fn(), decline: vi.fn(), burn: vi.fn(),
  };
  const wrapper = mount(PrivateInviteCard, {
    props: { peerId: "peer", chatId: "chat" },
    global: { provide: { "og.private": remote }, plugins: [createPinia()] },
  });
  return { wrapper, remote };
}

const live = (peerId: string): PrivateSessionView => ({
  sessionId: `s-${peerId}`, peerId, status: "verified",
  sas: null, messages: [], ttlEndsAt: null, peerOfflineUntil: null, canSend: true,
});

describe("private invite card", () => {
  it("shows the busy note when the peer declined from inside a live session", () => {
    const { wrapper } = setup({ declined: [{ peerId: "peer", peerName: "Bob", busy: true }] });
    expect(wrapper.get('[data-testid="private-declined"]').text()).toContain("can't join");
  });

  it("shows the tried-to-invite note for auto-declined invites", () => {
    const { wrapper } = setup({ missed: [{ peerId: "peer", peerName: "Bob" }] });
    expect(wrapper.get('[data-testid="private-missed"]').text()).toContain("tried to invite");
  });

  it("accepts an invite directly when no other session is live", async () => {
    const { wrapper, remote } = setup({
      incoming: [{ sessionId: "inc", peerId: "peer", peerName: "Bob", strict: false, burnOnRead: false }],
    });
    await wrapper.get('[data-testid="private-accept"]').trigger("click");
    await flushPromises();
    expect(remote.accept).toHaveBeenCalledWith("inc");
    expect(wrapper.emitted("verify")).toEqual([["inc"]]);
    expect(remote.burn).not.toHaveBeenCalled();
  });

  it("asks to end the other live session before accepting", async () => {
    const { wrapper, remote } = setup(
      { incoming: [{ sessionId: "inc", peerId: "peer", peerName: "Bob", strict: false, burnOnRead: false }] },
      [live("other-peer")],
    );
    await wrapper.get('[data-testid="private-accept"]').trigger("click");
    expect(remote.accept).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="confirm-action"]').trigger("click");
    expect(remote.burn).toHaveBeenCalledWith("s-other-peer");
    expect(remote.accept).toHaveBeenCalledWith("inc");
  });

  it("cancel keeps the other session and ignores the invite", async () => {
    const { wrapper, remote } = setup(
      { incoming: [{ sessionId: "inc", peerId: "peer", peerName: "Bob", strict: false, burnOnRead: false }] },
      [live("other-peer")],
    );
    await wrapper.get('[data-testid="private-accept"]').trigger("click");
    const cancel = wrapper.findAll("button").find((b) => b.text() === "cancel");
    await cancel!.trigger("click");
    expect(remote.burn).not.toHaveBeenCalled();
    expect(remote.accept).not.toHaveBeenCalled();
  });
});
