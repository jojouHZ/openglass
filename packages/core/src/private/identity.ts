// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// F7 device identity — pwa-dev ONLY.
//
// One ECDSA P-256 key pair per (user, device/browser), private key
// non-extractable in IndexedDB. The identity signs each session's
// ephemeral ECDH key (handshake v2); peers verify against a local pin.
// Verification is per DEVICE PAIR — a second device of the same person
// is an unknown device until verified (no backup, no sync).
//
// Persistence is IndexedDB (see keys.ts openDb); teardown/logout wipes
// the whole database, so identity + pins die on sign-out by design
// until the F8 encrypted vault exists.

import { fromB64, sasFingerprint, toB64, type SasFingerprint } from "./engine";
import { idbGet, idbPut } from "./keys";

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

const ID_STORE = "identity";
const keyIdFor = (userId: string): string => `ecdsa-p256-${userId}`;

export interface DeviceIdentity {
  /** non-extractable pair — private material never leaves the keystore */
  pair: CryptoKeyPair;
  /** base64 SPKI public key — the value published to the directory */
  pubB64: string;
  /** deterministic id for this identity key (published to directory) */
  keyId: string;
}

/** Load or create the device identity for the signed-in user. */
export async function getOrCreateDeviceIdentity(
  userId: string,
): Promise<DeviceIdentity> {
  const id = keyIdFor(userId);
  const existing = await idbGet<CryptoKeyPair>(ID_STORE, id);
  const pair = existing ?? await subtle().generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false, // non-extractable private key
    ["sign", "verify"],
  );
  if (!existing) await idbPut(ID_STORE, id, pair);
  const raw = await subtle().exportKey("spki", pair.publicKey);
  const digest = await subtle().digest("SHA-256", raw);
  const keyId = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return { pair, pubB64: toB64(raw), keyId };
}

/** Sign arbitrary bytes with the device identity key → base64 signature. */
export async function signWithIdentity(
  identity: DeviceIdentity,
  data: Uint8Array,
): Promise<string> {
  const sig = await subtle().sign(
    { name: "ECDSA", hash: "SHA-256" },
    identity.pair.privateKey,
    data as BufferSource,
  );
  return toB64(sig);
}

/** Verify a signature against a published identity public key. */
export async function verifyIdentitySignature(
  peerPubB64: string,
  data: Uint8Array,
  sigB64: string,
): Promise<boolean> {
  try {
    const pub = await subtle().importKey(
      "spki",
      fromB64(peerPubB64) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return await subtle().verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      fromB64(sigB64) as BufferSource,
      data as BufferSource,
    );
  } catch {
    return false;
  }
}

/** Fingerprint over BOTH identity public keys in canonical order —
 *  same 6-objects + 6-digits format as the session SAS (V1), so both
 *  sides compare identical, speakable output. */
export function identityFingerprint(
  ownPubB64: string,
  peerPubB64: string,
): Promise<SasFingerprint> {
  return sasFingerprint(ownPubB64, peerPubB64);
}
