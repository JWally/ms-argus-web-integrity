/**
 * Internal Inconsistencies Detection Module
 *
 * Cross-validates fingerprint signals from different sources to detect
 * tampering, spoofing, or configuration anomalies.
 *
 * Unlike "lies" which detect API tampering, inconsistencies detect
 * logical contradictions between different data sources that should agree.
 *
 * Examples:
 * - Navigator says "Windows" but fonts are macOS-specific
 * - Screen API reports 1920x1080 but CSS media queries say 1366x768
 * - Worker reports different hardware specs than main thread
 * - Timezone offset doesn't match reported timezone location
 *
 * @module inconsistencies
 */

import { hashMini } from '../utils/crypto';
import {
  getOSFromUserAgent,
  getOSFromPlatform,
  osCompatible,
} from '../utils/platform';

/**
 * Severity levels for inconsistencies.
 * - critical: Strong evidence of spoofing (e.g., completely wrong OS)
 * - high: Likely spoofing or broken configuration
 * - medium: Suspicious but could be edge case
 * - low: Minor discrepancy, possibly legitimate
 */
export type InconsistencySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single detected inconsistency.
 */
export interface Inconsistency {
  /** Category of the inconsistency */
  category: string;
  /** Human-readable description */
  description: string;
  /** Expected value or state */
  expected: string;
  /** Actual value or state found */
  actual: string;
  /** Severity level */
  severity: InconsistencySeverity;
}

/**
 * Result of inconsistency analysis.
 */
export interface InconsistencyResult {
  /** List of detected inconsistencies */
  inconsistencies: Inconsistency[];
  /** Count by severity */
  counts: Record<InconsistencySeverity, number>;
  /** Overall risk score (0-100) */
  riskScore: number;
  /** Hash of all inconsistencies for fingerprinting */
  $hash: string;
}

/**
 * Platform identifiers extracted from various sources.
 */
interface PlatformSignals {
  navigatorPlatform?: string;
  userAgent?: string;
  userAgentPlatform?: string;
  workerPlatform?: string;
  fontOS?: string;
  cssOS?: string;
}

/**
 * Checks platform/OS consistency across sources.
 */
function checkPlatformConsistency(
  signals: PlatformSignals,
  inconsistencies: Inconsistency[],
): void {
  const {
    navigatorPlatform,
    userAgent,
    userAgentPlatform,
    workerPlatform,
    fontOS,
  } = signals;

  const uaOS = userAgent ? getOSFromUserAgent(userAgent) : 'unknown';
  const platOS = navigatorPlatform
    ? getOSFromPlatform(navigatorPlatform)
    : 'unknown';
  const uaDataOS = userAgentPlatform?.toLowerCase() || 'unknown';
  const workerOS = workerPlatform
    ? getOSFromPlatform(workerPlatform)
    : 'unknown';

  // Check UA vs navigator.platform
  if (
    uaOS !== 'unknown' &&
    platOS !== 'unknown' &&
    !osCompatible(uaOS, platOS)
  ) {
    inconsistencies.push({
      category: 'platform',
      description: 'User agent OS does not match navigator.platform',
      expected: `User-Agent says ${uaOS}`,
      actual: `Platform says ${platOS}`,
      severity: 'critical',
    });
  }

  // Check main thread vs worker platform
  if (platOS !== 'unknown' && workerOS !== 'unknown' && platOS !== workerOS) {
    inconsistencies.push({
      category: 'platform',
      description: 'Main thread platform differs from worker',
      expected: `Main: ${navigatorPlatform}`,
      actual: `Worker: ${workerPlatform}`,
      severity: 'high',
    });
  }

  // Check fonts vs reported OS
  if (
    fontOS &&
    uaOS !== 'unknown' &&
    !osCompatible(fontOS.toLowerCase(), uaOS)
  ) {
    inconsistencies.push({
      category: 'fonts',
      description: 'Detected fonts do not match reported OS',
      expected: `Fonts indicate ${fontOS}`,
      actual: `User-Agent says ${uaOS}`,
      severity: 'critical',
    });
  }

  // Check userAgentData platform
  if (
    uaDataOS !== 'unknown' &&
    uaOS !== 'unknown' &&
    !osCompatible(uaDataOS, uaOS)
  ) {
    inconsistencies.push({
      category: 'platform',
      description: 'userAgentData.platform does not match User-Agent',
      expected: `UA-CH says ${uaDataOS}`,
      actual: `UA string says ${uaOS}`,
      severity: 'high',
    });
  }
}

