// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S6 contacts/search + S7 profile — consent model, real HttpApiClient
// against the MSW node server. Fixture roster: anna/dima/kostya are contacts,
// lena has a pending request FROM me, mira and oleg have pending
// requests TO me, nina is a stranger. Test order matters — the shared
// store reflects mutations across cases (same as a live session).

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  bindApiClient,
  useContactsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { incomingOnly, lena, stranger, suitor } from "@openglass/core/api/mock/fixtures";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S6ContactSearch from "./S6ContactSearch.vue";
import S7ContactProfile from "./S7ContactProfile.vue";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

const session = () => useSessionStore(pinia);
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

describe("S6 contacts and requests", () => {
  it("separates contacts, incoming requests and sent requests", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    const text = (sel: string) => w.findAll(sel).map((n) => n.text());
    // accepted contacts only
    const contactNames = w
      .findAll('[data-testid="user-row"] [data-testid="user-name"]')
      .map((n) => n.text());
    expect(contactNames).toEqual(expect.arrayContaining(["anna", "dima", "kostya"]));
    expect(contactNames).not.toContain("lena");
    expect(contactNames).not.toContain("mira");
    // incoming requests offer accept / decline
    expect(w.find('[data-testid="requests-header"]').text()).toContain("2");
    expect(text('[data-testid="incoming-request"] [data-testid="user-name"]')).toEqual(
      expect.arrayContaining(["mira", "oleg"]),
    );
    expect(w.findAll('[data-testid="req-accept"]')).toHaveLength(2);
    // a sent request is pending + cancelable, never a contact
    expect(text('[data-testid="outgoing-request"] [data-testid="user-name"]')).toEqual(["lena"]);
    expect(w.find('[data-testid="req-cancel"]').exists()).toBe(true);
    expect(contacts().isContact(lena.id)).toBe(false);
  });

  it("queries filter the local roster without duplicating global hits", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="contact-search-input"]').setValue("an");
    await flush(400);
    const names = w.findAll('[data-testid="user-name"]').map((n) => n.text());
    expect(names).toContain("anna");
    expect(names.filter((n) => n === "anna")).toHaveLength(1);
  });

  it("global result sends a request — it becomes 'requested', never a contact", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="contact-search-input"]').setValue("nina");
    await flush(400); // debounce 300 + latency
    const addBtn = w.find('[data-testid="add-contact"]');
    expect(addBtn.exists()).toBe(true);
    await addBtn.trigger("click");
    await flush();
    expect(contacts().hasOutgoing(stranger.id)).toBe(true);
    expect(contacts().isContact(stranger.id)).toBe(false);
    expect(w.find('[data-testid="add-contact"]').exists()).toBe(false);
    expect(w.find('[data-testid="request-sent"]').text()).toContain("requested");
  });

  it("accepting an incoming request creates the contact", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    const row = w
      .findAll('[data-testid="incoming-request"]')
      .find((r) => r.text().includes("mira"))!;
    await row.find('[data-testid="req-accept"]').trigger("click");
    await flush();
    expect(contacts().isContact(incomingOnly.id)).toBe(true);
    expect(contacts().hasIncoming(incomingOnly.id)).toBe(false);
  });

  it("cancel withdraws a sent request", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    const row = w
      .findAll('[data-testid="outgoing-request"]')
      .find((r) => r.text().includes("lena"))!;
    await row.find('[data-testid="req-cancel"]').trigger("click");
    await flush();
    expect(contacts().hasOutgoing(lena.id)).toBe(false);
  });

  it("row tap navigates to S7", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    await w.findAll('[data-testid="user-row"]')[0]!.trigger("click");
    await flush();
    expect(router.currentRoute.value.name).toBe("s7-contact-profile");
  });
});

describe("S7 contact profile", () => {
  it("mutual contact shows message + remove; message opens the direct chat", async () => {
    await router.push({ name: "s7-contact-profile", params: { userId: incomingOnly.id } });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    // mira was accepted in the S6 test above — now mutual
    expect(w.find('[data-testid="badge"]').text()).toContain("mutual");
    await w.find('[data-testid="action-message"]').trigger("click");
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe("s5-chat-view");
    });
    expect(w.find('[data-testid="action-remove"]').exists()).toBe(true);
  });

  it("incoming request offers accept / decline; decline is final for the target", async () => {
    await router.push({ name: "s7-contact-profile", params: { userId: suitor.id } });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    expect(w.find('[data-testid="badge"]').text()).toContain("wants to connect");
    expect(w.find('[data-testid="action-accept"]').exists()).toBe(true);
    expect(w.find('[data-testid="action-message"]').exists()).toBe(false);
    await w.find('[data-testid="action-decline"]').trigger("click");
    await flush();
    expect(contacts().hasIncoming(suitor.id)).toBe(false);
    expect(contacts().isContact(suitor.id)).toBe(false);
    // back to a stranger: the target can send their own request later
    expect(w.find('[data-testid="action-add"]').exists()).toBe(true);
  });

  it("outgoing request shows pending state with resend and cancel", async () => {
    await router.push({ name: "s7-contact-profile", params: { userId: stranger.id } });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    // nina was requested in the S6 test
    expect(w.find('[data-testid="badge"]').text()).toContain("request sent");
    expect(w.find('[data-testid="request-pending"]').exists()).toBe(true);
    expect(w.find('[data-testid="action-remove"]').exists()).toBe(false);
    await w.find('[data-testid="action-resend"]').trigger("click");
    await flush();
    expect(contacts().outgoing.filter((r) => r.user.id === stranger.id)).toHaveLength(1);
    await w.find('[data-testid="action-cancel"]').trigger("click");
    await flush();
    expect(contacts().hasOutgoing(stranger.id)).toBe(false);
    expect(w.find('[data-testid="action-add"]').exists()).toBe(true);
  });

  it("removing a mutual contact needs confirmation and drops both sides", async () => {
    await router.push({ name: "s7-contact-profile", params: { userId: incomingOnly.id } });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="action-remove"]').trigger("click");
    expect(w.find('[data-testid="confirm-dialog"]').exists()).toBe(true);
    await w.find('[data-testid="confirm-action"]').trigger("click");
    await flush();
    expect(contacts().isContact(incomingOnly.id)).toBe(false);
    expect(w.find('[data-testid="action-add"]').exists()).toBe(true);
  });

  it("unknown user renders the not-found state", async () => {
    await router.push({
      name: "s7-contact-profile",
      params: { userId: "00000000-0000-4000-8000-0000000000ff" },
    });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    expect(w.find('[data-testid="not-found"]').exists()).toBe(true);
  });
});
