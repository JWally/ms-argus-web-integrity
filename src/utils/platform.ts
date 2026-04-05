/**
 * Platform Detection Module
 *
 * Consolidated OS and platform detection utilities.
 * Single source of truth for all OS detection in the codebase.
 *
 * @module utils/platform
 */

/**
 * Normalized OS identifiers used throughout the codebase.
 * All OS detection functions return one of these values.
 */
export type NormalizedOS =
  | 'windows'
  | 'macos'
  | 'ios'
  | 'android'
  | 'linux'
  | 'chromeos'
  | 'other'
  | 'unknown';

/**
 * Maps various OS name variants to normalized lowercase identifiers.
 */
const OS_ALIASES: Record<string, NormalizedOS> = {
  // Windows variants
  windows: 'windows',
  'windows phone': 'windows',
  win: 'windows',

  // macOS variants
  mac: 'macos',
  macos: 'macos',
  macintosh: 'macos',
  osx: 'macos',
  'mac os': 'macos',

  // iOS variants
  ios: 'ios',
  iphone: 'ios',
  ipad: 'ios',
  ipod: 'ios',

  // Android
  android: 'android',

  // Linux variants
  linux: 'linux',
  ubuntu: 'linux',
  debian: 'linux',

  // ChromeOS
  chromeos: 'chromeos',
  'chrome os': 'chromeos',
  cros: 'chromeos',

  // Other
  other: 'other',
};

/**
 * Normalizes an OS name to a consistent lowercase identifier.
 *
 * @param os - Raw OS name from any source
 * @returns Normalized OS identifier
 *
 * @example
 * normalizeOS('Mac')      // 'macos'
 * normalizeOS('Windows')  // 'windows'
 * normalizeOS('iPhone')   // 'ios'
 */
export function normalizeOS(os: string): NormalizedOS {
  if (!os) return 'unknown';
  const key = os.toLowerCase().trim();
  return OS_ALIASES[key] || 'unknown';
}

/**
 * Detects OS from user agent string.
 * Returns raw display values (e.g., 'Windows', 'Mac').
 *
 * @param userAgent - Browser user agent string
 * @returns OS name for display purposes
 */
export function getOS(userAgent: string): string {
  if (!userAgent) return 'Other';

  // Order is important - more specific patterns first
  if (/windows phone/i.test(userAgent)) return 'Windows Phone';
  if (/win(dows|16|32|64|95|98|nt)|wow64/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/cros/i.test(userAgent)) return 'Chrome OS';
  if (/linux/i.test(userAgent)) return 'Linux';
  if (/ipad/i.test(userAgent)) return 'iPad';
  if (/iphone/i.test(userAgent)) return 'iPhone';
  if (/ipod/i.test(userAgent)) return 'iPod';
  if (/ios/i.test(userAgent)) return 'iOS';
  if (/mac/i.test(userAgent)) return 'Mac';

  return 'Other';
}

/**
 * Detects OS from user agent string and returns normalized identifier.
 * Used for cross-validation in inconsistency detection.
 *
 * @param ua - Browser user agent string
 * @returns Normalized OS identifier
 */
export function getOSFromUserAgent(ua: string): NormalizedOS {
  if (!ua) return 'unknown';
  const uaLower = ua.toLowerCase();

  if (uaLower.includes('windows')) return 'windows';
  if (uaLower.includes('mac os') || uaLower.includes('macintosh'))
    return 'macos';
  if (uaLower.includes('iphone') || uaLower.includes('ipad')) return 'ios';
  if (uaLower.includes('android')) return 'android';
  if (uaLower.includes('cros')) return 'chromeos';
  if (uaLower.includes('linux')) return 'linux';

  return 'unknown';
}

/**
 * Extracts OS from navigator.platform.
 * Used for cross-validation in inconsistency detection.
 *
 * @param platform - navigator.platform value
 * @returns Normalized OS identifier
 */
export function getOSFromPlatform(platform: string): NormalizedOS {
  if (!platform) return 'unknown';
  const platLower = platform.toLowerCase();

  if (platLower.includes('win')) return 'windows';
  if (platLower.includes('mac')) return 'macos';
  if (platLower.includes('iphone') || platLower.includes('ipad')) return 'ios';
  if (platLower.includes('android')) return 'android';
  if (platLower.includes('linux')) return 'linux';

  return 'unknown';
}

/**
 * Checks if two OS identifiers are compatible.
 * Accounts for related platforms (iOS/macOS, Android/Linux, ChromeOS/Linux).
 *
 * @param os1 - First OS identifier
 * @param os2 - Second OS identifier
 * @returns true if the OSes are compatible
 */
export function osCompatible(os1: string, os2: string): boolean {
  if (os1 === 'unknown' || os2 === 'unknown') return true;
  if (os1 === os2) return true;

  // iOS and macOS are related (Apple ecosystem)
  if ((os1 === 'ios' && os2 === 'macos') || (os1 === 'macos' && os2 === 'ios'))
    return true;

  // Android runs on Linux kernel
  if (
    (os1 === 'android' && os2 === 'linux') ||
    (os1 === 'linux' && os2 === 'android')
  )
    return true;

  // ChromeOS is Linux-based
  if (
    (os1 === 'chromeos' && os2 === 'linux') ||
    (os1 === 'linux' && os2 === 'chromeos')
  )
    return true;

  return false;
}
