// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S13 settings + S14 security — real HttpApiClient against the MSW node
// server. Covers profile edit, session list, revoke, and the sign-out
// teardown path (no cross-account data leaks).

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
import S13Settings from "./S13Settings.vue";
import S14Security from "./S14Security.vue";

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

describe("S13 settings", () => {
  it("shows the profile card and edits the display name", async () => {
    await router.push({ name: "s13-settings" });
    const w = mount(S13Settings, { global: { plugins: [router, pinia] } });
    await flush();
    expect(w.find('[data-testid="display-name"]').text()).toBe("jojou");
    expect(w.find('[data-testid="tag"]').text()).toBe("jojou#1042");

    await w.find('[data-testid="edit-profile"]').trigger("click");
    await w.find('input[placeholder="display name"]').setValue("jojou renamed");
    await w.find('[data-testid="name-save"]').trigger("click");
    await vi.waitFor(() => {
      expect(session().user?.displayName).toBe("jojou renamed");
    });
    expect(w.find('[data-testid="display-name"]').text()).toBe("jojou renamed");
  });

  it("sign out tears down chats + contacts and lands on S1", async () => {
    // dirty the shared stores the way a real session would
    await chats().refreshChats();
    await contacts().refresh();
    expect(chats().chats.length).toBeGreaterThan(0);
    expect(contacts().list.length).toBeGreaterThan(0);

    await router.push({ name: "s13-settings" });
    const w = mount(S13Settings, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="sign-out"]').trigger("click");
    await w.find('[data-testid="confirm-action"]').trigger("click");
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s1-invite");
    });
    expect(session().user).toBeNull();
    expect(chats().chats).toHaveLength(0);
    expect(Object.keys(chats().details)).toHaveLength(0);
    expect(contacts().list).toHaveLength(0);
    expect(localStorage.getItem("og.session")).toBeNull();
  });
});

describe("S14 security", () => {
  it("lists sessions with the current badge and revokes others", async () => {
    // sign back in — the previous case ended the session
    await session().requestOtp("jojou@openglass.demo");
    await session().verifyOtp("123456", "vitest");

    await router.push({ name: "s14-security" });
    const w = mount(S14Security, { global: { plugins: [router, pinia] } });
    await flush();

    const rows = w.findAll('[data-testid="session-row"]');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(w.text()).toContain("this device");
    // fixture: 1 current + 1 other — revoke the other
    const before = session().sessions.filter((s) => !s.current).length;
    await w.find('[data-testid^="revoke-d"]').trigger("click");
    await vi.waitFor(() => {
      expect(w.find('[data-testid="confirm-action"]').exists()).toBe(true);
    });
    await w.find('[data-testid="confirm-action"]').trigger("click");
    // wait for the count to actually drop — the poll must not pass early
    await vi.waitFor(() => {
      expect(session().sessions.filter((s) => !s.current)).toHaveLength(before - 1);
    });
    await flush();
    // revoke-all covers the multi-device case — same code path per session
    if (session().sessions.some((s) => !s.current)) {
      await w.find('[data-testid="revoke-all"]').trigger("click");
      await vi.waitFor(() => {
        expect(w.find('[data-testid="confirm-action"]').exists()).toBe(true);
      });
      await w.find('[data-testid="confirm-action"]').trigger("click");
      await vi.waitFor(() => {
        expect(session().sessions.every((s) => s.current)).toBe(true);
      });
    }
    await vi.waitFor(() => {
      expect(w.find('[data-testid="revoke-all"]').exists()).toBe(false);
    });
  });
});
