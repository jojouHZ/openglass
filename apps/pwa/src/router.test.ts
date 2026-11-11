// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

// The private-module boundary is architectural: the pwa-mvp bundle must
// not ship private code. Legacy private routes were removed — private
// messaging happens inside the S5 chat surface now.

const LEGACY_PRIVATE_NAMES = [
  "s10-private-invite",
  "s11-session-setup",
  "s11b-verify",
  "s12-private-chat",
];

async function loadRouter() {
  vi.resetModules();
  return (await import("./router")).router;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("router", () => {
  it("registers the public screen routes", async () => {
    const router = await loadRouter();
    const names = router.getRoutes().map((r) => r.name);
    for (const n of ["s0-entry", "s4-chat-list", "s5-chat-view", "s13-settings"]) {
      expect(names).toContain(n);
    }
  });

  it("has no private routes — the private layer is same-window", async () => {
    const router = await loadRouter();
    const names = router.getRoutes().map((r) => r.name);
    for (const n of LEGACY_PRIVATE_NAMES) expect(names).not.toContain(n);
  });

  it("redirects old private deep links to the chat list", async () => {
    const router = await loadRouter();
    await router.push("/chats/abc/private").catch(() => {});
    // catch-all → s4-chat-list → auth gate (no session here) → s1-invite
    expect(router.currentRoute.value.name).toBe("s1-invite");
  });
});