/**
 * Checks screen dimension consistency.
 */
function checkScreenConsistency(
  screenData: {
    width?: number;
    height?: number;
    availWidth?: number;
    availHeight?: number;
    cssWidth?: number;
    cssHeight?: number;
    matchMediaValid?: boolean;
  },
  inconsistencies: Inconsistency[],
): void {
  const {
    width,
    height,
    availWidth,
    availHeight,
    cssWidth,
    cssHeight,
    matchMediaValid,
  } = screenData;

  // Screen API vs CSS media queries
  if (cssWidth && cssHeight && width && height) {
    if (cssWidth !== width || cssHeight !== height) {
      inconsistencies.push({
        category: 'screen',
        description: 'Screen API dimensions differ from CSS media queries',
        expected: `Screen API: ${width}x${height}`,
        actual: `CSS: ${cssWidth}x${cssHeight}`,
        severity: 'high',
      });
    }
  }

  // matchMedia validation failed
  if (matchMediaValid === false) {
    inconsistencies.push({
      category: 'screen',
      description: 'matchMedia validation of screen dimensions failed',
      expected: 'matchMedia should confirm screen dimensions',
      actual: 'matchMedia returned false for reported dimensions',
      severity: 'high',
    });
  }

  // Available size should be <= total size
  if (availWidth && width && availWidth > width) {
    inconsistencies.push({
      category: 'screen',
      description: 'Available width exceeds total screen width',
      expected: `availWidth <= width`,
      actual: `${availWidth} > ${width}`,
      severity: 'medium',
    });
  }

  if (availHeight && height && availHeight > height) {
    inconsistencies.push({
      category: 'screen',
      description: 'Available height exceeds total screen height',
      expected: `availHeight <= height`,
      actual: `${availHeight} > ${height}`,
      severity: 'medium',
    });
  }
}

/**
 * Checks hardware specs consistency between main thread and worker.
 */
function checkHardwareConsistency(
  mainThread: { deviceMemory?: number; hardwareConcurrency?: number },
  worker: { deviceMemory?: number; hardwareConcurrency?: number },
  inconsistencies: Inconsistency[],
): void {
  const { deviceMemory: mainMem, hardwareConcurrency: mainCores } = mainThread;
  const { deviceMemory: workerMem, hardwareConcurrency: workerCores } = worker;

  if (
    mainMem !== undefined &&
    workerMem !== undefined &&
    mainMem !== workerMem
  ) {
    inconsistencies.push({
      category: 'hardware',
      description: 'Device memory differs between main thread and worker',
      expected: `Main: ${mainMem}GB`,
      actual: `Worker: ${workerMem}GB`,
      severity: 'high',
    });
  }

  if (
    mainCores !== undefined &&
    workerCores !== undefined &&
    mainCores !== workerCores
  ) {
    inconsistencies.push({
      category: 'hardware',
      description:
        'Hardware concurrency differs between main thread and worker',
      expected: `Main: ${mainCores} cores`,
      actual: `Worker: ${workerCores} cores`,
      severity: 'high',
    });
  }

  // Check for suspicious values
  if (mainMem !== undefined && ![0.25, 0.5, 1, 2, 4, 8].includes(mainMem)) {
    inconsistencies.push({
      category: 'hardware',
      description: 'Device memory is not a standard value',
      expected: 'One of: 0.25, 0.5, 1, 2, 4, 8',
      actual: String(mainMem),
      severity: 'medium',
    });
  }
}

/**
 * Normalizes timezone location string for comparison.
 * Handles variations like "America, Chicago" vs "America/Chicago"
 */
function normalizeTimezoneLocation(loc: string): string {
  if (!loc) return '';
  // Replace comma+space with slash (some implementations format differently)
  // Also trim and lowercase for comparison
  return loc.replace(/,\s*/g, '/').toLowerCase().trim();
}

