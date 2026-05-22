/**
 * Cryptographic Utilities Module
 *
 * Provides hashing, encryption, and bot detection utilities for fingerprinting.
 *
 * Functions:
 * - `hashMini`: Fast 8-character FNV-1a inspired hash
 * - `hashify`: SHA-256 hash with non-secure context fallback
 * - `cipher`: AES-GCM encryption for data protection
 * - `getBotHash`: Binary hash representing bot detection signals
 * - `getFuzzyHash`: SimHash for locality-sensitive fingerprint matching
 * - `getSimHashDistance`: Hamming distance between SimHash values
 *
 * All `JSON.stringify` and `TextEncoder.encode` calls in this module
 * route through the iframe-pristine references (see
 * `utils/pristine-iframe.ts`) to defend against the §3.11 chokepoint
 * MITM attack from CASTLE-TO-ARGUS.md §3.14 bullet B. A page-realm
 * hook on top-level `JSON.stringify` does not see values being
 * fingerprinted here, nor can it substitute baseline values before
 * hashing.
 *
 * @module utils/crypto
 */

import { getPristineRefs } from './pristine-iframe';

/**
 * Generates an 8-character hex hash using an FNV-1a inspired algorithm.
 *
 * @param x - The value to hash (will be JSON-serialized)
 * @returns An 8-character hexadecimal hash string
 */
const hashMini = (x: any) => {
  const json = `${getPristineRefs().stringify(x)}`;
  const hash = json.split('').reduce((hash, char, i) => {
    return (Math.imul(31, hash) + json.charCodeAt(i)) | 0;
  }, 0x811c9dc5);
  return ('0000000' + (hash >>> 0).toString(16)).substr(-8);
};

/** Random instance identifier generated once per page load. */
const instanceId =
  String.fromCharCode(Math.random() * 26 + 97) +
  Math.random().toString(36).slice(-7);

/**
 * Generates a SHA-256 hex hash of JSON-serialized input, falling back to
 * hashMini for non-secure contexts where crypto.subtle is unavailable.
 *
 * @param x - The value to hash (will be JSON-serialized)
 * @param algorithm - The digest algorithm to use (defaults to SHA-256)
 * @returns A promise resolving to the hexadecimal hash string
 */
const hashify = (x: any, algorithm = 'SHA-256') => {
  const pristine = getPristineRefs();
  const json = `${pristine.stringify(x)}`;

  // Fallback for non-secure contexts (HTTP) where crypto.subtle is unavailable
  if (!crypto.subtle) {
    // Use hashMini as fallback - less secure but functional for testing
    return Promise.resolve(hashMini(x).padEnd(64, '0'));
  }

  const subtleImpl = pristine.subtle ?? crypto.subtle;
  const jsonBuffer = pristine.textEncode(json);
  return subtleImpl.digest(algorithm, jsonBuffer).then((hashBuffer) => {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => ('00' + b.toString(16)).slice(-2))
      .join('');
    return hashHex;
  });
};

/**
 * Encrypts data using AES-GCM and returns the ciphertext, initialization vector,
 * and key as base64-encoded strings. Falls back to a plain base64 encoding in
 * non-secure contexts where crypto.subtle is unavailable.
 *
 * @param data - The data to encrypt (will be JSON-serialized)
 * @returns A promise resolving to a tuple of [ciphertext, IV, key] as base64 strings
 */
async function cipher(data: any): Promise<string[]> {
  const pristine = getPristineRefs();

  // Fallback for non-secure contexts (HTTP) where crypto.subtle is unavailable
  if (!crypto.subtle) {
    // Return dummy values - cipher isn't used in core fingerprinting
    const fallback = btoa(pristine.stringify(data));
    return [fallback, 'no-iv', 'no-key'];
  }

  const subtleImpl = pristine.subtle ?? crypto.subtle;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await subtleImpl.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const json = pristine.stringify(data);
  const encoded = pristine.textEncode(json);
  const ciphertext = await subtleImpl.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  const message = btoa(
    String.fromCharCode.apply(
      null,
      new Uint8Array(ciphertext) as unknown as number[],
    ),
  );
  const vector = btoa(
    String.fromCharCode.apply(null, iv as unknown as number[]),
  );
  const { k: keyData } = await subtleImpl.exportKey('jwk', key);

  return [message, vector, keyData!];
}

/**
 * SimHash - Locality Sensitive Hash for fingerprint similarity matching
 *
 * Unlike cryptographic hashes (SHA-256), SimHash preserves locality:
 * similar inputs produce similar outputs, enabling similarity comparison
 * via Hamming distance.
 *
 * Algorithm:
 * 1. Each feature contributes a weighted vote to each bit position
 * 2. Feature value is hashed to determine vote direction (+/- weight)
 * 3. Final bit = 1 if cumulative vote > 0, else 0
 *
 * Interpretation:
 * - Hamming distance 0-3: Very likely same device
 * - Hamming distance 4-8: Possibly same device (browser update, config change)
 * - Hamming distance 9+: Likely different devices
 *
 * Feature weights derived from empirical analysis of fingerprint stability
 * and discriminative power across device types.
 */

