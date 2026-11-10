// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { PrivateSessionView } from "@openglass/core/private/remote";
import PrivateChatSurface from "./PrivateChatSurface.vue";

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
    send: vi.fn(async () => {}), purgeRead: vi.fn(), markDisplayed: vi.fn(), burn: vi.fn(),
  };
  const wrapper = mount(PrivateChatSurface, {
    props: { peerId: "peer", peerName: "Bob", blocked: false },
    global: { provide: { "og.private": remote } },
  });
  return { wrapper, remote };
}

describe("same-window private surface", () => {
  it("sends through the private remote with the view-once choice and purges on exit", async () => {
    const { wrapper, remote } = setup();
    await wrapper.get('[data-testid="priv-input"]').setValue("private only");
    await wrapper.get('[data-testid="view-once-toggle"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(remote.send).toHaveBeenCalledWith("session", "private only", { viewOnce: true });
    expect((wrapper.get('[data-testid="priv-input"]').element as HTMLTextAreaElement).value).toBe("");
    wrapper.unmount();
    expect(remote.purgeRead).toHaveBeenCalledWith("session");
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
