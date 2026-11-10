// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { VerificationView } from "@openglass/core/private/remote";
import DeviceVerification from "./DeviceVerification.vue";

function setup(fail = false) {
  let callback: (view: VerificationView) => void = () => {};
  const view: VerificationView = {
    peerId: "peer", state: "pending",
    fingerprint: { symbols: [0, 1, 2, 3, 4, 5], digits: "123456" },
    devices: [{ keyId: "key1", publicKey: "public", label: "<img src=x onerror=alert(1)>" }],
  };
  const remote = {
    watchVerification: (_: string, cb: typeof callback) => {
      callback = cb;
      cb({ ...view, fingerprint: null, devices: [] });
      return vi.fn();
    },
    startVerification: vi.fn(async () => {
      if (fail) throw new Error("private internal diagnostic");
      callback({ ...view });
    }),
    confirmVerification: vi.fn(async () => callback({ ...view, state: "verified" })),
    rejectVerification: vi.fn(),
  };
  const wrapper = mount(DeviceVerification, {
    props: { peerId: "peer", peerName: "Bob" },
    global: { provide: { "og.private": remote } },
  });
  return { wrapper, remote };
}

describe("in-chat device verification", () => {
  it("renders the comparison, escapes labels, and confirms only via the remote", async () => {
    const { wrapper, remote } = setup();
    await flushPromises();
    expect(wrapper.get('[data-testid="verification-digits"]').text()).toBe("123456");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.get("option").text()).toContain("<img");
    await wrapper.get('[data-testid="verification-confirm"]').trigger("click");
    await flushPromises();
    expect(remote.confirmVerification).toHaveBeenCalledWith("peer");
    expect(wrapper.emitted("confirmed")).toHaveLength(1);
    wrapper.unmount();
  });

  it("surfaces directory failure without enabling confirmation or leaking diagnostics", async () => {
    const { wrapper, remote } = setup(true);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("could not be loaded");
    expect(wrapper.text()).not.toContain("private internal diagnostic");
    expect(wrapper.get('[data-testid="verification-confirm"]').attributes("disabled")).toBeDefined();
    expect(remote.confirmVerification).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="verification-reject"]').trigger("click");
    expect(remote.rejectVerification).toHaveBeenCalledWith("peer");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    wrapper.unmount();
  });
});
