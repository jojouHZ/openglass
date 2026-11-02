// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Person row: tap = the screen's choice (chat for contacts), right-click or a
// still long-press = Message · Profile · Report · Remove.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { bindApiClient, useContactsStore, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { stranger, wife } from "@openglass/core/api/mock/fixtures";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import UserRow from "./UserRow.vue";

const ctx = createMockNodeApiClient({ mode: "mock", baseUrl: "/api/v1", wsUrl: "/api/v1/ws" });
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

beforeAll(async () => {
  localStorage.clear();
  const session = useSessionStore(pinia);
  await session.requestOtp("jojou@openglass.demo");
  await session.verifyOtp("123456", "vitest");
  await useContactsStore(pinia).refresh();
});
afterAll(() => ctx.server.close());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const mountRow = (user = wife, props: Record<string, unknown> = { menu: true }) =>
  mount(UserRow, { props: { user, ...props }, global: { plugins: [router, pinia] }, attachTo: document.body });
const items = () => [...document.querySelectorAll('[data-testid^="um-"]')].map((e) => e.getAttribute("data-testid"));

describe("person row menu", () => {
  it("right-click opens the menu for a contact: Message, Profile, Report, Remove", async () => {
    const w = mountRow(wife);
    await w.find('[data-testid="user-row"]').trigger("contextmenu", { clientX: 40, clientY: 60 });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="user-menu"]')).toBeTruthy());
    expect(items()).toEqual(["um-message", "um-profile", "um-report", "um-remove"]);
    w.unmount();
  });

  it("a non-contact gets only Profile and Report", async () => {
    const w = mountRow(stranger);
    await w.find('[data-testid="user-row"]').trigger("contextmenu", { clientX: 40, clientY: 60 });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="user-menu"]')).toBeTruthy());
    expect(items()).toEqual(["um-profile", "um-report"]);
    w.unmount();
  });

  it("your own row has no menu, and a row without `menu` has none either", async () => {
    const self = useSessionStore(pinia).user!;
    const me = mountRow(self);
    await me.find('[data-testid="user-row"]').trigger("contextmenu");
    expect(document.querySelector('[data-testid="user-menu"]')).toBeFalsy();
    me.unmount();
    const plain = mountRow(wife, {});
    await plain.find('[data-testid="user-row"]').trigger("contextmenu");
    expect(document.querySelector('[data-testid="user-menu"]')).toBeFalsy();
    plain.unmount();
  });

  it("Profile opens the profile, Message opens the chat", async () => {
    const w = mountRow(wife);
    await w.find('[data-testid="user-row"]').trigger("contextmenu", { clientX: 1, clientY: 1 });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="um-profile"]')).toBeTruthy());
    (document.querySelector('[data-testid="um-profile"]') as HTMLElement).click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("s7-contact-profile"));

    await w.find('[data-testid="user-row"]').trigger("contextmenu", { clientX: 1, clientY: 1 });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="um-message"]')).toBeTruthy());
    (document.querySelector('[data-testid="um-message"]') as HTMLElement).click();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("s5-chat-view"));
    w.unmount();
  });

  it("Report opens the report dialog for that person", async () => {
    const w = mountRow(stranger);
    await w.find('[data-testid="user-row"]').trigger("contextmenu", { clientX: 1, clientY: 1 });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="um-report"]')).toBeTruthy());
    (document.querySelector('[data-testid="um-report"]') as HTMLElement).click();
    await vi.waitFor(() => expect(w.find('[data-testid="report-dialog"]').exists()).toBe(true));
    expect(w.find('[data-testid="report-dialog"]').text()).toContain(stranger.displayName);
    w.unmount();
  });

  it("Remove contact asks first, then removes", async () => {
    const contacts = useContactsStore(pinia);
    const target = contacts.list[contacts.list.length - 1]!.user;
    const w = mountRow(target);
    await w.find('[data-testid="user-row"]').trigger("contextmenu", { clientX: 1, clientY: 1 });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="um-remove"]')).toBeTruthy());
    (document.querySelector('[data-testid="um-remove"]') as HTMLElement).click();
    await vi.waitFor(() => expect(w.find('[data-testid="confirm-dialog"], [role="alertdialog"]').exists() || !!document.querySelector('[role="alertdialog"]')).toBe(true));
    expect(contacts.isContact(target.id)).toBe(true); // nothing happens before the confirmation
    (document.querySelector('[data-testid="confirm-action"]') as HTMLElement).click();
    await vi.waitFor(() => expect(contacts.isContact(target.id)).toBe(false));
    w.unmount();
  });

  it("long-press on touch opens it; the lift does not also tap; scrolling cancels", async () => {
    vi.useFakeTimers();
    const w = mountRow(wife);
    const row = w.find('[data-testid="user-row"]');
    await row.trigger("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(520);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="user-menu"]')).toBeTruthy());
    await row.trigger("pointerup", { pointerType: "touch" });
    await row.trigger("click");
    expect(w.emitted("open")).toBeUndefined(); // the long-press swallowed the tap
    w.unmount();

    const w2 = mountRow(wife);
    const row2 = w2.find('[data-testid="user-row"]');
    await row2.trigger("pointerdown", { pointerType: "touch", clientX: 10, clientY: 10 });
    await row2.trigger("pointermove", { pointerType: "touch", clientX: 10, clientY: 60 }); // a scroll
    vi.advanceTimersByTime(900);
    expect(document.querySelector('[data-testid="user-menu"]')).toBeFalsy();
    w2.unmount();
  });

  it("a plain tap and the testid override still work (multi-root row)", async () => {
    const w = mountRow(wife, { menu: true, "data-testid": "member-row" });
    expect(w.find('[data-testid="member-row"]').exists()).toBe(true);
    await w.find('[data-testid="member-row"]').trigger("click");
    expect(w.emitted("open")).toHaveLength(1);
    w.unmount();
  });
});