// Feature weights based on empirical analysis:
// Score = (within-group consistency) * (between-group discrimination) * sqrt(entropy)
// Higher weight = more stable within same device, more discriminating between devices
const SIMHASH_FEATURE_WEIGHTS: Record<string, number> = {
  // TIER 1 (weight=8): Highly stable and discriminating
  'workerScope.userAgentVersion': 8,
  'canvas2d.paintCpuURI': 8,
  'clientRects.domrectSystemSum': 8,
  'fonts.pixelSizeSystemSum': 8,
  'canvas2d.textURI': 8,
  'windowFeatures.keys': 8,
  'navigator.userAgentParsed': 8,
  'navigator.properties': 8,
  'htmlElementVersion.keys': 8,
  'css.computedStyle': 8,
  'css.system': 8,
  'canvas2d.dataURI': 8,
  'canvas2d.paintURI': 8,
  'cssMedia.mediaCSS': 8,
  'canvas2d.emojiURI': 8,
  'canvasWebgl.extensions': 8,
  'cssMedia.matchMediaCSS': 8,
  'navigator.globalPrivacyControl': 8,
  'workerScope.userAgentData': 8,
  'workerScope.userAgentDataVersion': 8,
  'headless.likeHeadless': 8,
  'headless.likeHeadlessRating': 8,
  'workerScope.webglRenderer': 8,
  'navigator.oscpu': 8,
  'canvas2d.textMetricsSystemSum': 8,
  'svg.svgrectSystemSum': 8,
  'svg.bBox': 8,
  'workerScope.webglVendor': 8,
  'fonts.emojiSet': 8,
  'svg.emojiSet': 8,
  'clientRects.emojiSet': 8,
  'svg.extentOfChar': 8,
  'svg.subStringLength': 8,
  'svg.computedTextLength': 8,
  'navigator.permissions': 8,
  'media.mimeTypes': 8,
  'canvas2d.mods': 8,
  'maths.data': 8,
  'canvas2d.emojiSet': 8,
  'navigator.doNotTrack': 8,
  'consoleErrors.errors': 8,
  'screen.availHeight': 8,
  'cssMedia.screenQuery': 8,
  'screen.width': 8,
  'screen.height': 8,
  'screen.availWidth': 8,
  'canvasWebgl.dataURI': 8,
  'canvasWebgl.dataURI2': 8,
  'navigator.userAgent': 8,
  'navigator.appVersion': 8,
  'workerScope.userAgent': 8,
  'canvasWebgl.parameters': 8,
  'workerScope.gpu': 8,
  'navigator.userAgentData': 8,

  // TIER 2 (weight=4): Good stability and discrimination
  'workerScope.userAgentEngine': 4,
  'canvasWebgl.gpu': 4,
  'navigator.hardwareConcurrency': 4,
  'navigator.plugins': 4,
  'navigator.vendor': 4,
  'windowFeatures.moz': 4,
  'windowFeatures.webkit': 4,
  'headless.chromium': 4,
  'headless.systemFonts': 4,
  'headless.platformEstimate': 4,
  'offlineAudioContext.compressorGainReduction': 4,
  'offlineAudioContext.floatFrequencyDataSum': 4,
  'offlineAudioContext.floatTimeDomainDataSum': 4,
  'offlineAudioContext.sampleSum': 4,
  'offlineAudioContext.binsSample': 4,
  'offlineAudioContext.copySample': 4,
  'offlineAudioContext.values': 4,
  'shielding.engine': 4,
  'navigator.platform': 4,
  'workerScope.hardwareConcurrency': 4,
  'workerScope.system': 4,
  'workerScope.device': 4,
  'navigator.mimeTypes': 4,
  'workerScope.platform': 4,
  'clientRects.elementClientRects': 4,
  'clientRects.elementBoundingClientRect': 4,
  'clientRects.rangeClientRects': 4,
  'clientRects.rangeBoundingClientRect': 4,
  'fonts.fontFaceLoadFonts': 4,
  'headless.headless': 4,
  'headless.headlessRating': 4,
  'canvasWebgl.pixels': 4,
  'canvasWebgl.pixels2': 4,
  'workerScope.locale': 4,
  'workerScope.timezoneOffset': 4,
  'trash.trashBin': 4,
  'navigator.system': 4,
  'navigator.device': 4,
  'screen.colorDepth': 4,
  'screen.pixelDepth': 4,
  'navigator.language': 4,
  'workerScope.languages': 4,

  // TIER 3 (weight=2): Moderate usefulness
  'headless.stealth': 2,
  'headless.stealthRating': 2,
  'canvasWebgl.parameterOrExtensionLie': 2,
  'navigator.uaPostReduction': 2,
  'shielding.extensionHashPattern': 2,
  'lies.data': 2,
  'lies.totalLies': 2,
  'timezone.location': 2,
  'timezone.offset': 2,
  'timezone.zone': 2,

  // TIER 4 (weight=1): Lower usefulness but still contributory
  'navigator.deviceMemory': 1,
  'workerScope.deviceMemory': 1,
  'navigator.maxTouchPoints': 1,
  'screen.touch': 1,
  'offlineAudioContext.noise': 1,
  'offlineAudioContext.totalUniqueSamples': 1,
};

