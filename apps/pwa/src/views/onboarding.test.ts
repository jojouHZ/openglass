// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

// Onboarding flow tests (S1–S3) — components drive the real
// HttpApiClient against the MSW node server, so these exercise the
// same contract path as the browser build.

import { mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bindApiClient, useSessionStore } from "@openglass/core";
import { createMockNodeApiClient } from "@openglass/core/api/mock/node";

import { pinia } from "../pinia";
import { createAppRouter } from "../router";
import S1InviteEmail from "./S1InviteEmail.vue";
import S3ProfileSetup from "./S3ProfileSetup.vue";

const ctx = createMockNodeApiClient({
  mode: "mock",
  baseUrl: "/api/v1",
  wsUrl: "/api/v1/ws",
});
bindApiClient(ctx.api);
const router = createAppRouter(createMemoryHistory());

const session = () => useSessionStore(pinia);

function mountView(component: object) {
  return mount(component, { global: { plugins: [router, pinia] } });
}

async function flush(ms = 250) {
  await new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  localStorage.clear();
  session().hydrate();
});
afterAll(() => ctx.server.close());

describe("S1 invite/email", () => {
  it("shows inline error when a new email has no invite", async () => {
    const w = mountView(S1InviteEmail);
    await w.find('input[placeholder="email"]').setValue("new@x.io");
    await w.find("form").trigger("submit");
    await flush();
    expect(w.text()).toContain("invite code is required");
  });

  it("requests OTP for a known email and lands on S2", async () => {
    const w = mountView(S1InviteEmail);
    await w.find('input[placeholder="email"]').setValue("anna@openglass.demo");
    await w.find("form").trigger("submit");
    await flush();
    await flush(); // let the router push settle
    expect(session().pendingEmail).toBe("anna@openglass.demo");
    expect(router.currentRoute.value.name).toBe("s2-otp");
  });
});

describe("S3 profile setup", () => {
  it("taken prefix → suggestion chips → click → success", async () => {
    // full mid-flow state via the store (mock server keeps its own session)
    await session().requestOtp("new@x.io", "GLS-DEMO");
    await session().verifyOtp("123456", "vitest");
    expect(session().needsProfile).toBe(true);

    const w = mountView(S3ProfileSetup);
    // "anna" prefix is taken by fixture anna#0002 → tag_taken + chips
    await w.find('input[placeholder="display name"]').setValue("anna");
    await w.find("form").trigger("submit");
    await flush();

    const chips = w.findAll("button.rounded-pill");
    expect(chips.length).toBeGreaterThan(0);
    expect(w.text()).toContain("tag is taken");

    await chips[0]!.trigger("click");
    await w.find("form").trigger("submit");
    await flush();

    expect(session().authed).toBe(true);
    expect(session().user?.tag).toBe(chips[0]!.text());
    expect(router.currentRoute.value.name).toBe("s4-chat-list");
  });
});
