/**
 * @fileoverview Multi-storage evercookie implementation for persistent device identification.
 *
 * This module stores a device ID across multiple browser storage mechanisms.
 * If any single mechanism survives clearing, the ID is "respawned" to all others.
 *
 * Storage mechanisms (in priority order):
 * 1. IndexedDB - Most persistent, survives most clearing
 * 2. localStorage - 5MB, survives session
 * 3. sessionStorage - Session only, but useful for cross-tab via BroadcastChannel
 * 4. Cookies - HttpOnly preferred via server, fallback to document.cookie
 * 5. Cache API - Can be very persistent, less commonly cleared
 *
 * Usage:
 * ```typescript
 * const id = await getEvercookieId()
 * // Returns existing ID from any surviving store, or generates new one
 * // Automatically respawns to all available stores
 * ```
 */

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  EVERCOOKIE_DB_STORE,
  EVERCOOKIE_KEY,
  EVERCOOKIE_CACHE_NAME,
  EVERCOOKIE_CACHE_URL,
  BROADCAST_CHANNEL_NAME,
} from './constants';
import { expectFailure } from './expected-failure';

import { withTimeout } from './with-timeout';

/** Timeout for IndexedDB operations (ms). Prevents infinite hangs in Firefox/private mode. */
const IDB_TIMEOUT_MS = 2000;

import {
  getFaviconCacheId,
  setFaviconCacheId,
  clearFaviconCacheId,
  getFaviconCacheDiagnostics,
} from './favicon-cache';

/* ─────────────────────────── Types ─────────────────────────── */

export interface EvercookieData {
  /** The persistent device identifier */
  id: string;
  /** ISO timestamp when first created */
  created: string;
  /** ISO timestamp of last access/respawn */
  lastSeen: string;
  /** Which storage mechanism this was recovered from */
  recoveredFrom?: StorageMechanism;
}

export type StorageMechanism =
  | 'indexedDB'
  | 'localStorage'
  | 'sessionStorage'
  | 'cookie'
  | 'cacheAPI'
  | 'faviconCache'
  | 'broadcastChannel'
  | 'generated';

interface StorageResult {
  mechanism: StorageMechanism;
  data: EvercookieData | null;
}

/* ─────────────────────────── Helpers ─────────────────────────── */

/** Generate a cryptographically random UUID */
function generateId(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback to manual UUID v4 generation
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Serialize evercookie data for storage */
function serialize(data: EvercookieData): string {
  return JSON.stringify(data);
}

/** Deserialize evercookie data from storage */
function deserialize(str: string | null | undefined): EvercookieData | null {
  if (!str) return null;
  try {
    const parsed = JSON.parse(str);
    // Validate structure
    if (typeof parsed.id === 'string' && typeof parsed.created === 'string') {
      return parsed as EvercookieData;
    }
  } catch {
    expectFailure('JSON.parse', 'Invalid or corrupted stored data');
  }
  return null;
}

/* ─────────────────────────── IndexedDB Storage ─────────────────────────── */

/** Opens or creates the IndexedDB database for evercookie storage. */
async function openEvercookieDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    /** Handle database schema creation/migration. */
    request.onupgradeneeded = () => {
      const db = request.result;
      // Create evercookie store if it doesn't exist
      if (!db.objectStoreNames.contains(EVERCOOKIE_DB_STORE)) {
        db.createObjectStore(EVERCOOKIE_DB_STORE, { keyPath: 'key' });
      }
      // Keep existing crypto-keys store
      if (!db.objectStoreNames.contains('crypto-keys')) {
        db.createObjectStore('crypto-keys', { keyPath: 'id' });
      }
    };

    /** Resolve with the opened database instance. */
    request.onsuccess = () => resolve(request.result);
    /** Reject with the database open error. */
    request.onerror = () => reject(request.error);
  });
}

