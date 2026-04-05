/**
 * @fileoverview Favicon cache-based device identification.
 *
 * This module exploits the browser's favicon cache (F-cache) for persistent
 * device identification. The F-cache is separate from the regular HTTP cache
 * and is NOT cleared when users clear browsing data in most browsers.
 *
 * How it works:
 * 1. We create N virtual "favicon slots" (default 32 for 32-bit ID)
 * 2. Each slot is a unique URL path that may or may not be "cached"
 * 3. On first visit, we encode a device ID by selectively caching certain slots
 * 4. On return visits, we detect which slots are cached to reconstruct the ID
 *
 * Detection methods:
 * - Performance API timing (cached resources load faster)
 * - Cache API storage (as fallback/additional persistence)
 * - Resource timing entries
 *
 * Reference: https://github.com/niceplum/niceplum.github.io/supercookie
 *
 * Note: This requires a cooperating server endpoint to serve the favicon probes.
 * For testing, we use Cache API as a simulation.
 */

import { DATABASE_NAME, EVERCOOKIE_KEY } from './constants';
import { expectFailure } from './expected-failure';

/* ─────────────────────────── Constants ─────────────────────────── */

/** Number of bits to encode (32 = ~4 billion unique IDs) */
const FAVICON_BITS = 32;

/** Cache name for favicon data */
const FAVICON_CACHE_NAME = 'argus-favicon-cache';

/** Base path for favicon probe URLs */
const FAVICON_BASE_PATH = '/argus-fav/';

/** Timing threshold (ms) - cached resources typically load under this */
const CACHE_TIMING_THRESHOLD_MS = 50;

/** Timeout for favicon probe requests */
const PROBE_TIMEOUT_MS = 1000;

/* ─────────────────────────── Types ─────────────────────────── */

export interface FaviconCacheData {
  /** The device ID encoded in favicon cache */
  id: string;
  /** Binary representation of the ID */
  bits: string;
  /** ISO timestamp when first created */
  created: string;
  /** ISO timestamp of last access */
  lastSeen: string;
  /** Which method was used to recover */
  method: 'timing' | 'cacheAPI' | 'generated';
}

export interface FaviconCacheConfig {
  /** Number of bits to use (default: 32) */
  bits?: number;
  /** Base URL for favicon probes (default: current origin) */
  baseUrl?: string;
  /** Custom probe path (default: /argus-fav/) */
  probePath?: string;
  /** Timing threshold in ms (default: 50) */
  timingThreshold?: number;
}

interface ProbeResult {
  index: number;
  cached: boolean;
  timing?: number;
}

/* ─────────────────────────── Helpers ─────────────────────────── */

/** Generate a random 32-bit unsigned integer */
function generateRandomId(): number {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0];
}

/** Convert a number to a binary string of fixed length */
function toBinaryString(num: number, bits: number = FAVICON_BITS): string {
  return num.toString(2).padStart(bits, '0');
}

/** Convert a binary string to a number */
function fromBinaryString(binary: string): number {
  return parseInt(binary, 2) >>> 0; // >>> 0 ensures unsigned
}

/** Convert number to hex string for display */
function toHexString(num: number): string {
  return num.toString(16).padStart(8, '0');
}

/** Get the probe URL for a specific bit index */
function getProbeUrl(
  index: number,
  baseUrl: string,
  probePath: string,
): string {
  return `${baseUrl}${probePath}${index}.ico`;
}

/* ─────────────────────────── Cache API Storage ─────────────────────────── */

/**
 * Store favicon cache data using Cache API.
 * This serves as both a fallback and additional persistence layer.
 */
async function storeInCacheAPI(bits: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;

    const cache = await caches.open(FAVICON_CACHE_NAME);

    // Store each "1" bit as a cached entry
    const promises: Promise<void>[] = [];

    for (let i = 0; i < bits.length; i++) {
      const url = getProbeUrl(i, '', FAVICON_BASE_PATH);

      if (bits[i] === '1') {
        // Cache this slot (represents a "1" bit)
        const response = new Response(`bit-${i}`, {
          headers: {
            'Content-Type': 'image/x-icon',
            'Cache-Control': 'max-age=31536000, immutable',
            'X-Argus-Bit': String(i),
          },
        });
        promises.push(cache.put(url, response));
      } else {
        // Ensure this slot is NOT cached (represents a "0" bit)
        promises.push(cache.delete(url).then(() => {}));
      }
    }

    await Promise.all(promises);
    return true;
  } catch {
    expectFailure('caches.open', 'Cache API not available or blocked');
    return false;
  }
}

