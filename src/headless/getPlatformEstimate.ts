/**
 * Platform Estimation via Feature Detection
 *
 * Estimates the operating system by checking for platform-specific
 * browser APIs and features. This cross-references with the reported
 * user agent to detect inconsistencies.
 *
 * The technique works because different platforms have different APIs:
 *
 * **Android-only features:**
 * - BarcodeDetector (v88+)
 * - ContentIndex (v84+)
 * - ContactsManager (v80+)
 * - downlinkMax in NetworkInformation
 * - No SharedWorker
 * - Touch events always present
 *
 * **Desktop-only features (Windows/Mac/Linux):**
 * - EyeDropper (v95+)
 * - FileSystemWritableFileStream (v86+)
 * - HID/SerialPort (v89+)
 * - SharedWorker
 * - App Badge API (v81+, Windows/Mac)
 *
 * **Chrome OS features:**
 * - BarcodeDetector (like Android)
 * - All desktop APIs
 * - downlinkMax (like Android)
 *
 * A mismatch between detected platform and reported UA indicates spoofing.
 */

import { IS_BLINK } from '../utils/helpers';
import { Platform } from './constants';

/**
 * Result type for platform estimation.
 *
 * Returns either an empty array (non-Blink browsers) or a tuple containing:
 * - scores: Confidence score (0-1) for each platform
 * - highestScore: The maximum confidence score achieved
 * - headlessEstimate: Signals that suggest headless operation
 */
type PlatformEstimateResult =
  | [
      scores: Record<string, number>,
      highestScore: number,
      headlessEstimate: Record<string, boolean>,
    ]
  | [];

/**
 * Checks if an API exists on a given prototype.
 *
 * @param proto - The prototype to check
 * @param prop - The property name to look for
 * @returns True if the property exists
 */
function hasPrototypeProperty(proto: object, prop: string): boolean {
  return prop in proto;
}

/**
 * Conditionally includes a feature check based on browser version.
 *
 * If the version check passes, returns [condition], otherwise returns [].
 * This allows building arrays where features are only checked when the
 * browser version supports them.
 *
 * @param version - Whether the browser version supports this feature
 * @param condition - The feature check result
 * @returns Array with condition if version passes, empty array otherwise
 */
function hasFeature(version: boolean, condition: boolean): boolean[] {
  return version ? [condition] : [];
}

/**
 * Detects Chrome version capabilities.
 *
 * Uses CSS.supports() and prototype checks to determine minimum Chrome version.
 * This is more reliable than UA parsing because these features cannot be
 * trivially spoofed.
 *
 * @returns Object with boolean flags for each Chrome version
 */
function detectChromeVersion(): Record<string, boolean> {
  return {
    v80: hasPrototypeProperty(
      HTMLVideoElement.prototype,
      'getVideoPlaybackQuality',
    ),
    v81: CSS.supports('color-scheme: initial'),
    v84: CSS.supports('appearance: initial'),
    v86: 'DisplayNames' in Intl,
    v88: CSS.supports('aspect-ratio: initial'),
    v89: CSS.supports('border-end-end-radius: initial'),
    v95: hasPrototypeProperty(Crypto.prototype, 'randomUUID'),
  };
}

/**
 * Detects platform-specific APIs.
 *
 * @returns Object with boolean flags for each platform-specific feature
 */
function detectPlatformFeatures(): Record<string, boolean> {
  return {
    hasBarcodeDetector: 'BarcodeDetector' in window,
    hasDownlinkMax:
      'downlinkMax' in
      // @ts-expect-error NetworkInformation may not be defined
      ((window.NetworkInformation?.prototype as object) || {}),
    hasContentIndex: 'ContentIndex' in window,
    hasContactsManager: 'ContactsManager' in window,
    hasEyeDropper: 'EyeDropper' in window,
    hasFileSystemWritableFileStream: 'FileSystemWritableFileStream' in window,
    hasHid: 'HID' in window && 'HIDDevice' in window,
    hasSerialPort: 'SerialPort' in window && 'Serial' in window,
    hasSharedWorker: 'SharedWorker' in window,
    hasTouch: 'ontouchstart' in window && 'TouchEvent' in window,
    hasAppBadge: hasPrototypeProperty(Navigator.prototype, 'setAppBadge'),
  };
}