/** Reads evercookie data from IndexedDB, returning null if unavailable. */
async function readFromIndexedDB(): Promise<EvercookieData | null> {
  try {
    const db = await withTimeout(openEvercookieDb(), IDB_TIMEOUT_MS, null);
    if (!db) {
      expectFailure('indexedDB.open', 'Timeout - IndexedDB blocked or slow');
      return null;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(EVERCOOKIE_DB_STORE, 'readonly');
      const store = tx.objectStore(EVERCOOKIE_DB_STORE);
      const request = store.get(EVERCOOKIE_KEY);

      /** Resolve with deserialized data from the store. */
      request.onsuccess = () => {
        db.close();
        const result = request.result;
        resolve(result?.data ? deserialize(result.data) : null);
      };
      /** Resolve null on read failure. */
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    expectFailure('indexedDB.read', 'Private browsing or storage blocked');
    return null;
  }
}

/** Writes evercookie data to IndexedDB, returning success status. */
async function writeToIndexedDB(data: EvercookieData): Promise<boolean> {
  try {
    const db = await withTimeout(openEvercookieDb(), IDB_TIMEOUT_MS, null);
    if (!db) {
      expectFailure('indexedDB.open', 'Timeout - IndexedDB blocked or slow');
      return false;
    }
    return new Promise((resolve) => {
      const tx = db.transaction(EVERCOOKIE_DB_STORE, 'readwrite');
      const store = tx.objectStore(EVERCOOKIE_DB_STORE);
      const request = store.put({ key: EVERCOOKIE_KEY, data: serialize(data) });

      /** Resolve true on successful write. */
      request.onsuccess = () => {
        db.close();
        resolve(true);
      };
      /** Resolve false on write failure. */
      request.onerror = () => {
        db.close();
        resolve(false);
      };
    });
  } catch {
    expectFailure('indexedDB.write', 'Private browsing or storage blocked');
    return false;
  }
}

/* ─────────────────────────── localStorage Storage ─────────────────────────── */

/** Reads evercookie data from localStorage. */
function readFromLocalStorage(): EvercookieData | null {
  try {
    const stored = localStorage.getItem(EVERCOOKIE_KEY);
    return deserialize(stored);
  } catch {
    expectFailure(
      'localStorage.getItem',
      'Private browsing or storage blocked',
    );
    return null;
  }
}

/** Writes evercookie data to localStorage. */
function writeToLocalStorage(data: EvercookieData): boolean {
  try {
    localStorage.setItem(EVERCOOKIE_KEY, serialize(data));
    return true;
  } catch {
    expectFailure('localStorage.setItem', 'Quota exceeded or private browsing');
    return false;
  }
}

/* ─────────────────────────── sessionStorage Storage ─────────────────────────── */

/** Reads evercookie data from sessionStorage. */
function readFromSessionStorage(): EvercookieData | null {
  try {
    const stored = sessionStorage.getItem(EVERCOOKIE_KEY);
    return deserialize(stored);
  } catch {
    expectFailure(
      'sessionStorage.getItem',
      'Private browsing or storage blocked',
    );
    return null;
  }
}

/** Writes evercookie data to sessionStorage. */
function writeToSessionStorage(data: EvercookieData): boolean {
  try {
    sessionStorage.setItem(EVERCOOKIE_KEY, serialize(data));
    return true;
  } catch {
    expectFailure(
      'sessionStorage.setItem',
      'Quota exceeded or private browsing',
    );
    return false;
  }
}

/* ─────────────────────────── Cookie Storage ─────────────────────────── */

/** Reads evercookie data from document.cookie by parsing all cookies. */
function readFromCookie(): EvercookieData | null {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name === EVERCOOKIE_KEY) {
        const value = decodeURIComponent(valueParts.join('='));
        return deserialize(value);
      }
    }
  } catch {
    expectFailure('document.cookie', 'Cookie access blocked or disabled');
  }
  return null;
}

/** Writes evercookie data as a document.cookie with 10-year expiration. */
function writeToCookie(data: EvercookieData): boolean {
  try {
    const value = encodeURIComponent(serialize(data));
    // Set cookie with 10 year expiration, SameSite=Lax for 3rd party compat
    const expires = new Date(
      Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
    ).toUTCString();
    document.cookie = `${EVERCOOKIE_KEY}=${value}; expires=${expires}; path=/; SameSite=Lax`;
    return true;
  } catch {
    expectFailure('document.cookie write', 'Cookie write blocked or disabled');
    return false;
  }
}

