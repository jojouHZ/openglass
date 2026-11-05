// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

// @vitest-environment node

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { idbPut, wipeIdentityStore } from "./keys";
import {
  getOrCreateDeviceIdentity,
  identityFingerprint,
  signWithIdentity,
  verifyIdentitySignature,
} from "./identity";
import {
  deletePin,
  getPin,
  listPins,
  savePin,
  verificationState,
} from "./pins";

describe("device identity (F7)", () => {
  it("creates a stable ECDSA pair per user; signs and verifies", async () => {
    await wipeIdentityStore();
    const a1 = await getOrCreateDeviceIdentity("user-a");
    const a2 = await getOrCreateDeviceIdentity("user-a");
    expect(a2.pubB64).toBe(a1.pubB64); // persisted, not regenerated
    const b = await getOrCreateDeviceIdentity("user-b");
    expect(b.pubB64).not.toBe(a1.pubB64);

    const msg = new TextEncoder().encode("ephemeral-pub");
    const sig = await signWithIdentity(a1, msg);
    expect(await verifyIdentitySignature(a1.pubB64, msg, sig)).toBe(true);
    // forged signature under a different key must fail
    expect(await verifyIdentitySignature(b.pubB64, msg, sig)).toBe(false);
  });

  it("uses a stable public-key digest as directory id, not the account id", async () => {
    await wipeIdentityStore();
    const first = await getOrCreateDeviceIdentity("same-account");
    const loaded = await getOrCreateDeviceIdentity("same-account");
    expect(loaded.keyId).toBe(first.keyId);
    const spki = await crypto.subtle.exportKey("spki", first.pair.publicKey);
    const digest = await crypto.subtle.digest("SHA-256", spki);
    const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(first.keyId).toBe(expected);
    expect(first.keyId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.pair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", first.pair.privateKey)).rejects.toThrow();
    await wipeIdentityStore();
    const replacement = await getOrCreateDeviceIdentity("same-account");
    expect(replacement.pubB64).not.toBe(first.pubB64);
    expect(replacement.keyId).not.toBe(first.keyId);
  });

  it("reuses keys already stored under the legacy account-scoped address", async () => {
    await wipeIdentityStore();
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"],
    );
    await idbPut("identity", "ecdsa-p256-existing-user", pair);
    const loaded = await getOrCreateDeviceIdentity("existing-user");
    const data = new TextEncoder().encode("existing-key-proof");
    const signature = await signWithIdentity(loaded, data);
    const raw = await crypto.subtle.exportKey("spki", pair.publicKey);
    const { toB64 } = await import("./engine");
    expect(loaded.pubB64).toBe(toB64(raw));
    expect(await verifyIdentitySignature(toB64(raw), data, signature)).toBe(true);
    expect(loaded.keyId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("identity fingerprint is symmetric across both sides", async () => {
    const a = await getOrCreateDeviceIdentity("fa");
    const b = await getOrCreateDeviceIdentity("fb");
    const fa = await identityFingerprint(a.pubB64, b.pubB64);
    const fb = await identityFingerprint(b.pubB64, a.pubB64);
    expect(fa).toEqual(fb);
    expect(fa.symbols).toHaveLength(6);
    expect(fa.digits).toMatch(/^\d{6}$/);
  });
});

describe("pins (F7)", () => {
  it("lists only the owner's pins, including separate pins for the same peer", async () => {
    await wipeIdentityStore();
    const pin = { peerUserId: "peer", keyId: "a-key", publicKey: "a-pub", verifiedAt: "2026-11-05T00:00:00Z" };
    await savePin("alice", pin);
    await savePin("bob", { ...pin, keyId: "b-key", publicKey: "b-pub" });
    expect(await listPins("alice")).toEqual([pin]);
    expect(await listPins("bob")).toEqual([{ ...pin, keyId: "b-key", publicKey: "b-pub" }]);
    expect(await listPins("al")).toEqual([]);
    expect(await listPins("carol")).toEqual([]);
    await deletePin("alice", "peer");
    expect(await listPins("alice")).toEqual([]);
    expect(await getPin("bob", "peer")).toEqual({ ...pin, keyId: "b-key", publicKey: "b-pub" });
  });
  it("saves, lists and deletes pins; state tracks key changes", async () => {
    await wipeIdentityStore();
    const me = "me", peer = "peer";
    const peerId = await getOrCreateDeviceIdentity(peer);

    expect(await verificationState(me, peer, peerId.pubB64)).toBe("unverified");

    await savePin(me, {
      peerUserId: peer,
      keyId: peerId.keyId,
      publicKey: peerId.pubB64,
      verifiedAt: new Date().toISOString(),
    });
    expect(await verificationState(me, peer, peerId.pubB64)).toBe("verified");
    expect((await getPin(me, peer))?.keyId).toBe(peerId.keyId);
    expect((await listPins(me)).map((p) => p.peerUserId)).toEqual([peer]);

    // peer's published key changed → key-changed, never silently verified
    const other = await getOrCreateDeviceIdentity("other-user");
    expect(await verificationState(me, peer, other.pubB64)).toBe("key-changed");
    expect(await verificationState(me, peer, "")).toBe("key-changed");

    await deletePin(me, peer);
    expect(await verificationState(me, peer, peerId.pubB64)).toBe("unverified");
    expect(await listPins(me)).toHaveLength(0);
  });
});