/**
 * Builds expected feature matrix for each platform.
 *
 * Each platform has a list of expected feature states. The list is built
 * conditionally based on Chrome version to avoid false positives on older
 * browsers where the feature didn't exist yet.
 *
 * @param version - Chrome version detection results
 * @param features - Platform feature detection results
 * @returns Object mapping platform names to expected feature arrays
 */
function buildPlatformExpectations(
  version: Record<string, boolean>,
  features: Record<string, boolean>,
): Record<string, boolean[]> {
  const {
    hasBarcodeDetector,
    hasDownlinkMax,
    hasContentIndex,
    hasContactsManager,
    hasEyeDropper,
    hasFileSystemWritableFileStream,
    hasHid,
    hasSerialPort,
    hasSharedWorker,
    hasTouch,
    hasAppBadge,
  } = features;

  return {
    // Android: Has mobile-specific APIs, no desktop APIs
    [Platform.ANDROID]: [
      ...hasFeature(version.v88, hasBarcodeDetector), // Android has BarcodeDetector
      ...hasFeature(version.v84, hasContentIndex), // Android has ContentIndex
      ...hasFeature(version.v80, hasContactsManager), // Android has ContactsManager
      hasDownlinkMax, // Android has downlinkMax
      ...hasFeature(version.v95, !hasEyeDropper), // Android lacks EyeDropper
      ...hasFeature(version.v86, !hasFileSystemWritableFileStream), // Android lacks FileSystem
      ...hasFeature(version.v89, !hasHid), // Android lacks HID
      ...hasFeature(version.v89, !hasSerialPort), // Android lacks SerialPort
      !hasSharedWorker, // Android lacks SharedWorker
      hasTouch, // Android always has touch
      ...hasFeature(version.v81, !hasAppBadge), // Android lacks AppBadge
    ],

    // Chrome OS: Desktop APIs + mobile APIs (hybrid)
    [Platform.CHROME_OS]: [
      ...hasFeature(version.v88, hasBarcodeDetector), // Chrome OS has BarcodeDetector
      ...hasFeature(version.v84, !hasContentIndex), // Chrome OS lacks ContentIndex
      ...hasFeature(version.v80, !hasContactsManager), // Chrome OS lacks ContactsManager
      hasDownlinkMax, // Chrome OS has downlinkMax
      ...hasFeature(version.v95, hasEyeDropper), // Chrome OS has EyeDropper
      ...hasFeature(version.v86, hasFileSystemWritableFileStream), // Chrome OS has FileSystem
      ...hasFeature(version.v89, hasHid), // Chrome OS has HID
      ...hasFeature(version.v89, hasSerialPort), // Chrome OS has SerialPort
      hasSharedWorker, // Chrome OS has SharedWorker
      hasTouch || !hasTouch, // Chrome OS may or may not have touch
      ...hasFeature(version.v81, !hasAppBadge), // Chrome OS lacks AppBadge
    ],

    // Windows: Desktop APIs, no mobile APIs
    [Platform.WINDOWS]: [
      ...hasFeature(version.v88, !hasBarcodeDetector), // Windows lacks BarcodeDetector
      ...hasFeature(version.v84, !hasContentIndex), // Windows lacks ContentIndex
      ...hasFeature(version.v80, !hasContactsManager), // Windows lacks ContactsManager
      !hasDownlinkMax, // Windows lacks downlinkMax
      ...hasFeature(version.v95, hasEyeDropper), // Windows has EyeDropper
      ...hasFeature(version.v86, hasFileSystemWritableFileStream), // Windows has FileSystem
      ...hasFeature(version.v89, hasHid), // Windows has HID
      ...hasFeature(version.v89, hasSerialPort), // Windows has SerialPort
      hasSharedWorker, // Windows has SharedWorker
      hasTouch || !hasTouch, // Windows may or may not have touch
      ...hasFeature(version.v81, hasAppBadge), // Windows has AppBadge
    ],

    // macOS: Desktop APIs, no mobile APIs
    [Platform.MAC]: [
      ...hasFeature(version.v88, hasBarcodeDetector), // Mac has BarcodeDetector (Ventura+)
      ...hasFeature(version.v84, !hasContentIndex), // Mac lacks ContentIndex
      ...hasFeature(version.v80, !hasContactsManager), // Mac lacks ContactsManager
      !hasDownlinkMax, // Mac lacks downlinkMax
      ...hasFeature(version.v95, hasEyeDropper), // Mac has EyeDropper
      ...hasFeature(version.v86, hasFileSystemWritableFileStream), // Mac has FileSystem
      ...hasFeature(version.v89, hasHid), // Mac has HID
      ...hasFeature(version.v89, hasSerialPort), // Mac has SerialPort
      hasSharedWorker, // Mac has SharedWorker
      !hasTouch, // Mac never has touch (except Touch Bar, not detected)
      ...hasFeature(version.v81, hasAppBadge), // Mac has AppBadge
    ],

    // Linux: Desktop APIs, no mobile APIs, no AppBadge
    [Platform.LINUX]: [
      ...hasFeature(version.v88, !hasBarcodeDetector), // Linux lacks BarcodeDetector
      ...hasFeature(version.v84, !hasContentIndex), // Linux lacks ContentIndex
      ...hasFeature(version.v80, !hasContactsManager), // Linux lacks ContactsManager
      !hasDownlinkMax, // Linux lacks downlinkMax
      ...hasFeature(version.v95, hasEyeDropper), // Linux has EyeDropper
      ...hasFeature(version.v86, hasFileSystemWritableFileStream), // Linux has FileSystem
      ...hasFeature(version.v89, hasHid), // Linux has HID
      ...hasFeature(version.v89, hasSerialPort), // Linux has SerialPort
      hasSharedWorker, // Linux has SharedWorker
      !hasTouch || !hasTouch, // Linux typically no touch (always true = ignore)
      ...hasFeature(version.v81, !hasAppBadge), // Linux lacks AppBadge
    ],
  };
}

