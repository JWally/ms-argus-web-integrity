/**
 * @fileoverview Utilities for generating browser-persisted ECDSA key pairs.
 *
 * Keys are stored in IndexedDB for persistence across sessions. The private key
 * is marked as non-extractable, meaning it cannot be exported - only used for
 * signing operations within the Web Crypto API.
 *
 * If IndexedDB is unavailable, we fall back to volatile in-memory keys so the
 * caller always gets a working key bundle.
 */

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  TABLE_NAME_KEYS,
  INDEX_VALUE_KEY,
  EVERCOOKIE_DB_STORE,
} from './constants';

import { withTimeout } from './with-timeout';

/** Timeout for IndexedDB operations (ms). Prevents infinite hangs in Firefox/private mode. */
const IDB_TIMEOUT_MS = 2000;

/* ───────────────────────────── Helpers ───────────────────────────── */

/** Convert an ArrayBuffer to a Base64 string */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Export a public CryptoKey in SPKI-Base64 form (handy for logs / transport) */
async function exportPublicKeyB64(key: CryptoKey): Promise<string> {
  return arrayBufferToBase64(await crypto.subtle.exportKey('spki', key));
}

/* ───────────────────────────── Types ───────────────────────────── */

/**
 * Runtime bundle returned to callers. `publicKey` is a Base64-encoded SPKI string,
 * `privateKey` is a live `CryptoKey` instance ready for `sign` operations.
 */
export interface CryptoKeys {
  id: string;
  publicKey: string;
  privateKey: CryptoKey;
  date: string;
}

/** Structure persisted to IndexedDB */
interface StoredKeys {
  id: string;
  publicKey: string;
  privateKey: CryptoKey;
  date: string;
}

/* ─────────────────────────── Internal state ───────────────────────── */

let memoised: CryptoKeys | undefined;
let inflight: Promise<CryptoKeys> | undefined;

/* ─────────────────────────── IDB plumbing ────────────────────────── */

/**
 * Open (or create) the IndexedDB database, ensuring required object stores exist.
 *
 * @returns A promise that resolves with the opened IDBDatabase instance
 */
