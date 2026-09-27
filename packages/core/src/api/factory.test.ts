// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { createApiClient } from "./factory";
import { createMockNodeApiClient } from "./mock/node";

const base = { baseUrl: "/api/v1", wsUrl: "/api/v1/ws" };

describe("createApiClient", () => {
  it("live mode returns the HttpApiClient", async () => {
    const api = await createApiClient({ ...base, mode: "live" });
    expect(api.constructor.name).toBe("HttpApiClient");
  });

  it("mock mode is browser-only (node uses mock/node entry)", async () => {
    await expect(createApiClient({ ...base, mode: "mock" })).rejects.toThrow(
      /browser-only/,
    );
  });
});

describe("createMockNodeApiClient", () => {
  it("returns a working client + interceptor server", async () => {
    const ctx = createMockNodeApiClient({ ...base, mode: "mock" });
    try {
      const health = await ctx.api.system.healthz();
      expect(health.status).toBe("ok");
    } finally {
      ctx.server.close();
    }
  });
});