/**
 * Checks timezone consistency.
 * Note: locationMeasured validation moved to server-side.
 */
function checkTimezoneConsistency(
  timezoneData: {
    offset?: number;
    offsetComputed?: number;
    location?: string;
    zone?: string;
    workerOffset?: number;
    workerLocation?: string;
  },
  inconsistencies: Inconsistency[],
): void {
  const { offset, offsetComputed, location, workerOffset, workerLocation } =
    timezoneData;

  // Offset computation mismatch (cross-validation of two methods)
  if (
    offset !== undefined &&
    offsetComputed !== undefined &&
    offset !== offsetComputed
  ) {
    inconsistencies.push({
      category: 'timezone',
      description: 'Timezone offset computed differently by two methods',
      expected: `Direct: ${offset}`,
      actual: `Computed: ${offsetComputed}`,
      severity: 'medium',
    });
  }

  // Main thread vs worker timezone - only check offset, location format may vary
  // Worker offset of 0 when main has real offset could be a detection bug, not spoofing
  if (
    offset !== undefined &&
    workerOffset !== undefined &&
    offset !== workerOffset &&
    workerOffset !== 0
  ) {
    inconsistencies.push({
      category: 'timezone',
      description: 'Timezone offset differs between main thread and worker',
      expected: `Main: ${offset}`,
      actual: `Worker: ${workerOffset}`,
      severity: 'high',
    });
  }

  // Compare normalized timezone locations (main vs worker)
  const normLocation = normalizeTimezoneLocation(location || '');
  const normWorkerLocation = normalizeTimezoneLocation(workerLocation || '');
  if (
    normLocation &&
    normWorkerLocation &&
    normLocation !== normWorkerLocation
  ) {
    inconsistencies.push({
      category: 'timezone',
      description: 'Timezone location differs between main thread and worker',
      expected: `Main: ${location}`,
      actual: `Worker: ${workerLocation}`,
      severity: 'high',
    });
  }
}

/**
 * Extracts the primary language code from a potentially formatted string.
 * Handles formats like "en-US", "en-US (en-US)", "en-US, en", etc.
 */
function extractPrimaryLanguage(lang: string): string {
  if (!lang) return '';
  // Remove anything in parentheses and trim
  let clean = lang.replace(/\s*\([^)]*\)/g, '').trim();
  // Take first comma-separated value
  clean = clean.split(',')[0].trim();
  // Return the language code (e.g., "en-US" or "en")
  return clean.toLowerCase();
}

/**
 * Checks language/locale consistency.
 */
function checkLanguageConsistency(
  languageData: {
    navigatorLanguage?: string;
    navigatorLanguages?: string[];
    workerLanguage?: string;
    workerLanguages?: string[];
    intlLocale?: string;
  },
  inconsistencies: Inconsistency[],
): void {
  const {
    navigatorLanguage,
    navigatorLanguages,
    workerLanguage,
    workerLanguages,
    intlLocale,
  } = languageData;

  // navigator.language should be first in navigator.languages
  if (navigatorLanguage && navigatorLanguages?.length) {
    const navLangClean = extractPrimaryLanguage(navigatorLanguage);
    const firstLangClean = extractPrimaryLanguage(navigatorLanguages[0]);
    if (firstLangClean !== navLangClean) {
      inconsistencies.push({
        category: 'language',
        description: 'navigator.language is not first in navigator.languages',
        expected: `First language: ${navigatorLanguage}`,
        actual: `Array starts with: ${navigatorLanguages[0]}`,
        severity: 'medium',
      });
    }
  }

  // Main thread vs worker - compare normalized primary language
  const mainLang = extractPrimaryLanguage(navigatorLanguage || '');
  const workerLang = extractPrimaryLanguage(workerLanguage || '');
  if (mainLang && workerLang && mainLang !== workerLang) {
    inconsistencies.push({
      category: 'language',
      description: 'Language differs between main thread and worker',
      expected: `Main: ${navigatorLanguage}`,
      actual: `Worker: ${workerLanguage}`,
      severity: 'high',
    });
  }

  // Intl locale should match navigator.language
  if (intlLocale && navigatorLanguage) {
    const intlBase = intlLocale.split('-')[0].toLowerCase();
    const navBase = navigatorLanguage.split('-')[0].toLowerCase();
    if (intlBase !== navBase) {
      inconsistencies.push({
        category: 'language',
        description: 'Intl locale does not match navigator.language',
        expected: `Navigator: ${navigatorLanguage}`,
        actual: `Intl: ${intlLocale}`,
        severity: 'medium',
      });
    }
  }
}