// 256-bit SimHash implementation (64 hex chars)
// Increased from 64-bit for finer similarity granularity
const SIMHASH_BITS = 256;

/** Convert accumulated vote array to hex string (positive vote → 1 bit). */
function votesToHex(votes: number[]): string {
  let result = '';
  for (let byteIdx = 0; byteIdx < votes.length / 8; byteIdx++) {
    let byte = 0;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if (votes[byteIdx * 8 + bitIdx] > 0) byte |= 1 << bitIdx;
    }
    result += ('0' + byte.toString(16)).slice(-2);
  }
  return result;
}

/** Accumulate SimHash bit votes from an array of tokens with equal weight. */
function accumulateTokenVotes(tokens: string[]): number[] {
  const votes = new Array(SIMHASH_BITS).fill(0);
  for (const token of tokens) {
    for (let h = 0; h < SIMHASH_BITS / 32; h++) {
      const salt = h === 0 ? token : `${token}:${h}`;
      const bits = parseInt(hashMini(salt), 16) >>> 0;
      for (let b = 0; b < 32; b++) {
        votes[h * 32 + b] += (bits >>> b) & 1 ? 1 : -1;
      }
    }
  }
  return votes;
}

/**
 * Generate a 64-bit SimHash from fingerprint data.
 * Returns a 16-character hex string.
 *
 * @param fp - The loose fingerprint object
 * @param deltaDropped - Keys dropped by delta detection (volatile between runs),
 *                       keyed by module name. These features are excluded from the hash.
 */
const getFuzzyHash = async (
  fp: Record<string, any>,
  deltaDropped?: Record<string, string[]>,
): Promise<string> => {
  // Build set of excluded feature keys from delta report.
  // Delta reports nested paths (e.g., "mods.pixels") but SimHash features
  // reference top-level keys (e.g., "canvas2d.mods"). A sub-key change means
  // the parent object changed, so we add all ancestor paths too.
  const excluded = new Set<string>();
  if (deltaDropped) {
    for (const [module, keys] of Object.entries(deltaDropped)) {
      for (const key of keys) {
        excluded.add(`${module}.${key}`);
        // Add ancestor paths: "mods.pixels" → also exclude "mods"
        const parts = key.split('.');
        for (let i = 1; i < parts.length; i++) {
          excluded.add(`${module}.${parts.slice(0, i).join('.')}`);
        }
      }
    }
  }

  // Extract all features from fingerprint
  const features: Record<string, unknown> = {};
  for (const [section, values] of Object.entries(fp)) {
    if (typeof values !== 'object' || values === null) continue;
    for (const [key, value] of Object.entries(
      values as Record<string, unknown>,
    )) {
      if (key === '$hash' || key === 'lied') continue;
      features[`${section}.${key}`] = value;
    }
  }

  // Initialize vote accumulator for each bit position
  const votes = new Array(SIMHASH_BITS).fill(0);

  // Process each weighted feature
  for (const [featureKey, weight] of Object.entries(SIMHASH_FEATURE_WEIGHTS)) {
    if (excluded.has(featureKey)) continue;
    const value = features[featureKey];
    if (value === undefined || value === null) continue;

    // Hash the feature key+value to get deterministic bit pattern
    const featureString = getPristineRefs().stringify({
      k: featureKey,
      v: value,
    });

    // Generate enough bits by chaining hashMini calls
    for (let h = 0; h < SIMHASH_BITS / 32; h++) {
      const salt = h === 0 ? featureString : `${featureString}:${h}`;
      const bits = parseInt(hashMini(salt), 16) >>> 0;
      for (let b = 0; b < 32; b++) {
        const bitValue = (bits >>> b) & 1;
        votes[h * 32 + b] += bitValue ? weight : -weight;
      }
    }
  }

  return votesToHex(votes);
};

/**
 * Calculate Hamming distance between two SimHash values.
 * Lower distance = more similar fingerprints.
 *
 * @param hash1 - First SimHash hex string
 * @param hash2 - Second SimHash hex string (must be same length as hash1)
 * @returns Number of differing bits (0 to hash length * 4)
 */
