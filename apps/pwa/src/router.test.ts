// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

// The private-module boundary is architectural: pwa-mvp must not ship
// S10–S12. These tests codify the gate (VITE_PRIVATE_MODULE) instead of
// relying on manual bundle audits.

const PRIVATE_NAMES = [
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

  it("excludes private routes by default (pwa-mvp)", async () => {
    const router = await loadRouter();
    const names = router.getRoutes().map((r) => r.name);
    for (const n of PRIVATE_NAMES) expect(names).not.toContain(n);
  });

  it("includes private routes only with VITE_PRIVATE_MODULE=1 (pwa-dev)", async () => {
    vi.stubEnv("VITE_PRIVATE_MODULE", "1");
    const router = await loadRouter();
    const names = router.getRoutes().map((r) => r.name);
    for (const n of PRIVATE_NAMES) expect(names).toContain(n);
  });
});