/**
 * Read favicon cache data from Cache API.
 */
async function readFromCacheAPI(
  numBits: number = FAVICON_BITS,
): Promise<string | null> {
  try {
    if (typeof caches === 'undefined') return null;

    const cache = await caches.open(FAVICON_CACHE_NAME);
    let bits = '';

    for (let i = 0; i < numBits; i++) {
      const url = getProbeUrl(i, '', FAVICON_BASE_PATH);
      const response = await cache.match(url);
      bits += response ? '1' : '0';
    }

    // Check if we have any data (not all zeros)
    if (fromBinaryString(bits) === 0) {
      return null;
    }

    return bits;
  } catch {
    expectFailure('caches.match', 'Cache API read failed');
    return null;
  }
}

/**
 * Clear all favicon cache data from Cache API.
 */
async function clearCacheAPI(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      await caches.delete(FAVICON_CACHE_NAME);
    }
  } catch {
    expectFailure('caches.delete', 'Cache API delete failed');
  }
}

/* ─────────────────────────── Timing-Based Detection ─────────────────────────── */

/**
 * Probe a single favicon URL using timing to detect cache status.
 * Cached resources load significantly faster than uncached ones.
 */
async function probeWithTiming(
  url: string,
  threshold: number = CACHE_TIMING_THRESHOLD_MS,
): Promise<{ cached: boolean; timing: number }> {
  return new Promise((resolve) => {
    const startTime = performance.now();

    // Create an image element to trigger favicon loading
    const img = new Image();

    /** Remove image event handlers to prevent memory leaks */
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
    };

    /** Resolve the probe with cache status based on load timing */
    const handleResult = (success: boolean) => {
      cleanup();
      const timing = performance.now() - startTime;
      // Cached resources typically load in < threshold ms
      const cached = success && timing < threshold;
      resolve({ cached, timing });
    };

    // Set timeout
    const timeout = setTimeout(() => {
      cleanup();
      resolve({ cached: false, timing: PROBE_TIMEOUT_MS });
    }, PROBE_TIMEOUT_MS);

    /** Handle successful image load */
    img.onload = () => {
      clearTimeout(timeout);
      handleResult(true);
    };

    /** Handle failed image load */
    img.onerror = () => {
      clearTimeout(timeout);
      handleResult(false);
    };

    img.src = url;
  });
}

/**
 * Probe multiple favicon URLs in parallel using timing.
 */
async function probeAllWithTiming(
  baseUrl: string,
  probePath: string,
  numBits: number,
  threshold: number,
): Promise<ProbeResult[]> {
  const probes = Array.from({ length: numBits }, (_, i) => {
    const url = getProbeUrl(i, baseUrl, probePath);
    return probeWithTiming(url, threshold).then(({ cached, timing }) => ({
      index: i,
      cached,
      timing,
    }));
  });

  return Promise.all(probes);
}

/**
 * Read device ID using timing-based cache detection.
 * This requires a server endpoint that serves the favicon probes.
 */
async function readWithTiming(
  config: FaviconCacheConfig,
): Promise<string | null> {
  const {
    bits = FAVICON_BITS,
    baseUrl = '',
    probePath = FAVICON_BASE_PATH,
    timingThreshold = CACHE_TIMING_THRESHOLD_MS,
  } = config;

  try {
    const results = await probeAllWithTiming(
      baseUrl,
      probePath,
      bits,
      timingThreshold,
    );

    // Sort by index and construct bit string
    results.sort((a, b) => a.index - b.index);
    const bitString = results.map((r) => (r.cached ? '1' : '0')).join('');

    // Validate - should have some 1s
    if (fromBinaryString(bitString) === 0) {
      return null;
    }

    return bitString;
  } catch {
    expectFailure('probeAllWithTiming', 'Timing-based cache detection failed');
    return null;
  }
}

/* ─────────────────────────── Metadata Storage ─────────────────────────── */

const METADATA_KEY = 'argus-favicon-meta';

