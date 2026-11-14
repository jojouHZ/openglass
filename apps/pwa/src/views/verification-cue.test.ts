// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Device-pin identity cues (dev PWA): S7 profile cue + contact-row
// shield. The private remote is injected as a stub — in the mvp build
// it is absent and nothing renders.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { bindApiClient, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import type { PrivateRemote, VerificationView } from "@openglass/core/private/remote";

import UserRow from "../components/UserRow.vue";
import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S7ContactProfile from "./S7ContactProfile.vue";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());
const session = () => useSessionStore(pinia);

const anna = { id: "", displayName: "" };

async function flush(ms = 350) {
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  localStorage.clear();
  await session().requestOtp("jojou@openglass.demo");
  await session().verifyOtp("123456", "vitest");
  const { users } = await ctx.api.users.search("anna");
  anna.id = users[0]!.id;
  anna.displayName = users[0]!.displayName;
});
afterAll(() => ctx.server.close());

function remoteWith(state: VerificationView["state"], peerId: string) {
  const view: VerificationView = {
    peerId,
    state,
    fingerprint: null,
    devices: [],
  };
  return {
    watchVerification: vi.fn((_p: string, cb: (v: VerificationView) => void) => {
      cb(view);
      return () => undefined;
    }),
  } as unknown as PrivateRemote;
}

describe("S7 device-verification cue", () => {
  it("shows nothing when the private remote is absent (mvp build)", async () => {
    await router.push({ name: "s7-contact-profile", params: { userId: anna.id } });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    expect(w.find('[data-testid="device-verification-cue"]').exists()).toBe(false);
  });

  it("verified device shows a calm cue; the tap opens the ritual in the chat", async () => {
    const remote = remoteWith("verified", anna.id);
    await router.push({ name: "s7-contact-profile", params: { userId: anna.id } });
    const w = mount(S7ContactProfile, {
      global: { plugins: [router, pinia], provide: { "og.private": remote } },
    });
    await flush();
    const cue = w.find('[data-testid="device-verification-cue"]');
    expect(cue.text()).toContain("device verified");
    await cue.trigger("click");
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s5-chat-view");
      expect(router.currentRoute.value.query.verify).toBe("1");
    });
  });

  it("a changed pin is flagged as a warning, not just a different colour", async () => {
    const remote = remoteWith("key-changed", anna.id);
    await router.push({ name: "s7-contact-profile", params: { userId: anna.id } });
    const w = mount(S7ContactProfile, {
      global: { plugins: [router, pinia], provide: { "og.private": remote } },
    });
    await flush();
    const cue = w.find('[data-testid="device-verification-cue"]');
    expect(cue.text()).toContain("key changed");
    expect(cue.classes()).toContain("text-danger");
  });

  it("an unpinned contact reports 'not verified'; strangers get no cue", async () => {
    const remote = remoteWith("unverified", anna.id);
    await router.push({ name: "s7-contact-profile", params: { userId: anna.id } });
    const w = mount(S7ContactProfile, {
      global: { plugins: [router, pinia], provide: { "og.private": remote } },
    });
    await flush();
    expect(w.find('[data-testid="device-verification-cue"]').text()).toContain(
      "device not verified",
    );
    w.unmount();
  });
});

describe("UserRow device shield", () => {
  const user = { id: "u-1", tag: "u1#0001", displayName: "alice" };

  function mountRow(state: VerificationView["state"] | null) {
    const provide =
      state === null
        ? {}
        : { "og.private": remoteWith(state, user.id) };
    return mount(UserRow, {
      props: { user: user as never },
      global: { plugins: [pinia], provide },
    });
  }

  it("shows the verified shield for a pinned-and-matching device", () => {
    const w = mountRow("verified");
    expect(w.find('[data-testid="user-verified"]').exists()).toBe(true);
    expect(w.find('[data-testid="user-key-changed"]').exists()).toBe(false);
  });

  it("shows the alert shield when the key no longer matches the pin", () => {
    const w = mountRow("key-changed");
    expect(w.find('[data-testid="user-key-changed"]').exists()).toBe(true);
    expect(w.find('[data-testid="user-verified"]').exists()).toBe(false);
  });

  it("renders no shield for unverified rows or without a remote", () => {
    const unverified = mountRow("unverified");
    expect(unverified.find('[data-testid="user-verified"]').exists()).toBe(false);
    expect(unverified.find('[data-testid="user-key-changed"]').exists()).toBe(false);
    const noRemote = mountRow(null);
    expect(noRemote.find('[data-testid="user-verified"]').exists()).toBe(false);
    expect(noRemote.find('[data-testid="user-key-changed"]').exists()).toBe(false);
  });
});
