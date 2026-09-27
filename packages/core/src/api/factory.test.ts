// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { createApiClient } from "./factory";

// Scaffold-level tests: the mode seam exists and unimplemented
// transports fail loudly instead of silently misbehaving.
// Real contract tests land with the MockApiClient (#9).

describe("createApiClient", () => {
  const base = { baseUrl: "/api/v1", wsUrl: "/api/v1/ws" };

  it("mock mode resolves to the MockApiClient boundary (#9 stub)", async () => {
    await expect(
      createApiClient({ ...base, mode: "mock" }),
    ).rejects.toThrow(/not implemented yet/i);
  });

  it("live mode resolves to the HttpApiClient boundary (#12 stub)", async () => {
    await expect(
      createApiClient({ ...base, mode: "live" }),
    ).rejects.toThrow(/not implemented yet/i);
  });
});
