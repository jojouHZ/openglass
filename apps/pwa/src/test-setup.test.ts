// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";

describe("test setup", () => {
  it("gives vi.waitFor a budget beyond vitest's built-in 1s", async () => {
    const readyAt = Date.now() + 1500;
    await vi.waitFor(() => expect(Date.now()).toBeGreaterThanOrEqual(readyAt));
  });

  it("still honors an explicit shorter timeout", async () => {
    await expect(
      vi.waitFor(() => expect(true).toBe(false), { timeout: 200, interval: 20 }),
    ).rejects.toThrow();
  });
});
