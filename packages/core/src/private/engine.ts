// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Private-layer crypto engine — docs/api/relay-events.md §Key exchange.
 *
 * Ephemeral ECDH P-256 per session → AES-GCM-256. Session keys are
 * non-extractable and live in memory only; public keys are exported raw
 * for the exchange and the SAS fingerprint.
 *
 * Wire format inside the opaque relay `blob`:
 *   { t: "key", k: <base64 raw P-256 pubkey> }   — key material (public,
 *                                                sent in the clear — the
 *                                                SAS is the MITM defense)
 *   { t: "msg", iv: <b64>, ct: <b64> }           — AES-GCM ciphertext of a
 *                                                MsgPayload (below)
 *
 * Everything the server must not see — text, burn-on-read flag, read
 * receipts — lives INSIDE the ciphertext, so a receipt is
 * indistinguishable from a message on the wire.
 */

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable on this platform");
  return c.subtle;
};

export const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

export const fromB64 = (b64: string): Uint8Array => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export interface SessionKeyPair {
  privateKey: CryptoKey; // non-extractable — never leaves this context
  publicKey: CryptoKey;
  /** raw P-256 public key, base64 — sent as the key envelope + SAS input */
  rawPub: string;
}

/** Ephemeral ECDH P-256 pair for one private session — dies with it.
 *  extractable:false applies to the private key only — the public key
 *  stays exportable, so the material never enters JS memory at all. */
export async function generateSessionKeyPair(): Promise<SessionKeyPair> {
  const pair = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"],
  );
  const raw = await subtle().exportKey("raw", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, rawPub: toB64(raw) };
}

/** deriveKey → AES-GCM-256, non-extractable. */
export async function deriveSessionKey(
  own: SessionKeyPair,
  peerRawPub: string,
): Promise<CryptoKey> {
  const peerPub = await subtle().importKey(
    "raw",
    fromB64(peerRawPub) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  return subtle().deriveKey(
    { name: "ECDH", public: peerPub },
    own.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedEnvelope {
  t: "msg";
  iv: string;
  ct: string;
}

export interface KeyEnvelope {
  t: "key";
  k: string;
  /** handshake v2 (F7): `i` = sender's identity pub (b64 SPKI), `s` =
   *  ECDSA signature over the raw `k` bytes. Unsigned envelopes are
   *  rejected — the pinned-pair check is the only trust path. */
  s?: string;
  i?: string;
}

export type Envelope = EncryptedEnvelope | KeyEnvelope;

/** Decrypted payload variants — all inside AES-GCM:
 *  - "t": chat text; `id` is a client-generated uuid (the relay's msgSeq
 *    is not echoed to the sender, so receipts can't reference it);
 *    `bor` marks a view-once message the peer must receipt and drop
 *  - "r": read receipt — peer displayed these message ids; the sender
 *    burns its own copies on arrival */
export type MsgPayload =
  | { k: "t"; id: string; text: string; bor?: boolean }
  | { k: "r"; ids: string[] };

export async function encryptEnvelope(
  key: CryptoKey,
  payload: MsgPayload,
): Promise<EncryptedEnvelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return { t: "msg", iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptEnvelope(
  key: CryptoKey,
  env: EncryptedEnvelope,
): Promise<MsgPayload> {
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(env.iv) as BufferSource },
    key,
    fromB64(env.ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(pt)) as MsgPayload;
}

/** Object set size — indexes into a shell-owned list of nameable items
 *  (animals, food, objects) rendered identically on every platform.
 *  The core emits only indexes; the shell maps them to its own icons. */
export const SAS_SYMBOL_COUNT = 128;
export const SAS_SYMBOL_LEN = 6;
export const SAS_DIGIT_LEN = 6;

/**
 * SAS fingerprint — the ONLY MITM defense (threat model): both parties
 * compare the symbol row + digit code out-of-band. Derived from BOTH
 * session public keys in canonical byte order, so both sides compute
 * identical output and a relay-substituted key produces a different one.
 *
 * Symbols are spoken over a voice channel ("giraffe train orange…") —
 * one-word objects, not faces; digits are the fallback channel.
 * 6 symbols × log2(128) + 6 digits ≈ 62 bits of comparison entropy.
 */
export interface SasFingerprint {
  /** indexes into the shell's object set — length SAS_SYMBOL_LEN */
  symbols: number[];
  /** SAS_DIGIT_LEN decimal digits */
  digits: string;
}

export async function sasFingerprint(
  ownRawPub: string,
  peerRawPub: string,
): Promise<SasFingerprint> {
  const a = fromB64(ownRawPub);
  const b = fromB64(peerRawPub);
  // canonical order — both sides must hash the same byte sequence
  const [first, second] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const cat = new Uint8Array(first.length + second.length);
  cat.set(first);
  cat.set(second, first.length);
  const digest = new Uint8Array(await subtle().digest("SHA-256", cat as BufferSource));
  const symbols: number[] = [];
  for (let i = 0; i < SAS_SYMBOL_LEN; i++) {
    symbols.push(digest[i] % SAS_SYMBOL_COUNT);
  }
  let digits = "";
  for (let i = SAS_SYMBOL_LEN; i < SAS_SYMBOL_LEN + SAS_DIGIT_LEN; i++) {
    digits += String(digest[i] % 10);
  }
  return { symbols, digits };
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