/* ─────────────────────────── Cache API Storage ─────────────────────────── */

/** Reads evercookie data from the Cache API, returning null if unavailable. */
async function readFromCacheAPI(): Promise<EvercookieData | null> {
  try {
    if (!('caches' in self)) return null;

    const cache = await caches.open(EVERCOOKIE_CACHE_NAME);
    const response = await cache.match(EVERCOOKIE_CACHE_URL);

    if (response) {
      const text = await response.text();
      return deserialize(text);
    }
  } catch {
    expectFailure('caches.match', 'Cache API read failed or unavailable');
  }
  return null;
}

/** Writes evercookie data to the Cache API as a JSON response. */
async function writeToCacheAPI(data: EvercookieData): Promise<boolean> {
  try {
    if (!('caches' in self)) return false;

    const cache = await caches.open(EVERCOOKIE_CACHE_NAME);
    const response = new Response(serialize(data), {
      headers: {
        'Content-Type': 'application/json',
        // Set cache headers for maximum persistence
        'Cache-Control': 'max-age=31536000, immutable',
      },
    });
    await cache.put(EVERCOOKIE_CACHE_URL, response);
    return true;
  } catch {
    expectFailure('caches.put', 'Cache API write failed or unavailable');
    return false;
  }
}

/* ─────────────────────────── BroadcastChannel Sync ─────────────────────────── */

let broadcastChannel: BroadcastChannel | null = null;
let channelData: EvercookieData | null = null;

/** Initializes the BroadcastChannel for cross-tab evercookie sync. */
function initBroadcastChannel(): void {
  if (broadcastChannel || typeof BroadcastChannel === 'undefined') return;

  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);

    /** Handle incoming evercookie data from another tab. */
    broadcastChannel.onmessage = (event) => {
      const data = deserialize(event.data);
      if (data) {
        channelData = data;
        // Respawn to local stores when receiving from another tab
        respawnToAllStores(data).catch(() => {});
      }
    };
  } catch {
    expectFailure('BroadcastChannel', 'BroadcastChannel not available');
  }
}

/** Broadcasts evercookie data to other tabs via BroadcastChannel. */
function broadcastData(data: EvercookieData): void {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(serialize(data));
    } catch {
      expectFailure(
        'broadcastChannel.postMessage',
        'Channel closed or unavailable',
      );
    }
  }
}

/** Returns cached evercookie data received from BroadcastChannel, if any. */
function readFromBroadcastChannel(): EvercookieData | null {
  return channelData;
}

/* ─────────────────────────── Multi-Storage Orchestration ─────────────────────────── */

/**
 * Read from all storage mechanisms in parallel
 * Returns the first valid result found (by priority)
 *
 * Note: Favicon cache is NOT included here because it only stores 32 bits of the UUID.
 * It's used as a supplementary persistence layer (write-only) and for server-side
 * correlation via timing attacks. Use getFaviconCacheId() directly for 32-bit tracking.
 */
async function readFromAllStores(): Promise<StorageResult> {
  // Initialize broadcast channel for cross-tab sync
  initBroadcastChannel();

  // Read from all mechanisms in parallel
  const [indexedDB, cacheAPI] = await Promise.all([
    readFromIndexedDB(),
    readFromCacheAPI(),
  ]);

  // Synchronous reads
  const localStorage = readFromLocalStorage();
  const sessionStorage = readFromSessionStorage();
  const cookie = readFromCookie();
  const broadcast = readFromBroadcastChannel();

  // Priority order: IndexedDB > Cache API > localStorage > cookie > sessionStorage > broadcast
  if (indexedDB) return { mechanism: 'indexedDB', data: indexedDB };
  if (cacheAPI) return { mechanism: 'cacheAPI', data: cacheAPI };
  if (localStorage) return { mechanism: 'localStorage', data: localStorage };
  if (cookie) return { mechanism: 'cookie', data: cookie };
  if (sessionStorage)
    return { mechanism: 'sessionStorage', data: sessionStorage };
  if (broadcast) return { mechanism: 'broadcastChannel', data: broadcast };

  return { mechanism: 'generated', data: null };
}