const openDb = (): Promise<IDBDatabase> =>
  new Promise((res, rej) => {
    const req = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    /** Create object stores on first open or version upgrade. */
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TABLE_NAME_KEYS)) {
        db.createObjectStore(TABLE_NAME_KEYS, { keyPath: 'id' });
      }
      // Create evercookie store for shared DB consistency
      if (!db.objectStoreNames.contains(EVERCOOKIE_DB_STORE)) {
        db.createObjectStore(EVERCOOKIE_DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

/**
 * Retrieve the stored key record from IndexedDB.
 *
 * @param db - An open IDBDatabase instance
 * @returns The stored keys if present, otherwise undefined
 */
const readStoredKeys = async (
  db: IDBDatabase,
): Promise<StoredKeys | undefined> =>
  new Promise((res, rej) => {
    const tx = db.transaction(TABLE_NAME_KEYS, 'readonly');
    const store = tx.objectStore(TABLE_NAME_KEYS);
    const req = store.get(INDEX_VALUE_KEY);
    req.onsuccess = () => res(req.result as StoredKeys | undefined);
    req.onerror = () => rej(req.error);
  });

/**
 * Persist a key record to IndexedDB, overwriting any existing entry.
 *
 * @param db - An open IDBDatabase instance
 * @param data - The key record to store
 * @returns A promise that resolves once the write transaction completes
 */
const writeStoredKeys = async (
  db: IDBDatabase,
  data: StoredKeys,
): Promise<void> =>
  new Promise((res, rej) => {
    const tx = db.transaction(TABLE_NAME_KEYS, 'readwrite');
    const store = tx.objectStore(TABLE_NAME_KEYS);
    const req = store.put(data);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });

/* ────────────────────── Core initialisation logic ─────────────────── */

/**
 * Load existing keys from IndexedDB or generate a fresh ECDSA P-256 key pair.
 *
 * If the database contains a previously stored key record it is returned directly;
 * otherwise a new non-extractable key pair is generated, persisted, and returned.
 *
 * @returns The resolved CryptoKeys bundle
 */
const setupCryptography = async (): Promise<CryptoKeys> => {
  const db = await withTimeout(openDb(), IDB_TIMEOUT_MS, undefined).catch(
    () => undefined,
  );

  try {
    // 1. Attempt to load existing keys from DB
    if (db) {
      const stored = await readStoredKeys(db);
      if (stored) {
        return {
          id: stored.id,
          publicKey: stored.publicKey,
          privateKey: stored.privateKey,
          date: stored.date,
        };
      }
    }

    // 2. Nothing in DB (or DB missing). Generate a fresh pair
    // IMPORTANT: extractable is set to false - private key cannot be exported
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, // non-extractable
      ['sign', 'verify'],
    );

    const pubB64 = await exportPublicKeyB64(keyPair.publicKey);

    const stored: StoredKeys = {
      id: INDEX_VALUE_KEY,
      publicKey: pubB64,
      privateKey: keyPair.privateKey,
      date: new Date().toISOString(),
    };

    if (db) await writeStoredKeys(db, stored);

    return {
      id: stored.id,
      publicKey: stored.publicKey,
      privateKey: keyPair.privateKey,
      date: stored.date,
    };
  } finally {
    db?.close();
  }
};

/* ─────────────────────── Public entry-point ──────────────────────── */

/**
 * Get or create persistent ECDSA key pair.
 *
 * On first call, generates a new P-256 ECDSA key pair and stores it in IndexedDB.
 * Subsequent calls return the same memoised keys.
 *
 * The private key is non-extractable - it can only be used for signing within
 * the Web Crypto API and cannot be exported or accessed directly.
 *
 * @returns Promise<CryptoKeys> containing the public key (Base64) and private CryptoKey
 *
 * @example
 * const keys = await getCryptoId()
 * console.log(keys.publicKey) // Base64-encoded SPKI public key
 *
 * // Sign some data
 * const signature = await crypto.subtle.sign(
 *   { name: 'ECDSA', hash: 'SHA-256' },
 *   keys.privateKey,
 *   data
 * )
 */
export const getCryptoId = async (): Promise<CryptoKeys> => {
  if (memoised) return memoised;
  if (!inflight)
    inflight = setupCryptography().catch(async () => {
      // Absolute worst-case: no IDB (or it errors) - stay fully in-memory
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify'],
      );

      return {
        id: INDEX_VALUE_KEY,
        publicKey: await exportPublicKeyB64(keyPair.publicKey),
        privateKey: keyPair.privateKey,
        date: new Date().toISOString(),
      };
    });

  memoised = await inflight;
  return memoised;
};

/**
 * Sign data using the persistent private key.
 *
 * @param data - The data to sign (will be converted to ArrayBuffer if string)
 * @returns Promise<string> - Base64-encoded signature
 */
export const signWithCryptoId = async (
  data: string | ArrayBuffer,
): Promise<string> => {
  const keys = await getCryptoId();
  const dataBuffer =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    dataBuffer,
  );

  return arrayBufferToBase64(signature);
};

/**
 * Reset the memoised keys (useful for testing).
 * WARNING: This does NOT clear IndexedDB - keys will be reloaded on next getCryptoId() call.
 */
export const resetCryptoIdMemo = (): void => {
  memoised = undefined;
  inflight = undefined;
};

/**
 * Clear all stored keys from IndexedDB.
 * After calling this, getCryptoId() will generate fresh keys.
 */
export const clearStoredKeys = async (): Promise<void> => {
  resetCryptoIdMemo();
  const db = await withTimeout(openDb(), IDB_TIMEOUT_MS, undefined).catch(
    () => undefined,
  );
  if (!db) return;

  try {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(TABLE_NAME_KEYS, 'readwrite');
      const store = tx.objectStore(TABLE_NAME_KEYS);
      const req = store.delete(INDEX_VALUE_KEY);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    });
  } finally {
    db.close();
  }
};