const getSimHashDistance = (hash1: string, hash2: string): number => {
  if (hash1.length !== hash2.length || hash1.length % 2 !== 0) {
    throw new Error('SimHash values must be equal-length hex strings');
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i += 2) {
    const byte1 = parseInt(hash1.slice(i, i + 2), 16);
    const byte2 = parseInt(hash2.slice(i, i + 2), 16);
    const xor = byte1 ^ byte2;
    // Count set bits (popcount)
    distance += popcount8(xor);
  }
  return distance;
};

/** Counts the number of set bits (population count) in an 8-bit number. */
const popcount8 = (n: number): number => {
  n = n - ((n >> 1) & 0x55);
  n = (n & 0x33) + ((n >> 2) & 0x33);
  return (n + (n >> 4)) & 0x0f;
};

/**
 * Computes a SimHash for any JSON-serializable value.
 * Similar inputs produce similar hashes (low hamming distance).
 *
 * Approach: JSON.stringify, strip syntax chars (keep colons for structure),
 * then n-gram simhash. Simple and effective for structured data.
 *
 * @param x - Any JSON-serializable value
 * @returns Hex string (SIMHASH_BITS / 4 characters)
 */
const simhashify = (x: unknown): string => {
  // Strip JSON syntax, keep colons for key:value structure
  const stripped = getPristineRefs()
    .stringify(x)
    .replace(/[{}\[\]",]/g, '');

  const NGRAM_SIZE = 3;

  // Sliding window n-grams
  // For very short strings, include the whole string as a single token
  const tokens: string[] = [];
  if (stripped.length <= NGRAM_SIZE) {
    if (stripped.length > 0) tokens.push(stripped);
  } else {
    for (let i = 0; i <= stripped.length - NGRAM_SIZE; i++) {
      tokens.push(stripped.slice(i, i + NGRAM_SIZE));
    }
  }

  return votesToHex(accumulateTokenVotes(tokens));
};

/**
 * Computes a SimHash for an array of strings.
 * Similar arrays produce similar hashes (low hamming distance).
 *
 * This is useful for large arrays like windowFeatures.keys (1000+ DOM APIs)
 * where exact matching is too strict but you want to detect similarity.
 *
 * @param arr - Array of strings to hash
 * @returns Hex string (SIMHASH_BITS / 4 characters)
 */
const simHashArray = (arr: string[]): string => {
  return votesToHex(accumulateTokenVotes(arr));
};

/** Result of compacting a large array or string */
interface CompactedValue {
  /** 256-bit SimHash (64 hex chars) for similarity comparison */
  $simhash: string;
  /** Original length - useful for sanity checks (Chrome ~1200, Firefox ~900) */
  $len: number;
}

/**
 * Recursively compacts a fingerprint object by SimHashing large arrays/strings.
 *
 * Large arrays of strings become: { $simhash: "abc123...", $len: 1200 }
 * Large strings become: { $simhash: "def456...", $len: 2000 }
 *
 * Benefits:
 * - Massive size reduction (1200 strings → 1 hash + 1 number)
 * - Preserves similarity (95% array overlap ≈ 3-5 bit hamming distance)
 * - Fast comparison (XOR + popcount vs deep array diff)
 * - Spoofing detection (Chrome with $len=850 is suspicious)
 *
 * @param obj - Object to compact (typically a fingerprint)
 * @param arrayThreshold - Arrays larger than this get SimHashed (default: 50)
 * @param stringThreshold - Strings longer than this get hashed (default: 500)
 * @returns Compacted object with large values replaced by {$simhash, $len}
 */
const compactFingerprint = (
  obj: unknown,
  arrayThreshold = 50,
  stringThreshold = 500,
): unknown => {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    // Only SimHash large arrays of STRINGS (not numbers).
    if (obj.length > arrayThreshold) {
      const allStrings = obj.every((x) => typeof x === 'string');

      if (allStrings) {
        return {
          $simhash: simHashArray(obj as string[]),
          $len: obj.length,
        } as CompactedValue;
      }
    }
    // Recurse into array elements for mixed/object/number arrays
    return obj.map((item) =>
      compactFingerprint(item, arrayThreshold, stringThreshold),
    );
  }

  if (typeof obj === 'string') {
    if (obj.length > stringThreshold) {
      return {
        $simhash: hashMini(obj),
        $len: obj.length,
      } as CompactedValue;
    }
    return obj;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = compactFingerprint(value, arrayThreshold, stringThreshold);
    }
    return result;
  }

  return obj; // primitives pass through
};

export {
  hashMini,
  instanceId,
  hashify,
  simhashify,
  getFuzzyHash,
  getSimHashDistance,
  simHashArray,
  compactFingerprint,
  cipher,
  SIMHASH_FEATURE_WEIGHTS,
  SIMHASH_BITS,
};

export type { CompactedValue };
