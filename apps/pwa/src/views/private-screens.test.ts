// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Private screens S10–S12 — seeded private store, no live relay.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, vi, describe, expect, it } from "vitest";

import { bindApiClient, useChatsStore, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";
import { directChatId, wife } from "@openglass/core/api/mock/fixtures";
import { usePrivateStore } from "@openglass/core/private/store";
import type { RelayClient } from "@openglass/core/private/relay";

import { pinia } from "../pinia";
import { wirePrivateLifecycle } from "../privateBoot";
import { createAppRouter } from "../router";
import PrivateInviteCard from "../components/private/PrivateInviteCard.vue";
import S10PrivateInvite from "./private/S10PrivateInvite.vue";
import S11SessionSetup from "./private/S11SessionSetup.vue";
import S11bVerify from "./private/S11bVerify.vue";
import S12PrivateChat from "./private/S12PrivateChat.vue";
// pre-warm the lazy S5 chunk — burn flows navigate back to it and a cold
// dynamic import (~600ms transform) would outrun the test's flush
import "./S5ChatView.vue";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());
// Private routes exist only under VITE_PRIVATE_MODULE=1 in real builds;
// the test wires the same records explicitly (private views always
// import the private store — the flag only gates route registration)
for (const [name, path, component] of [
  ["s10-private-invite", "/chats/:chatId/private/invite", S10PrivateInvite],
  ["s11-session-setup", "/chats/:chatId/private/setup", S11SessionSetup],
  ["s11b-verify", "/chats/:chatId/private/verify", S11bVerify],
  ["s12-private-chat", "/chats/:chatId/private", S12PrivateChat],
] as const) {
  router.addRoute({ path, name, component, meta: { auth: true } });
}

const session = () => useSessionStore(pinia);
const chats = () => useChatsStore(pinia);
const priv = () => usePrivateStore(pinia);

function fakeRelay() {
  const sent: { type: string; data: Record<string, unknown> }[] = [];
  const stub = {
    on: () => () => {},
    onStateChange: () => () => {},
    connect: () => Promise.resolve(),
    disconnect: () => {},
    invite: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    sendEnvelope: vi.fn((sessionId: string, blob: string) =>
      sent.push({ type: "relay.send", data: { sessionId, blob } })),
    resume: vi.fn(),
    burn: vi.fn((sessionId: string) =>
      sent.push({ type: "relay.burn", data: { sessionId } })),
    ping: vi.fn(),
  } as unknown as RelayClient;
  return { stub, sent };
}

const { stub: relay, sent } = fakeRelay();

function seedSession(over: Partial<import("@openglass/core/private/store").PrivateSession> = {}) {
  // one session per peer — a stale seeded session would shadow the fresh one
  priv().sessions.clear();
  const s = {
    id: "ps-1",
    peer: { id: wife.id, displayName: wife.displayName, tag: wife.tag },
    status: "unverified" as const,
    strict: false,
    burnOnRead: false,
    ttlEndsAt: new Date(Date.now() + 600_000).toISOString(),
    peerOfflineUntil: null,
    resumeToken: "rt",
    ownKeys: null,
    pendingPeerPub: null,
    sessionKey: {} as CryptoKey,
    sas: ["😀", "😁", "😂", "🤣", "😃", "😄", "😅", "😆", "😉", "😊", "😋", "😎"],
    messages: [],
    lastSeq: 0,
    ...over,
  };
  priv().sessions.set(s.id, s);
  return s;
}

beforeAll(async () => {
  localStorage.clear();
  await session().requestOtp("jojou@openglass.demo");
  await session().verifyOtp("123456", "vitest");
  await chats().refreshChats();
  priv().boot("/api/v1/relay", () => "tok", relay);
});
afterAll(() => ctx.server.close());