/**
 * Write to all available storage mechanisms
 * Returns count of successful writes
 */
async function respawnToAllStores(data: EvercookieData): Promise<number> {
  let successCount = 0;

  // Parallel async writes (including favicon cache)
  const [idbSuccess, cacheSuccess, faviconSuccess] = await Promise.all([
    writeToIndexedDB(data),
    writeToCacheAPI(data),
    // Write to favicon cache - use first 8 chars of UUID as hex ID
    setFaviconCacheId(data.id.replace(/-/g, '').slice(0, 8))
      .then(() => true)
      .catch(() => false),
  ]);

  if (idbSuccess) successCount++;
  if (cacheSuccess) successCount++;
  if (faviconSuccess) successCount++;

  // Synchronous writes
  if (writeToLocalStorage(data)) successCount++;
  if (writeToSessionStorage(data)) successCount++;
  if (writeToCookie(data)) successCount++;

  // Broadcast to other tabs
  broadcastData(data);

  return successCount;
}

/* ─────────────────────────── Memoization ─────────────────────────── */

let memoizedData: EvercookieData | undefined;
let inflightPromise: Promise<EvercookieData> | undefined;

/* ─────────────────────────── Public API ─────────────────────────── */

/**
 * Get or create a persistent device identifier.
 *
 * This function:
 * 1. Checks all storage mechanisms for an existing ID
 * 2. If found, respawns to any mechanisms that were cleared
 * 3. If not found, generates a new ID and stores everywhere
 *
 * The ID is memoized for the session, so subsequent calls are instant.
 *
 * @returns Promise<EvercookieData> - The persistent device identifier with metadata
 *
 * @example
 * const { id, created, recoveredFrom } = await getEvercookieId()
 * console.log(`Device ID: ${id}`)
 * console.log(`First seen: ${created}`)
 * if (recoveredFrom) console.log(`Recovered from: ${recoveredFrom}`)
 */
export async function getEvercookieId(): Promise<EvercookieData> {
  // Return memoized value if available
  if (memoizedData) return memoizedData;

  // Deduplicate concurrent calls
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    const { mechanism, data } = await readFromAllStores();

    if (data) {
      // Found existing ID - update lastSeen and respawn
      const updated: EvercookieData = {
        ...data,
        lastSeen: new Date().toISOString(),
        recoveredFrom: mechanism === 'generated' ? undefined : mechanism,
      };

      // Respawn to all stores (don't await - fire and forget for performance)
      respawnToAllStores(updated).catch(() => {});

      memoizedData = updated;
      return updated;
    }

    // No existing ID - generate new one
    const now = new Date().toISOString();
    const newData: EvercookieData = {
      id: generateId(),
      created: now,
      lastSeen: now,
      recoveredFrom: undefined,
    };

    // Store everywhere
    await respawnToAllStores(newData);

    memoizedData = newData;
    return newData;
  })();

  const result = await inflightPromise;
  inflightPromise = undefined;
  return result;
}

/**
 * Get the current evercookie ID synchronously (if already loaded).
 *
 * @returns EvercookieData | undefined - The cached data or undefined if not yet loaded
 */
export function getEvercookieIdSync(): EvercookieData | undefined {
  return memoizedData;
}

/**
 * Force a refresh of the evercookie from all storage mechanisms.
 * Useful if you suspect the ID might have been updated in another tab.
 *
 * @returns Promise<EvercookieData> - The refreshed device identifier
 */
export async function refreshEvercookieId(): Promise<EvercookieData> {
  memoizedData = undefined;
  inflightPromise = undefined;
  return getEvercookieId();
}