/**
 * Checks GPU/WebGL consistency.
 */
function checkGPUConsistency(
  gpuData: {
    webglRenderer?: string;
    webglVendor?: string;
    workerWebglRenderer?: string;
    workerWebglVendor?: string;
    webgpuVendor?: string;
    webgpuArchitecture?: string;
  },
  inconsistencies: Inconsistency[],
): void {
  const {
    webglRenderer,
    webglVendor,
    workerWebglRenderer,
    workerWebglVendor,
    webgpuVendor,
  } = gpuData;

  // Main thread vs worker WebGL
  if (
    webglRenderer &&
    workerWebglRenderer &&
    webglRenderer !== workerWebglRenderer
  ) {
    inconsistencies.push({
      category: 'gpu',
      description: 'WebGL renderer differs between main thread and worker',
      expected: `Main: ${webglRenderer}`,
      actual: `Worker: ${workerWebglRenderer}`,
      severity: 'critical',
    });
  }

  if (webglVendor && workerWebglVendor && webglVendor !== workerWebglVendor) {
    inconsistencies.push({
      category: 'gpu',
      description: 'WebGL vendor differs between main thread and worker',
      expected: `Main: ${webglVendor}`,
      actual: `Worker: ${workerWebglVendor}`,
      severity: 'critical',
    });
  }

  // WebGL vs WebGPU vendor
  if (webglVendor && webgpuVendor) {
    const webglVendorLower = webglVendor.toLowerCase();
    const webgpuVendorLower = webgpuVendor.toLowerCase();

    // Simple check - vendors should be related
    const vendorMap: Record<string, string[]> = {
      nvidia: ['nvidia'],
      amd: ['amd', 'ati', 'radeon'],
      intel: ['intel'],
      apple: ['apple'],
      google: ['google', 'swiftshader'],
      arm: ['arm', 'mali'],
      qualcomm: ['qualcomm', 'adreno'],
    };

    let matches = false;
    for (const [, aliases] of Object.entries(vendorMap)) {
      const webglMatch = aliases.some((a) => webglVendorLower.includes(a));
      const webgpuMatch = aliases.some((a) => webgpuVendorLower.includes(a));
      if (webglMatch && webgpuMatch) {
        matches = true;
        break;
      }
    }

    if (!matches && webgpuVendorLower !== 'unknown') {
      inconsistencies.push({
        category: 'gpu',
        description: 'WebGL vendor does not match WebGPU vendor',
        expected: `WebGL: ${webglVendor}`,
        actual: `WebGPU: ${webgpuVendor}`,
        severity: 'medium',
      });
    }
  }
}

/**
 * Checks UA-CH (User-Agent Client Hints) consistency with other signals.
 */
