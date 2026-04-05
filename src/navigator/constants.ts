/**
 * Navigator Fingerprinting Constants
 *
 * Known valid values for navigator properties used to detect
 * tampering and validate browser-reported data.
 */

/**
 * Valid device memory values in GB.
 *
 * The Device Memory API returns values in a limited set to reduce
 * fingerprinting precision. Any value not in this set is suspicious.
 * https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory
 */
export const VALID_DEVICE_MEMORY: Record<string, boolean> = {
  '0.25': true,
  '0.5': true,
  '1': true,
  '2': true,
  '4': true,
  '8': true,
};

/**
 * Valid Do Not Track values.
 *
 * DNT can be "1" (enabled), "0" (disabled), or null/unspecified.
 * Any other value indicates tampering.
 */
export const VALID_DO_NOT_TRACK: Record<string, boolean> = {
  '1': true,
  true: true,
  yes: true,
  '0': true,
  false: true,
  no: true,
  unspecified: true,
  null: true,
  undefined: true,
};

/**
 * Known platform substrings.
 *
 * The navigator.platform should contain one of these substrings.
 * Unknown platforms are flagged as suspicious.
 */
export const KNOWN_PLATFORMS = [
  'win',
  'linux',
  'mac',
  'arm',
  'pike',
  'iphone',
  'ipad',
  'ipod',
  'android',
  'x11',
] as const;

/**
 * Permissions to query for fingerprinting.
 *
 * These are standard permissions defined in the W3C Permissions API.
 * The state of each permission (granted/denied/prompt) varies by
 * site and user settings, providing fingerprinting data.
 * https://w3c.github.io/permissions/#permission-registry
 */
export const PERMISSION_NAMES = [
  'accelerometer',
  'ambient-light-sensor',
  'background-fetch',
  'background-sync',
  'bluetooth',
  'camera',
  'clipboard',
  'device-info',
  'display-capture',
  'gamepad',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'nfc',
  'notifications',
  'persistent-storage',
  'push',
  'screen-wake-lock',
  'speaker',
  'speaker-selection',
] as const;

/**
 * High-entropy User-Agent Client Hints to request.
 *
 * These provide detailed platform information that was previously
 * available in the User-Agent string but is now gated behind
 * the User-Agent Client Hints API.
 */
export const HIGH_ENTROPY_UA_VALUES = [
  'platform',
  'platformVersion',
  'architecture',
  'bitness',
  'model',
  'uaFullVersion',
] as const;
