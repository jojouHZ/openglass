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
/** F7: pin store — { peerUserId → pin } scoped per signed-in user. */
export const PINS_STORE = "pins";

const idb = (): IDBFactory => {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable — dev-tier keys are pwa-dev only");
  }
  return indexedDB;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb().open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(PINS_STORE)) db.createObjectStore(PINS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/** Small typed helpers — shared by identity (F7) and pins. */
export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error ?? new Error("idb get failed"));
    });
  } finally {
    db.close();
  }
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
    });
  } finally {
    db.close();
  }
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb delete failed"));
    });
  } finally {
    db.close();
  }
}

export async function idbAll<T>(store: string, query?: IDBKeyRange): Promise<T[]> {
  const db = await openDb();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const req = db.transaction(store, "readonly").objectStore(store).getAll(query);
      req.onsuccess = () => resolve(req.result as T[]);
      req.onerror = () => reject(req.error ?? new Error("idb getAll failed"));
    });
  } finally {
    db.close();
  }
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
 * Boot sweep — the zero-trace guarantee for unclean shutdowns.
 *
 * teardown() deletes the whole DB, so a DB that still exists at boot
 * means the previous session died without teardown (hard kill, crash,
 * power loss — or a pagehide the browser cut short). Wipe it before any
 * identity work so a deliberately-burned identity is never reused.
 */
export function prepareIdentityStore(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    let created = false;
    const req = idb().open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      // fires only when the DB is created — i.e. none existed before
      created = true;
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(PINS_STORE)) db.createObjectStore(PINS_STORE);
    };
    req.onsuccess = () => {
      req.result.close();
      if (created) resolve();
      else resolve(wipeIdentityStore());
    };
    // degraded, not broken — a failed sweep must never block boot
    req.onerror = () => resolve();
  });
}

export async function prepareDeviceStore(): Promise<void> {
  const db = await openDb();
  db.close();
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
    req.onblocked = () => reject(new Error("identity store deletion blocked")); // deletion is not confirmed
  });
}
