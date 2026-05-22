/**
 * Persistent ECDSA P-256 device identity (ported from ms-argus-web).
 *
 * Keys are stored in IndexedDB for persistence across sessions. The private
 * key is marked non-extractable — it can sign inside the Web Crypto API
 * but cannot be exported or exfiltrated.
 *
 * Use case here: replaces the old rolling-hash `vmHash` with real
 * cryptographic binding. The `POST_PAYLOAD` bridge handler signs each
 * encrypted envelope with this key and ships the signature + SPKI pubkey
 * as request headers. Server can:
 *   - verify signature (fast-reject bad actors without ECDH decrypt)
 *   - track stable pubkey across sessions (device persistence signal)
 *
 * Differences from the ms-argus-web port:
 *   - Uses a distinct DB name `argus-integrity-db` to avoid collision with
 *     ms-argus-web's `argus-db` schema (which also has an evercookie store
 *     we don't need here).
 *   - No evercookie object store — only the `crypto-keys` store.
 *
 * If IndexedDB is unavailable (Firefox private mode, iframe blocked), we
 * fall back to volatile in-memory keys so the caller always gets a bundle;
 * persistence is best-effort.
 */

import { withTimeout } from './with-timeout';
import { getPristineRefs } from './pristine-iframe';

/**
 * Pristine `crypto.subtle` lifted from a nested hidden iframe — defends
 * against page-realm hooks on top-level `crypto.subtle.generateKey` /
 * `sign` that would substitute the keypair or sign over different
 * data. See CASTLE-TO-ARGUS.md §3.14 bullet C and
 * `utils/pristine-iframe.ts`.
 *
 * Falls back to top-level `crypto.subtle` if the iframe lift fails
 * (very early page lifecycle, sandboxed environment).
 */
function safeSubtle(): SubtleCrypto {
  return getPristineRefs().subtle ?? crypto.subtle;
}

const DATABASE_NAME = 'argus-integrity-db';
/**
 * Schema version. Bump + extend the upgrade handler in `openIntegrityDb`
 * below when adding a new object store. Existing DBs migrate on first open.
 *
 * v1 → v2: added `client-uuid` store for the three-store persistence
 *   feature (see get-client-uuid.ts).
 */
const DATABASE_VERSION = 2;
const TABLE_NAME_KEYS = 'crypto-keys';
/** Re-exported for get-client-uuid.ts so both files agree on the store name. */
export const TABLE_NAME_CLIENT_UUID = 'client-uuid';
const INDEX_VALUE_KEY = 'primary';

/** Timeout for IndexedDB operations (ms). Prevents infinite hangs in Firefox/private mode. */
const IDB_TIMEOUT_MS = 2000;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function exportPublicKeyB64(key: CryptoKey): Promise<string> {
  return arrayBufferToBase64(await safeSubtle().exportKey('spki', key));
}

export interface CryptoKeys {
  id: string;
  publicKey: string;
  privateKey: CryptoKey;
  date: string;
}

interface StoredKeys {
  id: string;
  publicKey: string;
  privateKey: CryptoKey;
  date: string;
}

let memoised: CryptoKeys | undefined;
let inflight: Promise<CryptoKeys> | undefined;

/**
 * Open the shared argus-integrity-db. Exported so get-client-uuid.ts can
 * reuse the same schema + upgrade path — keeping one source of truth
 * prevents the two consumers from racing with divergent upgrade handlers.
 *
 * The upgrade handler is additive: missing stores are created on any
 * v(n)→v(current) jump, so a DB opened by one consumer after the other
 * already upgraded sees a complete schema either way.
 */
export const openIntegrityDb = (): Promise<IDBDatabase> =>
  new Promise((res, rej) => {
    const req = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TABLE_NAME_KEYS)) {
        db.createObjectStore(TABLE_NAME_KEYS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TABLE_NAME_CLIENT_UUID)) {
        db.createObjectStore(TABLE_NAME_CLIENT_UUID, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

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

/**
 * Decoys written alongside the real key on first setup. Each carries
 * plausible crypto-adjacent shape (random bytes + createdAt) so a reverser
 * enumerating IndexedDB can't immediately pick the real entry. Failures are
 * swallowed — decoys are ornamental.
 */
const DECOY_IDS = ['private-key-nonce', 'session-salt', 'device-entropy'];

function randomBytesHex(n: number): string {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, '0');
  }
  return out;
}

async function writeDecoys(db: IDBDatabase): Promise<void> {
  await Promise.all(
    DECOY_IDS.map(
      (id) =>
        new Promise<void>((res) => {
          try {
            const tx = db.transaction(TABLE_NAME_KEYS, 'readwrite');
            const store = tx.objectStore(TABLE_NAME_KEYS);
            const req = store.put({
              id,
              material: randomBytesHex(32),
              createdAt: Date.now(),
            });
            req.onsuccess = () => res();
            req.onerror = () => res(); // best-effort
          } catch {
            res();
          }
        }),
    ),
  );
}

const setupCryptography = async (): Promise<CryptoKeys> => {
  const db = await withTimeout(
    openIntegrityDb(),
    IDB_TIMEOUT_MS,
    undefined,
  ).catch(() => undefined);

  try {
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

    // Non-extractable — private key cannot be exported.
    // Uses pristine subtle so a page-realm hook on
    // crypto.subtle.generateKey can't substitute an attacker-controlled
    // keypair (which would let them impersonate this device across sessions).
    const keyPair = await safeSubtle().generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify'],
    );

    const pubB64 = await exportPublicKeyB64(keyPair.publicKey);

    const stored: StoredKeys = {
      id: INDEX_VALUE_KEY,
      publicKey: pubB64,
      privateKey: keyPair.privateKey,
      date: new Date().toISOString(),
    };

    if (db) {
      await writeStoredKeys(db, stored);
      // Write decoys concurrently with the real key. If they fail, shrug —
      // the real key is what matters.
      await writeDecoys(db);
    }

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

/**
 * Get or create persistent ECDSA device-identity key pair. Memoised;
 * subsequent calls resolve to the same bundle. Falls back to an in-memory
 * keypair if IndexedDB is unavailable.
 */
export const getCryptoId = async (): Promise<CryptoKeys> => {
  if (memoised) return memoised;
  if (!inflight)
    inflight = setupCryptography().catch(async () => {
      // IDB totally unavailable — stay in-memory.
      // Pristine subtle for same reason as the IDB path above.
      const keyPair = await safeSubtle().generateKey(
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
 * Sign data with the persistent private key. Returns Base64 signature.
 */
export const signWithCryptoId = async (
  data: string | ArrayBuffer,
): Promise<string> => {
  const keys = await getCryptoId();
  // Pristine TextEncoder so a page-realm hook on
  // TextEncoder.prototype.encode can't substitute a different string to
  // be signed (which would let an attacker get a valid signature over
  // arbitrary content).
  const pristine = getPristineRefs();
  const dataBuffer =
    typeof data === 'string' ? pristine.textEncode(data) : data;

  const signature = await safeSubtle().sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    dataBuffer,
  );

  return arrayBufferToBase64(signature);
};

/** Reset memoised keys (test-only; does NOT clear IDB). */
export const resetCryptoIdMemo = (): void => {
  memoised = undefined;
  inflight = undefined;
};