/**
 * Calculates confidence scores for each platform.
 *
 * For each platform, counts how many expected features match and
 * divides by total features to get a 0-1 confidence score.
 *
 * @param estimates - Platform expectations matrix
 * @returns Object mapping platform names to confidence scores
 */
function calculateScores(
  estimates: Record<string, boolean[]>,
): Record<string, number> {
  return Object.keys(estimates).reduce(
    (acc, key) => {
      const list = estimates[key];
      const score = +(list.filter((x) => x).length / list.length).toFixed(2);
      acc[key] = score;
      return acc;
    },
    {} as Record<string, number>,
  );
}

/**
 * Estimates the operating system platform via feature detection.
 *
 * Uses the presence/absence of platform-specific browser APIs to
 * determine which OS the browser is running on. This is cross-referenced
 * with the user agent to detect spoofing.
 *
 * The function returns three pieces of data:
 * 1. Confidence scores for each platform (0-1)
 * 2. The highest confidence score
 * 3. Headless estimation signals (missing APIs that suggest headless)
 *
 * @returns Tuple of [scores, highestScore, headlessEstimate] or empty array for non-Blink
 */
export default function getPlatformEstimate(): PlatformEstimateResult {
  // Only works for Chromium-based browsers
  if (!IS_BLINK) return [];

  // Detect Chrome version and platform features
  const version = detectChromeVersion();
  const features = detectPlatformFeatures();

  // Build expected features for each platform
  const estimates = buildPlatformExpectations(version, features);

  // Calculate confidence scores
  const scores = calculateScores(estimates);

  // Find highest scoring platform
  const platform = Object.keys(scores).reduce((a, b) =>
    scores[a] > scores[b] ? a : b,
  );
  const highestScore = scores[platform];

  // Headless signals: APIs that should exist but don't
  // These are commonly missing in headless configurations
  const headlessEstimate: Record<string, boolean> = {
    // ContentIndex should exist in Chrome 84+ on Android
    noContentIndex: version.v84 && !features.hasContentIndex,
    // ContactsManager should exist in Chrome 80+ on Android
    noContactsManager: version.v80 && !features.hasContactsManager,
    // downlinkMax should exist on Android/Chrome OS
    noDownlinkMax: !features.hasDownlinkMax,
  };

  return [scores, highestScore, headlessEstimate];
}
