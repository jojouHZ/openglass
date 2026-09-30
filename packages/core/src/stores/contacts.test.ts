// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Contacts store tests — REST list/add/remove against the MSW node mock,
// ws deltas invoked directly (same pattern as chats.onMessageNew).
// Fixture roster: wife + groupPal are mutual, outgoingOnly is one-way,
// incomingOnly added me but is not in my list.

import { createPinia, setActivePinia } from "pinia";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bindApiClient, useChatsStore, useContactsStore, useSessionStore } from "../index";
import { createMockNodeApiClient } from "../api/mock/node";
import { incomingOnly, outgoingOnly, selfUser, wife } from "../api/mock/fixtures";

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
  it("refresh loads the outgoing roster with mutual flags", async () => {
    await contacts.refresh();
    expect(contacts.list).toHaveLength(3);
    expect(contacts.loaded).toBe(true);
    expect(contacts.isMutual(wife.id)).toBe(true);
    expect(contacts.isContact(outgoingOnly.id)).toBe(true);
    expect(contacts.isMutual(outgoingOnly.id)).toBe(false);
    expect(contacts.isContact(incomingOnly.id)).toBe(false);
    expect(contacts.contactIds).toContain(wife.id);
    expect(contacts.mutualContacts.map((c) => c.user.id)).toContain(wife.id);
  });
});

describe("add / remove", () => {
  it("add on an incoming contact produces a mutual row", async () => {
    const c = await contacts.add(incomingOnly.id);
    expect(c.user.id).toBe(incomingOnly.id);
    expect(c.mutual).toBe(true);
    expect(contacts.isMutual(incomingOnly.id)).toBe(true);
  });

  it("add is idempotent — no duplicate row for an existing contact", async () => {
    const before = contacts.list.length;
    const c = await contacts.add(wife.id);
    expect(c.user.id).toBe(wife.id);
    expect(contacts.list).toHaveLength(before);
    expect(contacts.list.filter((x) => x.user.id === wife.id)).toHaveLength(1);
  });

  it("remove drops the row; removing a stranger is a no-op", async () => {
    await contacts.remove(outgoingOnly.id);
    expect(contacts.isContact(outgoingOnly.id)).toBe(false);
    const before = contacts.list.length;
    await contacts.remove("00000000-0000-4000-8000-0000000000ff");
    expect(contacts.list).toHaveLength(before);
  });
});

describe("ws deltas", () => {
  it("contact.added flips mutual on an existing outgoing edge", () => {
    contacts.list.push({
      user: outgoingOnly,
      mutual: false,
      addedAt: new Date().toISOString(),
      verifiedAt: null,
    });
    contacts.onContactAdded(outgoingOnly);
    expect(contacts.byId(outgoingOnly.id)?.mutual).toBe(true);
  });

  it("contact.added for an unknown user adds nothing — no incoming list API", () => {
    const before = contacts.list.length;
    contacts.onContactAdded({ ...selfUser, id: "00000000-0000-4000-8000-0000000000ee" });
    expect(contacts.list).toHaveLength(before);
  });

  it("contact.removed keeps the outgoing edge, drops the mutual flag", () => {
    contacts.onContactRemoved(wife.id);
    const c = contacts.byId(wife.id);
    expect(c).toBeDefined();
    expect(c?.mutual).toBe(false);
    // idempotent replay — second event changes nothing
    contacts.onContactRemoved(wife.id);
    expect(contacts.byId(wife.id)?.mutual).toBe(false);
  });

  it("user.updated patches the cached User on the contact", () => {
    const renamed = { ...wife, displayName: "anna renamed" };
    contacts.onUserUpdated(renamed);
    expect(contacts.byId(wife.id)?.user.displayName).toBe("anna renamed");
    // unknown user — ignored, no row materializes
    const before = contacts.list.length;
    contacts.onUserUpdated({ ...wife, id: "00000000-0000-4000-8000-0000000000dd" });
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