function checkUACHConsistency(
  uachData: {
    architecture?: string;
    bitness?: string;
    mobile?: boolean;
    model?: string;
    platform?: string;
    platformVersion?: string;
  },
  otherSignals: {
    navigatorPlatform?: string;
    webglRenderer?: string;
    maxTouchPoints?: number;
    screenWidth?: number;
    screenHeight?: number;
    userAgent?: string;
  },
  inconsistencies: Inconsistency[],
): void {
  const { architecture, bitness, mobile, model, platform } = uachData;
  const {
    navigatorPlatform,
    webglRenderer,
    maxTouchPoints,
    screenWidth,
    screenHeight,
    userAgent,
  } = otherSignals;

  // Architecture vs WebGL renderer
  if (architecture && webglRenderer) {
    const archLower = architecture.toLowerCase();
    const rendererLower = webglRenderer.toLowerCase();

    // Check for architecture mismatches
    const isArmArch = archLower.includes('arm') || archLower === 'aarch64';
    const isX86Arch =
      archLower.includes('x86') || archLower === 'x64' || archLower === 'amd64';

    // WebGL renderer patterns that indicate architecture
    const rendererIndicatesArm =
      rendererLower.includes('mali') ||
      rendererLower.includes('adreno') ||
      rendererLower.includes('apple m') ||
      rendererLower.includes('apple gpu') ||
      rendererLower.includes('powervr');

    const rendererIndicatesX86 =
      rendererLower.includes('geforce') ||
      rendererLower.includes('radeon') ||
      rendererLower.includes('intel') ||
      rendererLower.includes('nvidia') ||
      rendererLower.includes('amd');

    // Apple Silicon Macs can have either arm or x86 (via Rosetta)
    const isAppleSilicon =
      rendererLower.includes('apple m') || rendererLower.includes('apple gpu');

    if (isArmArch && rendererIndicatesX86 && !isAppleSilicon) {
      inconsistencies.push({
        category: 'ua-ch',
        description:
          'UA-CH architecture (ARM) conflicts with WebGL renderer (x86)',
        expected: `Architecture: ${architecture}`,
        actual: `WebGL renderer: ${webglRenderer}`,
        severity: 'high',
      });
    }

    if (isX86Arch && rendererIndicatesArm && !isAppleSilicon) {
      inconsistencies.push({
        category: 'ua-ch',
        description:
          'UA-CH architecture (x86) conflicts with WebGL renderer (ARM)',
        expected: `Architecture: ${architecture}`,
        actual: `WebGL renderer: ${webglRenderer}`,
        severity: 'high',
      });
    }
  }

  // Bitness vs platform strings
  // Note: Windows always reports "Win32" regardless of 64-bit, so we can only
  // check for explicit 64-bit indicators in the platform string
  if (bitness && navigatorPlatform) {
    const platLower = navigatorPlatform.toLowerCase();

    // Only flag if platform explicitly indicates 64-bit but UA-CH says 32
    const platformExplicitly64 =
      platLower.includes('x86_64') ||
      platLower.includes('x64') ||
      platLower.includes('amd64') ||
      platLower.includes('arm64') ||
      platLower.includes('aarch64');

    if (bitness === '32' && platformExplicitly64) {
      inconsistencies.push({
        category: 'ua-ch',
        description:
          'UA-CH bitness (32) conflicts with navigator.platform (64-bit)',
        expected: `Bitness: ${bitness}`,
        actual: `Platform: ${navigatorPlatform}`,
        severity: 'medium',
      });
    }

    // Note: 32-bit browser on 64-bit OS is common, and Win32 is used on 64-bit Windows
  }

  // Mobile flag vs touch and screen
  if (mobile !== undefined) {
    const hasTouch = maxTouchPoints !== undefined && maxTouchPoints > 0;
    const hasSmallScreen =
      screenWidth !== undefined &&
      screenHeight !== undefined &&
      Math.min(screenWidth, screenHeight) < 768;
    const hasMobileUA =
      userAgent?.toLowerCase().includes('mobile') ||
      userAgent?.toLowerCase().includes('android');

    // UA-CH says mobile but no touch support and large screen
    if (mobile && !hasTouch && !hasSmallScreen && !hasMobileUA) {
      inconsistencies.push({
        category: 'ua-ch',
        description:
          'UA-CH mobile flag is true but device lacks mobile characteristics',
        expected: 'Mobile device with touch support',
        actual: `maxTouchPoints: ${maxTouchPoints}, screen: ${screenWidth}x${screenHeight}`,
        severity: 'high',
      });
    }

    // UA-CH says not mobile but device has mobile characteristics
    // This is less reliable as some tablets/laptops have touch
    if (!mobile && hasMobileUA) {
      inconsistencies.push({
        category: 'ua-ch',
        description:
          'UA-CH mobile flag is false but User-Agent indicates mobile',
        expected: 'Desktop device',
        actual: 'User-Agent contains mobile identifier',
        severity: 'medium',
      });
    }
  }

  // Model should only be present on mobile devices
  if (model && model.length > 0 && mobile === false) {
    inconsistencies.push({
      category: 'ua-ch',
      description: 'UA-CH model is set but mobile flag is false',
      expected: 'Model should be empty for non-mobile devices',
      actual: `Model: ${model}, mobile: false`,
      severity: 'medium',
    });
  }

  // Platform vs navigator.platform
  if (platform && navigatorPlatform) {
    const platformLower = platform.toLowerCase();
    const navPlatLower = navigatorPlatform.toLowerCase();

    // Map UA-CH platform names to navigator.platform patterns
    const platformMappings: Record<string, string[]> = {
      windows: ['win'],
      macos: ['mac'],
      linux: ['linux'],
      android: ['linux', 'android'], // Android reports "Linux" for navigator.platform
      'chrome os': ['linux', 'cros'],
      chromeos: ['linux', 'cros'],
    };

    const expectedPatterns = platformMappings[platformLower];
    if (expectedPatterns) {
      const matches = expectedPatterns.some((pattern) =>
        navPlatLower.includes(pattern),
      );
      if (!matches) {
        inconsistencies.push({
          category: 'ua-ch',
          description: 'UA-CH platform does not match navigator.platform',
          expected: `UA-CH platform: ${platform}`,
          actual: `navigator.platform: ${navigatorPlatform}`,
          severity: 'high',
        });
      }
    }
  }
}

