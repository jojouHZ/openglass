// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Contacts store tests — consent model: REST request/accept/decline against
// the MSW node mock, ws deltas invoked directly (same pattern as
// chats.onMessageNew). Fixture roster: wife, groupPal, kostya are accepted
// contacts, lena has a pending request from me, incomingOnly and suitor
// have pending requests to me.

import { createPinia, setActivePinia } from "pinia";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bindApiClient, useChatsStore, useContactsStore, useSessionStore } from "../index";
import { createMockNodeApiClient } from "../api/mock/node";
import { groupPal, incomingOnly, kostya, lena, stranger, suitor, wife } from "../api/mock/fixtures";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);

setActivePinia(createPinia());
const session = useSessionStore();
const contacts = useContactsStore();

beforeAll(async () => {
  localStorage.clear();
  await session.requestOtp("jojou@openglass.demo");
  await session.verifyOtp("123456", "vitest");
});
afterAll(() => ctx.server.close());

describe("contact list", () => {
  it("refresh loads accepted contacts and both request lists", async () => {
    await contacts.refresh();
    expect(contacts.list.map((c) => c.user.id).sort()).toEqual([groupPal.id, wife.id, kostya.id].sort());
    expect(contacts.loaded).toBe(true);
    expect(contacts.isMutual(wife.id)).toBe(true);
    // a pending request is NOT a contact
    expect(contacts.isContact(lena.id)).toBe(false);
    expect(contacts.isContact(incomingOnly.id)).toBe(false);
    expect(contacts.hasOutgoing(lena.id)).toBe(true);
    expect(contacts.hasIncoming(incomingOnly.id)).toBe(true);
    expect(contacts.requestCount).toBe(2);
    expect(contacts.mutualContacts.map((c) => c.user.id)).toContain(wife.id);
  });
});

describe("requests", () => {
  it("accept turns an incoming request into a contact", async () => {
    const c = await contacts.accept(incomingOnly.id);
    expect(c.user.id).toBe(incomingOnly.id);
    expect(contacts.isContact(incomingOnly.id)).toBe(true);
    expect(contacts.hasIncoming(incomingOnly.id)).toBe(false);
    expect(contacts.requestCount).toBe(1);
  });

  it("sendRequest creates an outgoing request, never a contact", async () => {
    const res = await contacts.sendRequest(stranger.id);
    expect(res.relationship).toBe("contact_outgoing");
    expect(contacts.hasOutgoing(stranger.id)).toBe(true);
    expect(contacts.isContact(stranger.id)).toBe(false);
  });

  it("sendRequest is idempotent — no duplicate pending row", async () => {
    const before = contacts.outgoing.length;
    await contacts.sendRequest(stranger.id);
    expect(contacts.outgoing).toHaveLength(before);
  });

  it("sendRequest to an existing contact is a no-op", async () => {
    const before = contacts.list.length;
    const res = await contacts.sendRequest(wife.id);
    expect(res.relationship).toBe("contact_mutual");
    expect(contacts.list).toHaveLength(before);
  });

  it("cancel drops the outgoing request", async () => {
    await contacts.cancel(stranger.id);
    expect(contacts.hasOutgoing(stranger.id)).toBe(false);
  });

  it("remove drops the contact; removing a stranger is tolerated", async () => {
    await contacts.remove(incomingOnly.id);
    expect(contacts.isContact(incomingOnly.id)).toBe(false);
    const before = contacts.list.length;
    await contacts.remove("00000000-0000-4000-8000-0000000000ff");
    expect(contacts.list).toHaveLength(before);
  });

  it("decline removes an incoming request without creating a contact", async () => {
    await contacts.decline(suitor.id);
    expect(contacts.hasIncoming(suitor.id)).toBe(false);
    expect(contacts.isContact(suitor.id)).toBe(false);
    expect(contacts.requestCount).toBe(0);
  });
});

describe("ws deltas", () => {
  it("contact.request adds an incoming request once", () => {
    contacts.onContactRequest(stranger, "2026-01-01T00:00:00Z");
    contacts.onContactRequest(stranger, "2026-01-01T00:00:00Z");
    expect(contacts.incoming.filter((r) => r.user.id === stranger.id)).toHaveLength(1);
    expect(contacts.requestCount).toBeGreaterThan(0);
  });

  it("contact.request.withdrawn removes it again", () => {
    contacts.onRequestWithdrawn(stranger.id);
    expect(contacts.hasIncoming(stranger.id)).toBe(false);
  });

  it("contact.accepted creates the contact and clears both request lists", () => {
    contacts.onContactRequest(stranger, "2026-01-01T00:00:00Z");
    contacts.outgoing.push({ user: stranger, createdAt: "2026-01-01T00:00:00Z" });
    contacts.onContactAccepted(stranger);
    expect(contacts.isContact(stranger.id)).toBe(true);
    expect(contacts.hasIncoming(stranger.id)).toBe(false);
    expect(contacts.hasOutgoing(stranger.id)).toBe(false);
    // replay is idempotent
    contacts.onContactAccepted(stranger);
    expect(contacts.list.filter((c) => c.user.id === stranger.id)).toHaveLength(1);
  });

  it("contact.request.resolved clears a request resolved on another device", () => {
    contacts.onContactRequest(suitor, "2026-01-01T00:00:00Z");
    contacts.onRequestResolved(suitor.id);
    expect(contacts.hasIncoming(suitor.id)).toBe(false);
  });

  it("contact.removed drops the contact entirely (both edges are gone)", () => {
    contacts.onContactRemoved(wife.id);
    expect(contacts.byId(wife.id)).toBeUndefined();
    contacts.onContactRemoved(wife.id); // idempotent replay
    expect(contacts.byId(wife.id)).toBeUndefined();
  });

  it("user.updated patches the cached User on the contact", () => {
    const renamed = { ...groupPal, displayName: "pal renamed" };
    contacts.onUserUpdated(renamed);
    expect(contacts.byId(groupPal.id)?.user.displayName).toBe("pal renamed");
    // unknown user — ignored, no row materializes
    const before = contacts.list.length;
    contacts.onUserUpdated({ ...groupPal, id: "00000000-0000-4000-8000-0000000000dd" });
    expect(contacts.list).toHaveLength(before);
  });
});

describe("teardown", () => {
  it("logout path clears contacts + chats — no cross-account leakage", async () => {
    const chats = useChatsStore();
    expect(contacts.list.length).toBeGreaterThan(0);
    chats.teardown();
    expect(contacts.list).toHaveLength(0);
    expect(contacts.loaded).toBe(false);
    expect(chats.chats).toHaveLength(0);
    expect(chats.details).toEqual({});
  });
});

describe("chats propagation", () => {
  it("user.updated rewrites direct peers and group rosters", async () => {
    const chats = useChatsStore();
    await chats.refreshChats();
    await chats.openChat("c0000000-0000-4000-8000-000000000002"); // group
    const renamed = { ...wife, displayName: "anna v3" };
    chats.onUserUpdated(renamed);
    const direct = chats.chats.find((c) => c.id === "c0000000-0000-4000-8000-000000000001")!;
    expect(direct.peer?.displayName).toBe("anna v3");
    const group = chats.details["c0000000-0000-4000-8000-000000000002"]!;
    expect(
      group.members?.find((m) => m.user.id === wife.id)?.user.displayName,
    ).toBe("anna v3");
  });
});
