// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// S6 contact search + S7 profile — real HttpApiClient against the MSW
// node server. Fixture roster: wife/dima mutual, kostya outgoing-only,
// mira incoming-only. Test order matters — the shared store reflects
// mutations across cases (same as a live session).

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bindApiClient,
  useContactsStore,
  useSessionStore,
} from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { incomingOnly, outgoingOnly, wife } from "@openglass/core/api/mock/fixtures";

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

describe("S6 contact search", () => {
  it("lists the local roster under contacts; empty query shows all", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    const names = w.findAll('[data-testid="user-name"]').map((n) => n.text());
    expect(names).toContain("anna");
    expect(names).toContain("kostya");
    expect(names).toContain("dima");
    // incoming-only mira is NOT a contact — she must not appear yet
    expect(names).not.toContain("mira");
  });

  it("short queries filter locally only — no server search below min 2", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="contact-search-input"]').setValue("an");
    await flush(400);
    // local match "anna" stays; global section must not include contacts
    const names = w.findAll('[data-testid="user-name"]').map((n) => n.text());
    expect(names).toContain("anna");
    expect(names).not.toContain("kostya");
    // nobody duplicated across the two sections
    expect(names.filter((n) => n === "anna")).toHaveLength(1);
  });

  it("global section offers add; adding a contact clears it from global", async () => {
    const w = mount(S6ContactSearch, { global: { plugins: [router, pinia] } });
    await flush();
    await w.find('[data-testid="contact-search-input"]').setValue("mira");
    await flush(400); // debounce 300 + latency
    const addBtn = w.find('[data-testid="add-contact"]');
    expect(addBtn.exists()).toBe(true);
    await addBtn.trigger("click");
    await flush();
    // mira is now a mutual contact — she left the global section
    expect(contacts().isMutual(incomingOnly.id)).toBe(true);
    expect(w.find('[data-testid="add-contact"]').exists()).toBe(false);
    const names = w.findAll('[data-testid="user-name"]').map((n) => n.text());
    expect(names).toContain("mira");
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
    // mira was added in the S6 test above — now mutual
    expect(w.find('[data-testid="badge"]').text()).toContain("mutual");
    await w.find('[data-testid="action-message"]').trigger("click");
    await flush();
    expect(router.currentRoute.value.name).toBe("s5-chat-view");
    expect(w.find('[data-testid="action-remove"]').exists()).toBe(true);
  });

  it("outgoing-only shows remove; confirm dialog must be accepted", async () => {
    await router.push({ name: "s7-contact-profile", params: { userId: outgoingOnly.id } });
    const w = mount(S7ContactProfile, { global: { plugins: [router, pinia] } });
    await flush();
    expect(w.find('[data-testid="badge"]').text()).toContain("in your contacts");
    expect(w.find('[data-testid="action-message"]').exists()).toBe(false);
    await w.find('[data-testid="action-remove"]').trigger("click");
    expect(w.find('[data-testid="confirm-dialog"]').exists()).toBe(true);
    await w.find('[data-testid="confirm-action"]').trigger("click");
    await flush();
    // after removal: kostya never added me → relationship none → add button
    expect(w.find('[data-testid="action-add"]').exists()).toBe(true);
    expect(contacts().isContact(outgoingOnly.id)).toBe(false);
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
