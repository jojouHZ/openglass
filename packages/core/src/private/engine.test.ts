// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import {
  decryptEnvelope,
  deriveSessionKey,
  encryptEnvelope,
  fromB64,
  generateSessionKeyPair,
  sasFingerprint,
} from "./engine";

describe("private engine — ECDH + AES-GCM", () => {
  it("derives identical session keys on both sides", async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const keyA = await deriveSessionKey(a, b.rawPub);
    const keyB = await deriveSessionKey(b, a.rawPub);
    // derived keys are non-extractable — compare behavior, not bytes
    const env = await encryptEnvelope(keyA, { text: "secret payload" });
    const pt = await decryptEnvelope(keyB, env);
    expect(pt.text).toBe("secret payload");
  });

  it("encrypt → decrypt round-trips", async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const key = await deriveSessionKey(a, b.rawPub);
    const env = await encryptEnvelope(key, { text: "токен: ghp_abc" });
    expect(env.t).toBe("msg");
    expect(env.ct).not.toContain("ghp_abc");
    expect((await decryptEnvelope(key, env)).text).toBe("токен: ghp_abc");
  });

  it("tampered ciphertext fails to decrypt", async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const key = await deriveSessionKey(a, b.rawPub);
    const env = await encryptEnvelope(key, { text: "x" });
    const bytes = fromB64(env.ct);
    bytes[0] ^= 0xff;
    const tampered = { ...env, ct: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptEnvelope(key, tampered)).rejects.toThrow();
  });

  it("a MITM-substituted key cannot decrypt the peer's messages", async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const mitm = await generateSessionKeyPair();
    // relay swaps b's pubkey for mitm's
    const keyA = await deriveSessionKey(a, mitm.rawPub);
    const keyB = await deriveSessionKey(b, a.rawPub);
    const env = await encryptEnvelope(keyA, { text: "intercept me" });
    await expect(decryptEnvelope(keyB, env)).rejects.toThrow();
  });
});

describe("SAS fingerprint", () => {
  it("both sides compute the identical grid", async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const fa = await sasFingerprint(a.rawPub, b.rawPub);
    const fb = await sasFingerprint(b.rawPub, a.rawPub);
    expect(fa).toEqual(fb);
    expect(fa).toHaveLength(12);
  });

  it("a MITM key substitution changes the grid", async () => {
    const a = await generateSessionKeyPair();
    const b = await generateSessionKeyPair();
    const mitm = await generateSessionKeyPair();
    // honest pair sees (a,b); mitm sees (a,mitm) — must differ
    const honest = await sasFingerprint(a.rawPub, b.rawPub);
    const attacked = await sasFingerprint(a.rawPub, mitm.rawPub);
    expect(attacked).not.toEqual(honest);
  });
});
