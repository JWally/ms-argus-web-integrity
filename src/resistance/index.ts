/**
 * Resistance Detection Module
 *
 * Detects privacy browsers, fingerprint protection modes, and anti-fingerprint extensions.
 * This module provides critical bot/fraud detection signals because:
 *
 * 1. **Privacy Browser Detection**: Identifies Brave, Tor Browser, and Firefox with
 *    resistFingerprinting. These browsers have built-in protection modes that
 *    indicate privacy-conscious users or potential evasion attempts.
 *
 * 2. **Protection Mode Detection**: Determines the active protection level
 *    (standard, strict, safer) which affects fingerprint reliability.
 *
 * 3. **Extension Detection**: Identifies specific anti-fingerprint extensions
 *    (CanvasBlocker, DuckDuckGo, JShelter, etc.) via unique lie signature patterns.
 *
 * 4. **Automation Detection**: Detects puppeteer-extra and FakeBrowser which are
 *    commonly used for bot/scraping operations.
 *
 * ## Detection Techniques
 *
 * ### Timer Precision (Firefox/Tor)
 * Firefox's `privacy.resistFingerprinting` rounds timestamps to reduce precision.
 * By sampling Date.now() over multiple setTimeout delays, we detect if the last
 * digits remain constant (indicating rounding).
 *
 * ### Brave Browser Mode
 * Brave disables certain APIs in each protection mode:
 * - Standard: FileSystemWritableFileStream available
 * - Strict: Serial/ReportingObserver disabled
 *
 * ### Extension Pattern Matching
 * Extensions intercept browser APIs using Proxy or prototype overrides. Our lie
 * detection system (src/lies) fingerprints these interceptions by hashing error
 * patterns. Each extension produces a unique hash signature across multiple APIs.
 *
 * @module resistance
 */

import { captureError } from '../errors';
import { prototypeLies } from '../lies';
import { hashMini } from '../utils/crypto';
import {
  createTimer,
  queueEvent,
  IS_BLINK,
  IS_GECKO,
  braveBrowser,
  getBraveMode,
  logTestResult,
} from '../utils/helpers';
import {
  DISABLED_HASH,
  FIREFOX_PRIVACY_FEATURES,
  TOR_DISABLED_FEATURES,
  TIMER_SAMPLE_COUNT,
} from './constants';
import type {
  ResistanceFingerprint,
  BraveSecurityFeatures,
  FirefoxSecurityFeatures,
  TimerPrecisionResult,
  LieHashValues,
} from './types';

/**
 * Detects timer precision rounding in Firefox/Tor.
 *
 * Firefox's `privacy.resistFingerprinting` setting rounds Date.now() to reduce
 * fingerprinting precision. This function samples timestamps across multiple
 * setTimeout delays and checks if the trailing digits remain constant.
 *
 * ## How It Works
 *
 * 1. Takes 10 timestamp samples with 0-9ms delays
 * 2. Extracts the last digit of each timestamp
 * 3. If all last digits are identical, timer precision is being reduced
 *
 * ## Why This Works
 *
 * Normal timestamps: 1704000000123, 1704000000456, 1704000000789 (varying)
 * Protected timestamps: 1704000000000, 1704000000000, 1704000000000 (rounded)
 *
 * @returns Timer precision detection result
 */
async function getTimerPrecision(): Promise<TimerPrecisionResult> {
  const baseDate = +new Date();
  const baseNumber = +('' + baseDate).slice(-1);

  /** Creates a regex matching trailing repetitions of the given digit. */
  const regex = (n: number) => new RegExp(`${n}+$`);

  /**
   * Samples a timestamp after a given delay and extracts the trailing digit pattern.
   *
   * @param ms - Delay in milliseconds before sampling
   * @param useBaseDate - If true, uses the pre-captured base timestamp instead of a fresh one
   * @returns The matched trailing digit string, or the full timestamp if no pattern matches
   */
  const sample = (
    ms: number,
    useBaseDate?: boolean,
  ): Promise<string | number> =>
    new Promise((resolve) =>
      setTimeout(() => {
        const date = useBaseDate ? baseDate : +new Date();
        const match = regex(baseNumber).exec('' + date);
        const value = match ? match[0] : date;
        resolve(value);
      }, ms),
    );

  // Collect samples across delays 0-9ms
  const samples = await Promise.all([
    sample(0, true),
    sample(1),
    sample(2),
    sample(3),
    sample(4),
    sample(5),
    sample(6),
    sample(7),
    sample(8),
    sample(9),
  ]);

  // Extract last digit of each sample
  const lastChars = samples.map((s) => ('' + s).slice(-1));

  // Check if all last digits are identical (indicates rounding)
  const protection = lastChars.every((char) => char === lastChars[0]);

  const baseLen = ('' + samples[0]).length;

  return {
    protection,
    delays: samples.map((n) =>
      ('' + n).length > baseLen ? ('' + n).slice(-baseLen) : n,
    ),
    precision: protection
      ? Math.min(...samples.map((val) => ('' + val).length))
      : undefined,
    precisionValue: protection ? lastChars[0] : undefined,
  };
}

