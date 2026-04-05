/**
 * Status Fingerprinting Types
 *
 * Type definitions for system/browser status fingerprinting.
 */

/**
 * Battery status information.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/BatteryManager
 */
export interface BatteryInfo {
  /** Whether the device is currently charging */
  charging: boolean;
  /** Time until fully charged (seconds), Infinity if not charging */
  chargingTime: number;
  /** Time until discharged (seconds), Infinity if charging */
  dischargingTime: number;
  /** Battery level from 0.0 to 1.0 */
  level: number;
}

/**
 * Network connection information.
 * @see https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation
 */
export interface NetworkInfo {
  /** Effective bandwidth estimate (Mbps) */
  downlink?: number;
  /** Effective connection type: 'slow-2g' | '2g' | '3g' | '4g' */
  effectiveType?: string;
  /** Round-trip time estimate (ms) */
  rtt?: number;
  /** Whether data saver mode is enabled */
  saveData?: boolean;
  /** Maximum downlink speed (Mbps) */
  downlinkMax?: number;
  /** Connection type: 'wifi' | 'cellular' | 'ethernet' | etc. */
  type?: string;
}

/**
 * System status fingerprint result.
 *
 * Combines multiple system status APIs to create a fingerprint profile.
 */
export interface StatusFingerprint {
  /** Battery charging status */
  charging?: boolean;
  /** Time until fully charged (seconds) */
  chargingTime?: number;
  /** Time until discharged (seconds) */
  dischargingTime?: number;
  /** Battery level (0.0-1.0) */
  level?: number;

  /** JS heap size limit from performance.memory (bytes) */
  memory: number | null;
  /** JS heap size in gigabytes */
  memoryInGigabytes: number | null;

  /** Storage quota from StorageManager (bytes) */
  quota: number | null;
  /** Whether quota changed between calls (indicates randomization) */
  quotaIsInsecure: boolean | null;
  /** Storage quota in gigabytes */
  quotaInGigabytes: number | null;

  /** Network effective bandwidth (Mbps) */
  downlink?: number;
  /** Network effective type */
  effectiveType?: string;
  /** Network round-trip time (ms) */
  rtt?: number;
  /** Data saver mode enabled */
  saveData?: boolean;
  /** Maximum network downlink (Mbps) */
  downlinkMax?: number;
  /** Connection type */
  type?: string;

  /** Maximum call stack depth */
  stackSize: number;
  /** Performance.now() timing resolution [min, second-min] */
  timingRes: [number, number];
  /** Client-injected window properties */
  clientLitter: string[];
  /** Script sources on the page */
  scripts: string[];
  /** Size of current script (bytes) */
  scriptSize: number | null;
}
