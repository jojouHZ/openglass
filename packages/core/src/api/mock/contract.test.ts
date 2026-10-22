// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Contract smoke suite — exercises ApiClient through the real
// HttpTransport against MSW. The same suite shape will later run
// against the Go backend (swap server.listen for a live baseUrl).

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiRequestError, type ApiClient } from "../client";
import { HttpApiClient } from "../http";
import { DEMO_OTP, groupInviteFx, incomingOnly, lena, stranger, wife } from "./fixtures";
import { createMockNodeApiClient, type MockNodeContext } from "./node";

const OPTS = { mode: "mock" as const, baseUrl: "/api/v1", wsUrl: "/api/v1/ws" };

let ctx: MockNodeContext;
let api: ApiClient;

async function authedClient(email = "jojou@openglass.demo"): Promise<ApiClient> {
  const client = new HttpApiClient(OPTS);
  await client.auth.requestOtp({ email });
  const r = await client.auth.verifyOtp({ email, code: DEMO_OTP, deviceName: "vitest" });
  client.setAccessToken(r.accessToken);
  return client;
}

beforeAll(() => {
  ctx = createMockNodeApiClient(OPTS);
});
afterAll(() => ctx.server.close());

describe("contract: auth", () => {
  it("requestOtp requires invite for unknown emails", async () => {
    api = new HttpApiClient(OPTS);
    await expect(api.auth.requestOtp({ email: "stranger@x.io" })).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.apiError.code === "invite_required",
    );
  });

  it("verifyOtp returns a session for a known email", async () => {
    api = new HttpApiClient(OPTS);
    await api.auth.requestOtp({ email: "jojou@openglass.demo" });
    const r = await api.auth.verifyOtp({
      email: "jojou@openglass.demo",
      code: DEMO_OTP,
      deviceName: "vitest",
    });
    expect(r.user?.tag).toBe("jojou#1042");
    expect(r.needsProfile).toBe(false);
  });

  it("rejects a wrong OTP with otp_invalid", async () => {
    await expect(
      api.auth.verifyOtp({ email: "jojou@openglass.demo", code: "000000", deviceName: "vitest" }),
    ).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.apiError.code === "otp_invalid",
    );
  });
});

describe("contract: guarded endpoints", () => {
  it("401s without a token", async () => {
    const anon = new HttpApiClient(OPTS);
    await expect(anon.chats.list()).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.status === 401,
    );
  });
});

describe("contract: chats & messages", () => {
  it("lists chats ordered pinned-first", async () => {
    api = await authedClient();
    const { chats } = await api.chats.list();
    expect(chats.length).toBeGreaterThanOrEqual(2);
    expect(chats[0]!.pinned).toBe(true);
  });

  it("paginates history with opaque cursors both directions", async () => {
    const page1 = await api.messages.list(
      "c0000000-0000-4000-8000-000000000001",
      { limit: 10 },
    );
    expect(page1.messages).toHaveLength(10);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await api.messages.list("c0000000-0000-4000-8000-000000000001", {
      limit: 10,
      before: page1.nextCursor!,
    });
    expect(page2.messages.at(-1)!.seq).toBeLessThan(page1.messages[0]!.seq);
  });

  it("dedupes sendMessage by clientNonce (200 on retry)", async () => {
    const chatId = "c0000000-0000-4000-8000-000000000001";
    const body = { clientNonce: "nonce-contract-1", text: "hello" };
    const first = await api.messages.send(chatId, body);
    const retry = await api.messages.send(chatId, body);
    expect(retry.message.id).toBe(first.message.id);
  });

  it("rejects empty messages", async () => {
    await expect(
      api.messages.send("c0000000-0000-4000-8000-000000000001", {
        clientNonce: "nonce-empty",
      }),
    ).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.apiError.code === "validation_failed",
    );
  });

  it("404s on messages of an unknown chat", async () => {
    await expect(
      api.messages.list("00000000-0000-4000-8000-0000000000ff"),
    ).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.apiError.code === "not_found",
    );
  });

  it("search results come back seq-desc", async () => {
    const { messages } = await api.messages.list(
      "c0000000-0000-4000-8000-000000000001",
      { q: "fixture" },
    );
    expect(messages.length).toBeGreaterThan(1);
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i - 1]!.seq).toBeGreaterThan(messages[i]!.seq);
    }
  });

  it("completeProfile on a finished profile returns conflict", async () => {
    await expect(
      api.auth.completeProfile({ displayName: "again" }),
    ).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.apiError.code === "conflict",
    );
  });

  it("completeProfile after logout returns 401, not a 500", async () => {
    const c = await authedClient("anna@openglass.demo");
    await c.auth.logout();
    await expect(
      c.auth.completeProfile({ displayName: "x" }),
    ).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.status === 401,
    );
  });
});

describe("contract: contacts & users", () => {
  it("exposes relationship states", async () => {
    const r = await api.users.get(wife.id);
    expect(r.relationship).toBe("contact_mutual");
  });

  it("a pending request is not a contact; relationship reads outgoing/incoming", async () => {
    const { contacts } = await api.contacts.list();
    expect(contacts.every((c) => c.mutual)).toBe(true);
    expect(contacts.some((c) => c.user.id === lena.id)).toBe(false);
    expect((await api.users.get(lena.id)).relationship).toBe("contact_outgoing");
    expect((await api.users.get(incomingOnly.id)).relationship).toBe("contact_incoming");
    const { incoming, outgoing } = await api.contacts.listRequests();
    expect(incoming.some((r) => r.user.id === incomingOnly.id)).toBe(true);
    expect(outgoing.some((r) => r.user.id === lena.id)).toBe(true);
  });

  it("request → cancel; resend is idempotent; self and contacts are rejected", async () => {
    const r1 = await api.contacts.request(stranger.id);
    expect(r1.relationship).toBe("contact_outgoing");
    expect((await api.contacts.request(stranger.id)).relationship).toBe("contact_outgoing");
    expect((await api.contacts.listRequests()).outgoing.filter((r) => r.user.id === stranger.id)).toHaveLength(1);
    await api.contacts.cancelRequest(stranger.id);
    expect((await api.users.get(stranger.id)).relationship).toBe("none");
    await expect(api.contacts.request(wife.id)).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.status === 409,
    );
    const me = (await api.users.getMe()).user;
    await expect(api.contacts.request(me.id)).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.status === 400,
    );
  });

  it("requesting someone who already asked me collapses into a mutual contact", async () => {
    const r = await api.contacts.request(incomingOnly.id);
    expect(r.relationship).toBe("contact_mutual");
    expect(r.contact?.user.id).toBe(incomingOnly.id);
    expect((await api.contacts.list()).contacts.some((c) => c.user.id === incomingOnly.id)).toBe(true);
  });

  it("group invitations: listed, not memberships, accept creates the chat", async () => {
    const { invites } = await api.groups.listInvites();
    expect(invites[0]?.chatId).toBe(groupInviteFx.chatId);
    const { chat } = await api.groups.acceptInvite(groupInviteFx.chatId);
    expect(chat.type).toBe("group");
    expect((await api.groups.listInvites()).invites).toHaveLength(0);
    await expect(api.groups.declineInvite(groupInviteFx.chatId)).rejects.toSatisfy(
      (e) => e instanceof ApiRequestError && e.status === 404,
    );
  });

  it("getMe returns the private email field", async () => {
    const me = await api.users.getMe();
    expect(me.email).toContain("@");
    expect(me.user.tag).toBeTruthy();
  });
});