/**
 * Clear all evercookie data from all storage mechanisms.
 * WARNING: This will generate a new ID on next getEvercookieId() call.
 *
 * @returns Promise<void>
 */
export async function clearEvercookieId(): Promise<void> {
  memoizedData = undefined;
  inflightPromise = undefined;

  // Clear all stores in parallel
  const clearPromises: Promise<void>[] = [];

  // IndexedDB
  clearPromises.push(
    withTimeout(openEvercookieDb(), IDB_TIMEOUT_MS, null)
      .then((db) => {
        if (!db) return;
        return new Promise<void>((resolve) => {
          const tx = db.transaction(EVERCOOKIE_DB_STORE, 'readwrite');
          const store = tx.objectStore(EVERCOOKIE_DB_STORE);
          const request = store.delete(EVERCOOKIE_KEY);
          /** Close DB and resolve after successful deletion. */
          request.onsuccess = () => {
            db.close();
            resolve();
          };
          /** Close DB and resolve even on deletion failure. */
          request.onerror = () => {
            db.close();
            resolve();
          };
        });
      })
      .catch(() => {}),
  );

  // Cache API
  if (typeof caches !== 'undefined') {
    clearPromises.push(
      caches
        .delete(EVERCOOKIE_CACHE_NAME)
        .then(() => {})
        .catch(() => {}),
    );
  }

  // Favicon cache
  clearPromises.push(clearFaviconCacheId().catch(() => {}));

  // Synchronous clears
  try {
    localStorage.removeItem(EVERCOOKIE_KEY);
  } catch {
    expectFailure('localStorage.removeItem', 'localStorage clear failed');
  }

  try {
    sessionStorage.removeItem(EVERCOOKIE_KEY);
  } catch {
    expectFailure('sessionStorage.removeItem', 'sessionStorage clear failed');
  }

  try {
    document.cookie = `${EVERCOOKIE_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  } catch {
    expectFailure('document.cookie clear', 'Cookie clear failed');
  }

  await Promise.all(clearPromises);
}

/**
 * Get diagnostic information about which storage mechanisms are available and populated.
 *
 * @returns Promise<Record<StorageMechanism, { available: boolean; hasData: boolean }>>
 */
export async function getEvercookieDiagnostics(): Promise<
  Record<StorageMechanism, { available: boolean; hasData: boolean }>
> {
  const [indexedDB, cacheAPI, faviconDiag] = await Promise.all([
    readFromIndexedDB(),
    readFromCacheAPI(),
    getFaviconCacheDiagnostics(),
  ]);

  const localStorage = readFromLocalStorage();
  const sessionStorage = readFromSessionStorage();
  const cookie = readFromCookie();
  const broadcast = readFromBroadcastChannel();

  return {
    indexedDB: {
      available: typeof indexedDB !== 'undefined',
      hasData: indexedDB !== null,
    },
    localStorage: {
      available: typeof window !== 'undefined' && 'localStorage' in window,
      hasData: localStorage !== null,
    },
    sessionStorage: {
      available: typeof window !== 'undefined' && 'sessionStorage' in window,
      hasData: sessionStorage !== null,
    },
    cookie: {
      available: typeof document !== 'undefined' && 'cookie' in document,
      hasData: cookie !== null,
    },
    cacheAPI: {
      available: 'caches' in self,
      hasData: cacheAPI !== null,
    },
    faviconCache: {
      available: faviconDiag.cacheAPIAvailable,
      hasData: faviconDiag.cacheAPIHasData || faviconDiag.metadataAvailable,
    },
    broadcastChannel: {
      available: typeof BroadcastChannel !== 'undefined',
      hasData: broadcast !== null,
    },
    generated: {
      available: true,
      hasData: false,
    },
  };
}

/**
 * Manually trigger a respawn to all storage mechanisms.
 * Useful after detecting that some stores were cleared.
 *
 * @returns Promise<number> - Count of successful writes
 */
export async function forceRespawn(): Promise<number> {
  const data = memoizedData || (await getEvercookieId());
  return respawnToAllStores(data);
}