interface FaviconMetadata {
  id: number;
  created: string;
  lastSeen: string;
}

/** Retrieve favicon metadata from localStorage */
function getMetadataFromStorage(): FaviconMetadata | null {
  try {
    const stored = localStorage.getItem(METADATA_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    expectFailure(
      'localStorage.getItem',
      'localStorage read failed or blocked',
    );
  }
  return null;
}

/** Persist favicon metadata to localStorage */
function setMetadataToStorage(meta: FaviconMetadata): void {
  try {
    localStorage.setItem(METADATA_KEY, JSON.stringify(meta));
  } catch {
    expectFailure(
      'localStorage.setItem',
      'localStorage write failed or quota exceeded',
    );
  }
}

/** Remove favicon metadata from localStorage */
function clearMetadataFromStorage(): void {
  try {
    localStorage.removeItem(METADATA_KEY);
  } catch {
    expectFailure('localStorage.removeItem', 'localStorage delete failed');
  }
}

/* ─────────────────────────── Memoization ─────────────────────────── */

let memoizedData: FaviconCacheData | undefined;
let inflightPromise: Promise<FaviconCacheData> | undefined;

/* ─────────────────────────── Public API ─────────────────────────── */

/**
 * Get or create a device ID stored in the favicon cache.
 *
 * This function:
 * 1. First tries to read from Cache API (fastest, most reliable in JS)
 * 2. Optionally tries timing-based detection (requires server support)
 * 3. If no ID found, generates a new one and stores it
 *
 * @param config - Optional configuration for probe behavior
 * @returns Promise<FaviconCacheData> - The device identifier with metadata
 *
 * @example
 * const { id, bits, method } = await getFaviconCacheId()
 * console.log(`Device ID: ${id}`)
 * console.log(`Binary: ${bits}`)
 * console.log(`Recovered via: ${method}`)
 */
export async function getFaviconCacheId(
  config: FaviconCacheConfig = {},
): Promise<FaviconCacheData> {
  // Return memoized value if available
  if (memoizedData) return memoizedData;

  // Deduplicate concurrent calls
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    const now = new Date().toISOString();
    const meta = getMetadataFromStorage();

    // Try Cache API first (most reliable in JS environment)
    const cacheAPIBits = await readFromCacheAPI(config.bits || FAVICON_BITS);

    if (cacheAPIBits) {
      const id = fromBinaryString(cacheAPIBits);
      const data: FaviconCacheData = {
        id: toHexString(id),
        bits: cacheAPIBits,
        created: meta?.created || now,
        lastSeen: now,
        method: 'cacheAPI',
      };

      // Update metadata
      setMetadataToStorage({
        id,
        created: data.created,
        lastSeen: now,
      });

      memoizedData = data;
      return data;
    }

    // Try timing-based detection if baseUrl is provided
    if (config.baseUrl) {
      const timingBits = await readWithTiming(config);
      if (timingBits) {
        const id = fromBinaryString(timingBits);
        const data: FaviconCacheData = {
          id: toHexString(id),
          bits: timingBits,
          created: meta?.created || now,
          lastSeen: now,
          method: 'timing',
        };

        // Store in Cache API as backup
        await storeInCacheAPI(timingBits);

        setMetadataToStorage({
          id,
          created: data.created,
          lastSeen: now,
        });

        memoizedData = data;
        return data;
      }
    }

    // Check if we have metadata but lost the cache (can happen)
    // In this case, regenerate with same ID if recent
    if (
      meta &&
      Date.now() - new Date(meta.lastSeen).getTime() < 7 * 24 * 60 * 60 * 1000
    ) {
      // Metadata is less than 7 days old, try to restore
      const bits = toBinaryString(meta.id);
      await storeInCacheAPI(bits);

      const data: FaviconCacheData = {
        id: toHexString(meta.id),
        bits,
        created: meta.created,
        lastSeen: now,
        method: 'cacheAPI',
      };

      setMetadataToStorage({
        ...meta,
        lastSeen: now,
      });

      memoizedData = data;
      return data;
    }

    // Generate new ID
    const newId = generateRandomId();
    const newBits = toBinaryString(newId);

    // Store in Cache API
    await storeInCacheAPI(newBits);

    const data: FaviconCacheData = {
      id: toHexString(newId),
      bits: newBits,
      created: now,
      lastSeen: now,
      method: 'generated',
    };

    setMetadataToStorage({
      id: newId,
      created: now,
      lastSeen: now,
    });

    memoizedData = data;
    return data;
  })();

  const result = await inflightPromise;
  inflightPromise = undefined;
  return result;
}