/**
 * Detects Brave browser security features and protection mode.
 *
 * Brave has three fingerprint protection modes:
 * - **Allow**: All APIs available (FileSystemWritableFileStream present)
 * - **Standard**: Balanced protection (default)
 * - **Strict**: Aggressive blocking (Serial, ReportingObserver disabled)
 *
 * @returns Brave security features object
 */
function detectBraveSecurityFeatures(): BraveSecurityFeatures {
  return {
    FileSystemWritableFileStream: 'FileSystemWritableFileStream' in window,
    Serial: 'Serial' in window,
    ReportingObserver: 'ReportingObserver' in window,
  };
}

/**
 * Detects Firefox privacy features and identifies Tor Browser.
 *
 * When `privacy.resistFingerprinting` is enabled in Firefox (or always in Tor),
 * certain APIs are disabled or return fake values. We probe these features to:
 *
 * 1. Confirm resistFingerprinting is active
 * 2. Distinguish Tor Browser from Firefox
 * 3. Detect "safer" security level in Tor (WebAssembly disabled)
 *
 * ## Tor Browser Indicators
 *
 * Tor Browser additionally disables for WebRTC/device enumeration protection:
 * - RTCRtpTransceiver
 * - MediaDevices
 * - Credential
 *
 * @returns Firefox security features object
 */
function detectFirefoxSecurityFeatures(): FirefoxSecurityFeatures {
  return {
    reduceTimerPrecision: true, // Already confirmed by timer precision check
    OfflineAudioContext: 'OfflineAudioContext' in window,
    WebGL2RenderingContext: 'WebGL2RenderingContext' in window,
    WebAssembly: 'WebAssembly' in window,
    maxTouchPoints: 'maxTouchPoints' in navigator,
    RTCRtpTransceiver: 'RTCRtpTransceiver' in window,
    MediaDevices: 'MediaDevices' in window,
    Credential: 'Credential' in window,
  };
}

/**
 * Determines Firefox/Tor protection mode.
 *
 * @param features - Detected Firefox security features
 * @returns 'resistFingerprinting' | 'standard' | 'safer'
 */
function getFirefoxMode(features: FirefoxSecurityFeatures): string {
  // Check if Tor Browser (specific APIs disabled)
  const isTorBrowser =
    FIREFOX_PRIVACY_FEATURES.filter(
      (key) =>
        TOR_DISABLED_FEATURES.has(key) &&
        !features[key as keyof FirefoxSecurityFeatures],
    ).length === TOR_DISABLED_FEATURES.size;

  if (!isTorBrowser) {
    return 'resistFingerprinting';
  }

  // Tor Browser: check for "safer" mode (WebAssembly disabled)
  return features.WebAssembly ? 'standard' : 'safer';
}

/**
 * Collects lie detection hashes for extension fingerprinting.
 *
 * Each browser API that was detected as tampered gets hashed using hashMini.
 * These hashes form a pattern that identifies specific extensions.
 *
 * @returns Object mapping API names to their lie detection hashes
 */