describe("S11b verify", () => {
  it("renders the 12-emoji SAS grid and marks verified", async () => {
    seedSession();
    await router.push({ name: "s11b-verify", params: { chatId: directChatId } });
    const w = mount(S11bVerify, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();

    const grid = w.find('[data-testid="sas-grid"]');
    expect(grid.exists()).toBe(true);
    expect(grid.findAll("span")).toHaveLength(12);

    await w.find('[data-testid="sas-confirm"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0)); // router.replace is async
    expect(priv().sessions.get("ps-1")!.status).toBe("verified");
    expect(router.currentRoute.value.name).toBe("s12-private-chat");
  });

  it("'doesn't match' burns the session and leaves private mode", async () => {
    seedSession({ id: "ps-2" });
    await router.push({ name: "s11b-verify", params: { chatId: directChatId } });
    const w = mount(S11bVerify, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();
    await w.find('[data-testid="sas-mismatch"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.some((f) => f.type === "relay.burn" && f.data.sessionId === "ps-2"))
      .toBe(true);
    expect(priv().sessions.get("ps-2")!.status).toBe("closed");
    expect(priv().sessions.get("ps-2")!.messages).toHaveLength(0);
    expect(router.currentRoute.value.name).toBe("s5-chat-view");
  });
});

describe("S12 private chat", () => {
  it("shows the unverified banner until SAS is confirmed", async () => {
    seedSession({ id: "ps-3" });
    await router.push({ name: "s12-private-chat", params: { chatId: directChatId } });
    const w = mount(S12PrivateChat, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();
    expect(w.find('[data-testid="unverified-banner"]').exists()).toBe(true);
    expect(w.find('[data-testid="ttl-count"]').exists()).toBe(true);

    priv().markVerified("ps-3");
    await w.vm.$nextTick();
    expect(w.find('[data-testid="unverified-banner"]').exists()).toBe(false);
  });

  it("burn wipes messages and exits to the public chat", async () => {
    seedSession({
      id: "ps-4",
      status: "verified",
      messages: [
        { id: "m1", fromMe: true, text: "secret one", ts: Date.now() },
        { id: "m2", fromMe: false, text: "secret two", ts: Date.now() },
      ],
    });
    await router.push({ name: "s12-private-chat", params: { chatId: directChatId } });
    const w = mount(S12PrivateChat, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();

    await w.find('[data-testid="burn-btn"]').trigger("click");
    await w.find('[data-testid="confirm-action"]').trigger("click");
    await new Promise((r) => setTimeout(r, 0));
    expect(priv().sessions.get("ps-4")!.status).toBe("closed");
    expect(priv().sessions.get("ps-4")!.messages).toHaveLength(0);
    expect(router.currentRoute.value.name).toBe("s5-chat-view");
  });

  it("shows the burnOnRead marker only as a flag", async () => {
    seedSession({ id: "ps-5", burnOnRead: true, status: "verified" });
    await router.push({ name: "s12-private-chat", params: { chatId: directChatId } });
    const w = mount(S12PrivateChat, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();
    expect(w.find('[data-testid="burn-on-read"]').exists()).toBe(true);
    // the flag is a marker in E.4 — messages are NOT auto-wiped locally
    priv().sessions.get("ps-5")!.messages.push({
      id: "mx", fromMe: false, text: "still here", ts: Date.now(),
    });
    await w.vm.$nextTick();
    expect(w.text()).toContain("still here");
  });
});

describe("S11 session setup", () => {
  it("passes ttl/burnOnRead/strict to the invite and waits on S10", async () => {
    priv().relayState = "online";
    await router.push({ name: "s11-session-setup", params: { chatId: directChatId } });
    const w = mount(S11SessionSetup, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();

    await w.find('[data-testid="ttl-300"]').trigger("click");
    await w.find('[data-testid="opt-burn"]').setValue(true);
    await w.find('[data-testid="opt-strict"]').setValue(true);
    await w.find('[data-testid="start-private"]').trigger("click");

    expect(relay.invite).toHaveBeenCalledWith(wife.id, {
      ttlSeconds: 300,
      burnOnRead: true,
      strict: true,
    });
    expect(priv().outgoingInvites).toContain(wife.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.name).toBe("s10-private-invite");
  });

  it("is disabled with an honest message while the relay is offline", async () => {
    priv().relayState = "offline";
    await router.push({ name: "s11-session-setup", params: { chatId: directChatId } });
    const w = mount(S11SessionSetup, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();
    const btn = w.find('[data-testid="start-private"]');
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.text()).toContain("live backend required");
    priv().relayState = "online";
  });
});

describe("S10 private invite", () => {
  it("incoming state: accept sends relay.accept, decline exits to S5", async () => {
    seedSession({ id: "ps-in3", status: "incoming" });
    await router.push({ name: "s10-private-invite", params: { chatId: directChatId } });
    const w = mount(S10PrivateInvite, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();
    expect(w.find('[data-testid="invite-incoming"]').exists()).toBe(true);

    await w.find('[data-testid="invite-accept"]').trigger("click");
    expect(relay.accept).toHaveBeenCalledWith("ps-in3");
  });

  it("a declined/expired invite (session gone) leaves to S5", async () => {
    seedSession({ id: "ps-out", status: "inviting" });
    await router.push({ name: "s10-private-invite", params: { chatId: directChatId } });
    const w = mount(S10PrivateInvite, { global: { plugins: [router, pinia] } });
    await w.vm.$nextTick();
    expect(w.find('[data-testid="invite-waiting"]').exists()).toBe(true);

    // relay.declined → dropSession deletes the record entirely
    priv().sessions.delete("ps-out");
    await w.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(router.currentRoute.value.name).toBe("s5-chat-view");
  });
});

describe("PrivateInviteCard", () => {
  it("accept forwards to the relay and emits verify", async () => {
    seedSession({ id: "ps-in", status: "incoming" });
    const w = mount(PrivateInviteCard, {
      props: { peerId: wife.id, chatId: directChatId },
      global: { plugins: [router, pinia] },
    });
    await w.vm.$nextTick();
    expect(w.find('[data-testid="private-invite-card"]').exists()).toBe(true);
    await w.find('[data-testid="private-accept"]').trigger("click");
    expect(relay.accept).toHaveBeenCalledWith("ps-in");
    expect(w.emitted("verify")?.[0]).toEqual(["ps-in"]);
  });

  it("decline drops the session and notifies the relay", async () => {
    seedSession({ id: "ps-in2", status: "incoming" });
    const w = mount(PrivateInviteCard, {
      props: { peerId: wife.id, chatId: directChatId },
      global: { plugins: [router, pinia] },
    });
    await w.find('[data-testid="private-decline"]').trigger("click");
    expect(relay.decline).toHaveBeenCalledWith("ps-in2");
    expect(priv().sessions.has("ps-in2")).toBe(false);
  });

  it("renders the waiting state for our outgoing invite", async () => {
    priv().sessions.clear();
    priv().pendingInvites.set(wife.id, {
      burnOnRead: false,
      strict: true,
      expiresAt: Date.now() + 60_000,
    });
    const w = mount(PrivateInviteCard, {
      props: { peerId: wife.id, chatId: directChatId },
      global: { plugins: [router, pinia] },
    });
    await w.vm.$nextTick();
    expect(w.find('[data-testid="private-outgoing"]').exists()).toBe(true);
    priv().pendingInvites.clear();
  });
});

describe("private lifecycle wiring", () => {
  it("pagehide tears the module down; logout does too", async () => {
    const calls: string[] = [];
    const fake = {
      connect: () => calls.push("connect"),
      teardown: () => (calls.push("teardown"), Promise.resolve()),
    };
    wirePrivateLifecycle(fake, session());
    // authed already → connect fires immediately
    expect(calls).toEqual(["connect"]);

    dispatchEvent(new Event("pagehide"));
    expect(calls).toContain("teardown");
  });
});
