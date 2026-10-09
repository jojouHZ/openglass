// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("keys — IndexedDB roundtrip (fake-indexeddb)", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => {
    // @ts-expect-error restore the absent global for the guard tests
    delete globalThis.indexedDB;
  });

  it("persists a non-extractable pair and reuses it on next call", async () => {
    const a = await getOrCreateIdentity();
    const b = await getOrCreateIdentity();
    const aRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", a.publicKey),
    );
    const bRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", b.publicKey),
    );
    expect(aRaw).toEqual(bRaw); // same device identity, not a new key
    expect(a.privateKey.extractable).toBe(false);
    expect(b.privateKey.extractable).toBe(false);
  });

  it("wipeIdentityStore deletes the DB — next identity is a NEW key", async () => {
    const a = await getOrCreateIdentity();
    await wipeIdentityStore();
    const b = await getOrCreateIdentity();
    const aRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", a.publicKey),
    );
    const bRaw = new Uint8Array(
      await crypto.subtle.exportKey("raw", b.publicKey),
    );
    expect(aRaw).not.toEqual(bRaw); // zero-trace: wiped, regenerated
  });
});