/**
 * Checks audio fingerprint consistency.
 */
function checkAudioConsistency(
  audioData: {
    channelDataMatch?: boolean;
    binsSilent?: boolean;
    binsNoise?: boolean;
  },
  inconsistencies: Inconsistency[],
): void {
  if (audioData.channelDataMatch === false) {
    inconsistencies.push({
      category: 'audio',
      description: 'getChannelData and copyFromChannel return different values',
      expected: 'Both methods should return identical data',
      actual: 'Data mismatch detected',
      severity: 'high',
    });
  }

  if (audioData.binsNoise) {
    inconsistencies.push({
      category: 'audio',
      description: 'Audio frequency bins contain noise before rendering',
      expected: 'All bins should be -Infinity before rendering',
      actual: 'Non-Infinity values detected (noise injection)',
      severity: 'high',
    });
  }
}

/**
 * Calculates risk score from inconsistencies.
 */
function calculateRiskScore(inconsistencies: Inconsistency[]): number {
  const weights: Record<InconsistencySeverity, number> = {
    critical: 30,
    high: 15,
    medium: 5,
    low: 1,
  };

  let score = 0;
  for (const inc of inconsistencies) {
    score += weights[inc.severity];
  }

  return Math.min(100, score);
}

/**
 * Main entry point: Analyzes fingerprint data for internal inconsistencies.
 *
 * @param fingerprint - The loose fingerprint object from collectFingerprint
 * @returns Analysis result with detected inconsistencies
 */