/**
 * Get the current favicon cache ID synchronously (if already loaded).
 */
export function getFaviconCacheIdSync(): FaviconCacheData | undefined {
  return memoizedData;
}

/**
 * Force a refresh of the favicon cache ID.
 */
export async function refreshFaviconCacheId(
  config: FaviconCacheConfig = {},
): Promise<FaviconCacheData> {
  memoizedData = undefined;
  inflightPromise = undefined;
  return getFaviconCacheId(config);
}

/**
 * Clear all favicon cache data.
 */
export async function clearFaviconCacheId(): Promise<void> {
  memoizedData = undefined;
  inflightPromise = undefined;
  await clearCacheAPI();
  clearMetadataFromStorage();
}

/**
 * Manually set a specific ID in the favicon cache.
 * Useful for syncing with evercookie or server-assigned IDs.
 */
export async function setFaviconCacheId(
  hexId: string,
): Promise<FaviconCacheData> {
  const id = parseInt(hexId, 16);
  if (isNaN(id)) {
    throw new Error('Invalid hex ID');
  }

  memoizedData = undefined;
  inflightPromise = undefined;

  const bits = toBinaryString(id);
  const now = new Date().toISOString();

  await storeInCacheAPI(bits);

  const data: FaviconCacheData = {
    id: toHexString(id),
    bits,
    created: now,
    lastSeen: now,
    method: 'cacheAPI',
  };

  setMetadataToStorage({
    id,
    created: now,
    lastSeen: now,
  });

  memoizedData = data;
  return data;
}

/**
 * Get diagnostic information about favicon cache storage.
 */
export async function getFaviconCacheDiagnostics(): Promise<{
  cacheAPIAvailable: boolean;
  cacheAPIHasData: boolean;
  metadataAvailable: boolean;
  bitCount: number;
  setBits: number[];
}> {
  const cacheAPIAvailable = typeof caches !== 'undefined';
  let cacheAPIHasData = false;
  const setBits: number[] = [];

  if (cacheAPIAvailable) {
    try {
      const cache = await caches.open(FAVICON_CACHE_NAME);

      for (let i = 0; i < FAVICON_BITS; i++) {
        const url = getProbeUrl(i, '', FAVICON_BASE_PATH);
        const response = await cache.match(url);
        if (response) {
          cacheAPIHasData = true;
          setBits.push(i);
        }
      }
    } catch {
      expectFailure('caches.match', 'Cache API diagnostics failed');
    }
  }

  const meta = getMetadataFromStorage();

  return {
    cacheAPIAvailable,
    cacheAPIHasData,
    metadataAvailable: meta !== null,
    bitCount: FAVICON_BITS,
    setBits,
  };
}

/**
 * Server endpoint handler for favicon probes.
 * This is a reference implementation - actual server code will vary.
 *
 * @example
 * // Express.js example:
 * app.get('/argus-fav/:bit.ico', (req, res) => {
 *   const bit = parseInt(req.params.bit)
 *   // Return a tiny 1x1 transparent ICO
 *   const ico = Buffer.from([
 *     0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01,
 *     0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x30, 0x00,
 *     0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00,
 *     0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00,
 *     0x00, 0x00, 0x01, 0x00, 0x18, 0x00, 0x00, 0x00,
 *     0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
 *     0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
 *     0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
 *     0xff, 0xff, 0x00, 0x00, 0x00, 0x00
 *   ])
 *
 *   res.set({
 *     'Content-Type': 'image/x-icon',
 *     'Cache-Control': 'public, max-age=31536000, immutable',
 *     'ETag': `"argus-${bit}"`,
 *   })
 *   res.send(ico)
 * })
 */
export const SERVER_REFERENCE = {
  probePath: FAVICON_BASE_PATH,
  bitCount: FAVICON_BITS,
  contentType: 'image/x-icon',
  cacheControl: 'public, max-age=31536000, immutable',
};