function collectLieHashes(): LieHashValues {
  return {
    // IFrame content access
    contentDocumentHash: hashMini(
      prototypeLies['HTMLIFrameElement.contentDocument'],
    ),
    contentWindowHash: hashMini(
      prototypeLies['HTMLIFrameElement.contentWindow'],
    ),
    // Document methods
    createElementHash: hashMini(prototypeLies['Document.createElement']),
    getElementByIdHash: hashMini(prototypeLies['Document.getElementById']),
    // Element DOM manipulation
    appendHash: hashMini(prototypeLies['Element.append']),
    insertAdjacentElementHash: hashMini(
      prototypeLies['Element.insertAdjacentElement'],
    ),
    insertAdjacentHTMLHash: hashMini(
      prototypeLies['Element.insertAdjacentHTML'],
    ),
    insertAdjacentTextHash: hashMini(
      prototypeLies['Element.insertAdjacentText'],
    ),
    prependHash: hashMini(prototypeLies['Element.prepend']),
    replaceWithHash: hashMini(prototypeLies['Element.replaceWith']),
    // Node DOM manipulation
    appendChildHash: hashMini(prototypeLies['Node.appendChild']),
    insertBeforeHash: hashMini(prototypeLies['Node.insertBefore']),
    replaceChildHash: hashMini(prototypeLies['Node.replaceChild']),
    // Canvas APIs
    getContextHash: hashMini(prototypeLies['HTMLCanvasElement.getContext']),
    toDataURLHash: hashMini(prototypeLies['HTMLCanvasElement.toDataURL']),
    toBlobHash: hashMini(prototypeLies['HTMLCanvasElement.toBlob']),
    getImageDataHash: hashMini(
      prototypeLies['CanvasRenderingContext2D.getImageData'],
    ),
    // Audio APIs
    getByteFrequencyDataHash: hashMini(
      prototypeLies['AnalyserNode.getByteFrequencyData'],
    ),
    getByteTimeDomainDataHash: hashMini(
      prototypeLies['AnalyserNode.getByteTimeDomainData'],
    ),
    getFloatFrequencyDataHash: hashMini(
      prototypeLies['AnalyserNode.getFloatFrequencyData'],
    ),
    getFloatTimeDomainDataHash: hashMini(
      prototypeLies['AnalyserNode.getFloatTimeDomainData'],
    ),
    copyFromChannelHash: hashMini(prototypeLies['AudioBuffer.copyFromChannel']),
    getChannelDataHash: hashMini(prototypeLies['AudioBuffer.getChannelData']),
    // Hardware
    hardwareConcurrencyHash: hashMini(
      prototypeLies['Navigator.hardwareConcurrency'],
    ),
    // Screen
    availHeightHash: hashMini(prototypeLies['Screen.availHeight']),
    availLeftHash: hashMini(prototypeLies['Screen.availLeft']),
    availTopHash: hashMini(prototypeLies['Screen.availTop']),
    availWidthHash: hashMini(prototypeLies['Screen.availWidth']),
    colorDepthHash: hashMini(prototypeLies['Screen.colorDepth']),
    pixelDepthHash: hashMini(prototypeLies['Screen.pixelDepth']),
  };
}

/**
 * Builds extension hash pattern for output.
 *
 * Strips 'Hash' suffix from keys and excludes disabled features.
 *
 * @param hash - Raw lie hashes
 * @returns Cleaned hash pattern for fingerprint output
 */
function buildExtensionHashPattern(
  hash: LieHashValues,
): Record<string, string> {
  return Object.keys(hash).reduce(
    (acc, key) => {
      const val = hash[key as keyof LieHashValues];
      if (val === DISABLED_HASH) return acc;
      acc[key.replace('Hash', '')] = val;
      return acc;
    },
    {} as Record<string, string>,
  );
}

/**
 * Collects privacy/fingerprint resistance detection data.
 *
 * Detects:
 * - Brave browser and its protection mode (allow/standard/strict)
 * - Firefox with resistFingerprinting
 * - Tor Browser and its security level (standard/safer)
 * - Anti-fingerprint browser extensions
 *
 * @returns Resistance fingerprint data or undefined on error
 */
export default async function getResistance(): Promise<
  ResistanceFingerprint | undefined
> {
  try {
    const timer = createTimer();
    await queueEvent(timer);

    const data: ResistanceFingerprint = {
      privacy: undefined,
      security: undefined,
      mode: undefined,
      extension: undefined,
      engine: IS_BLINK ? 'Blink' : IS_GECKO ? 'Gecko' : '',
    };

    // Run detection in parallel
    const [isBrave, timerPrecision] = await Promise.all([
      braveBrowser(),
      IS_BLINK ? undefined : getTimerPrecision(),
    ]);

    // Brave browser detection
    if (isBrave) {
      const braveMode = getBraveMode();
      data.privacy = 'Brave';
      data.security = detectBraveSecurityFeatures();
      data.mode = braveMode.allow
        ? 'allow'
        : braveMode.standard
          ? 'standard'
          : braveMode.strict
            ? 'strict'
            : '';
    }

    // Firefox/Tor detection (timer precision indicates resistFingerprinting)
    const { protection } = timerPrecision || {};
    if (IS_GECKO && protection) {
      const features = detectFirefoxSecurityFeatures();

      // Check if Tor Browser (specific APIs disabled)
      const isTorBrowser =
        FIREFOX_PRIVACY_FEATURES.filter(
          (key) =>
            TOR_DISABLED_FEATURES.has(key) &&
            !features[key as keyof FirefoxSecurityFeatures],
        ).length === TOR_DISABLED_FEATURES.size;

      data.privacy = isTorBrowser ? 'Tor Browser' : 'Firefox';
      data.security = features;
      data.mode = getFirefoxMode(features);
    }

    // Collect lie hashes for server-side extension detection
    // NOTE: Extension identification moved server-side. See TODO-server-side-analysis.md
    await queueEvent(timer);
    const hash = collectLieHashes();

    data.extensionHashPattern = buildExtensionHashPattern(hash);
    // data.extension is now computed server-side from extensionHashPattern

    logTestResult({ time: timer.stop(), test: 'resistance', passed: true });
    return data;
  } catch (error) {
    logTestResult({ test: 'resistance', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