export function analyzeInconsistencies(
  fingerprint: Record<string, unknown>,
): InconsistencyResult {
  const inconsistencies: Inconsistency[] = [];

  // Extract signals from fingerprint
  const navigator = (fingerprint.navigator || {}) as Record<string, unknown>;
  const workerScope = (fingerprint.workerScope || {}) as Record<
    string,
    unknown
  >;
  const screen = (fingerprint.screen || {}) as Record<string, unknown>;
  const cssMedia = (fingerprint.cssMedia || {}) as Record<string, unknown>;
  const timezone = (fingerprint.timezone || {}) as Record<string, unknown>;
  const intl = (fingerprint.intl || {}) as Record<string, unknown>;
  const fonts = (fingerprint.fonts || {}) as Record<string, unknown>;
  const canvasWebgl = (fingerprint.canvasWebgl || {}) as Record<
    string,
    unknown
  >;
  const audio = (fingerprint.offlineAudioContext || {}) as Record<
    string,
    unknown
  >;
  const webgpu = (navigator.webgpu || {}) as Record<string, unknown>;
  const adapterInfo = (webgpu.adapterInfo || []) as string[];

  // Check platform consistency
  checkPlatformConsistency(
    {
      navigatorPlatform: navigator.platform as string | undefined,
      userAgent: navigator.userAgent as string | undefined,
      userAgentPlatform: (
        (navigator.userAgentData || {}) as Record<string, unknown>
      ).platform as string | undefined,
      workerPlatform: workerScope.platform as string | undefined,
      fontOS: fonts.platformVersion as string | undefined,
    },
    inconsistencies,
  );

  // Check screen consistency
  const cssProbe = (cssMedia.screenQuery || {}) as Record<string, unknown>;
  checkScreenConsistency(
    {
      width: screen.width as number | undefined,
      height: screen.height as number | undefined,
      availWidth: screen.availWidth as number | undefined,
      availHeight: screen.availHeight as number | undefined,
      cssWidth: cssProbe.width as number | undefined,
      cssHeight: cssProbe.height as number | undefined,
    },
    inconsistencies,
  );

  // Check hardware consistency
  checkHardwareConsistency(
    {
      deviceMemory: navigator.deviceMemory as number | undefined,
      hardwareConcurrency: navigator.hardwareConcurrency as number | undefined,
    },
    {
      deviceMemory: workerScope.deviceMemory as number | undefined,
      hardwareConcurrency: workerScope.hardwareConcurrency as
        | number
        | undefined,
    },
    inconsistencies,
  );

  // Check timezone consistency
  checkTimezoneConsistency(
    {
      offset: timezone.offset as number | undefined,
      offsetComputed: timezone.offsetComputed as number | undefined,
      location: timezone.location as string | undefined,
      zone: timezone.zone as string | undefined,
      workerOffset: workerScope.timezoneOffset as number | undefined,
      workerLocation: workerScope.timezoneLocation as string | undefined,
    },
    inconsistencies,
  );

  // Check language consistency
  checkLanguageConsistency(
    {
      navigatorLanguage: navigator.language as string | undefined,
      navigatorLanguages: navigator.languages as string[] | undefined,
      workerLanguage: workerScope.language as string | undefined,
      workerLanguages: (workerScope.languages as string | undefined)
        ? (workerScope.languages as string).split(',')
        : undefined,
      intlLocale: intl.locale as string | undefined,
    },
    inconsistencies,
  );

  // Check GPU consistency
  const webglParams = (canvasWebgl.parameters || {}) as Record<string, unknown>;
  checkGPUConsistency(
    {
      webglRenderer: webglParams.UNMASKED_RENDERER_WEBGL as string | undefined,
      webglVendor: webglParams.UNMASKED_VENDOR_WEBGL as string | undefined,
      workerWebglRenderer: workerScope.webglRenderer as string | undefined,
      workerWebglVendor: workerScope.webglVendor as string | undefined,
      webgpuVendor: adapterInfo[0] || undefined,
      webgpuArchitecture: adapterInfo[1] || undefined,
    },
    inconsistencies,
  );

  // Check UA-CH consistency
  const userAgentData = (navigator.userAgentData || {}) as Record<
    string,
    unknown
  >;
  const highEntropyValues = (userAgentData.highEntropyValues || {}) as Record<
    string,
    unknown
  >;
  checkUACHConsistency(
    {
      architecture: highEntropyValues.architecture as string | undefined,
      bitness: highEntropyValues.bitness as string | undefined,
      mobile: userAgentData.mobile as boolean | undefined,
      model: highEntropyValues.model as string | undefined,
      platform: userAgentData.platform as string | undefined,
      platformVersion: highEntropyValues.platformVersion as string | undefined,
    },
    {
      navigatorPlatform: navigator.platform as string | undefined,
      webglRenderer: webglParams.UNMASKED_RENDERER_WEBGL as string | undefined,
      maxTouchPoints: navigator.maxTouchPoints as number | undefined,
      screenWidth: screen.width as number | undefined,
      screenHeight: screen.height as number | undefined,
      userAgent: navigator.userAgent as string | undefined,
    },
    inconsistencies,
  );

  // Check audio consistency
  checkAudioConsistency(
    {
      channelDataMatch: audio.channelDataMatch as boolean | undefined,
      binsSilent: audio.binsSilent as boolean | undefined,
      binsNoise: audio.binsNoise as boolean | undefined,
    },
    inconsistencies,
  );

  // Count by severity
  const counts: Record<InconsistencySeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const inc of inconsistencies) {
    counts[inc.severity]++;
  }

  const riskScore = calculateRiskScore(inconsistencies);

  return {
    inconsistencies,
    counts,
    riskScore,
    $hash: hashMini(inconsistencies),
  };
}

export default analyzeInconsistencies;
