// Copyright (C) 2025 OpenGlass contributors
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dev-tier identity keys — pwa-dev ONLY.
 *
 * The browser has no keystore; the strongest available primitive is a
 * non-extractable CryptoKey persisted in IndexedDB (structured-cloneable,
 * and `extractable:false` means script cannot read the key material —
 * only use it). Native shells use Keychain/Keystore/safeStorage instead.
 *
 * Zero-trace contract (docs/api/relay-events.md): teardown must delete
 * the database itself — including stores allocated for planned data —
 * leaving no IndexedDB artifacts behind.
 */

const DB_NAME = "openglass-private";
const STORE = "identity";
const KEY_ID = "ecdh-identity";

const idb = (): IDBFactory => {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable — dev-tier keys are pwa-dev only");
  }
  return indexedDB;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb().open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/** Identity ECDH pair — non-extractable, one per device. */
export async function getOrCreateIdentity(): Promise<CryptoKeyPair> {
  const db = await openDb();
  try {
    const existing = await new Promise<CryptoKeyPair | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly").objectStore(STORE);
        const req = tx.get(KEY_ID);
        req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined);
        req.onerror = () => reject(req.error ?? new Error("idb get failed"));
      },
    );
    if (existing) return existing;

    const pair = await globalThis.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false, // non-extractable — material never leaves the key store
      ["deriveKey"],
    );
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(pair, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
    });
    return pair;
  } finally {
    db.close();
  }
}

/**
 * Zero-trace teardown — deletes the WHOLE database, not just the key row:
 * no leftover stores or allocated-but-empty schema folders.
 */
export function wipeIdentityStore(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const req = idb().deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("idb delete failed"));
    req.onblocked = () => resolve(); // conn closing elsewhere — proceed anyway
  });
}
