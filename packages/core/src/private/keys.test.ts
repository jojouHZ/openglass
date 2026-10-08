// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { getOrCreateIdentity, wipeIdentityStore } from "./keys";

// node test env has no indexedDB — the guards are the contract here;
// browser behavior is covered by the E.5 two-client E2E.
describe("keys — IndexedDB guards", () => {
  it("getOrCreateIdentity fails loudly without IndexedDB", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await expect(getOrCreateIdentity()).rejects.toThrow(/IndexedDB/);
  });

  it("wipeIdentityStore is a no-op without IndexedDB (zero-trace safe)", async () => {
    await expect(wipeIdentityStore()).resolves.toBeUndefined();
  });
});
