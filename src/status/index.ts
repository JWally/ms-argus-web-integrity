/**
 * System Status Fingerprinting Module
 *
 * Collects various browser and system status APIs for fingerprinting.
 * This module provides unique signals because:
 *
 * 1. **Hardware Fingerprinting**: Memory limits, storage quotas, and battery
 *    status reveal device-specific characteristics.
 *
 * 2. **Network Fingerprinting**: Connection type, speed estimates, and RTT
 *    correlate with location and device type.
 *
 * 3. **Engine Fingerprinting**: Call stack depth and timing resolution vary
 *    by JavaScript engine implementation.
 *
 * 4. **Pollution Detection**: Client-side scripts often add global variables,
 *    revealing installed extensions, frameworks, or tracking scripts.
 *
 * ## Privacy Considerations
 *
 * Some of these APIs (Battery, Network Info) are deprecated or restricted
 * in privacy-focused browsers. Their absence is itself a fingerprint signal.
 *
 * @module status
 */

import { expectFailure } from '../utils/expected-failure';
import type { BatteryInfo, StatusFingerprint } from './types';

/** Bytes per gigabyte for conversion calculations */
const GIGABYTE = 1073741824;

/**
 * Measures maximum call stack depth.
 *
 * Different JavaScript engines have different call stack limits:
 * - Chrome/V8: ~10,000-15,000
 * - Firefox/SpiderMonkey: ~20,000-50,000
 * - Safari/JSC: ~30,000-60,000
 *
 * This also varies by system memory and configuration.
 *
 * @returns Maximum recursion depth before stack overflow
 */
function getMaxCallStackSize(): number {
  /** Recursively increments depth until stack overflow. */
  const fn = (): number => {
    try {
      return 1 + fn();
    } catch {
      return 1;
    }
  };

  // Stabilize measurement with warmup runs
  [...Array(10)].forEach(() => fn());
  return fn();
}

/**
 * Measures performance.now() timing resolution.
 *
 * Privacy browsers reduce timer precision to prevent timing attacks:
 * - Standard browsers: ~100μs resolution
 * - Firefox with RFP: 100ms or 20ms resolution
 * - Tor Browser: 100ms resolution
 *
 * Returns the two smallest observed deltas to detect quantization.
 *
 * @see https://github.com/nickchan/nickchan-fingerprinting-script
 * @returns [smallest delta, second smallest delta]
 */
function getTimingResolution(): [number, number] {
  const maxRuns = 5000;
  let valA = 1;
  let valB = 1;
  let res: number;

  for (let i = 0; i < maxRuns; i++) {
    const a = performance.now();
    const b = performance.now();
    if (a < b) {
      res = b - a;
      if (res > valA && res < valB) {
        valB = res;
      } else if (res < valA) {
        valB = valA;
        valA = res;
      }
    }
  }

  return [valA, valB];
}

/**
 * Detects client-side pollution of window object.
 *
 * Compares window properties to a fresh iframe's window to find
 * properties added by client-side scripts (extensions, frameworks, etc.).
 *
 * Common polluters:
 * - Analytics: _gaq, ga, gtag, dataLayer
 * - Frameworks: React, Angular, Vue
 * - Extensions: chrome, browser
 * - Tracking: fbq, _fbq, ttq
 *
 * @returns Array of property names added to window
 */
function getClientLitter(): string[] {
  try {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const iframeWindow = iframe.contentWindow;
    const windowKeys = Object.getOwnPropertyNames(window);
    const iframeKeys = Object.getOwnPropertyNames(iframeWindow);
    document.body.removeChild(iframe);
    const clientKeys = windowKeys.filter((x) => !iframeKeys.includes(x));
    return clientKeys;
  } catch {
    expectFailure('getClientLitter', 'iframe contentWindow access failed');
    return [];
  }
}

/**
 * Detects non-native functions on window.
 *
 * Identifies client-injected code by checking if functions are native
 * (their toString matches engine format) or user-defined.
 *
 * @returns Array of suspected client-added property names
 */
function getClientCode(): string[] {
  const limit = 50;
  const names = Object.getOwnPropertyNames(window).slice(-limit);

  // Build native function signature pattern
  const [p1, p2] = (1).constructor.toString().split((1).constructor.name);

  /** Checks if a value is a native engine function by matching its toString signature. */
  const isEngine = (fn: unknown): boolean => {
    return (
      typeof fn === 'function' &&
      ('' + fn === p1 + fn.name + p2 ||
        '' + fn === p1 + (fn.name || '').replace('get ', '') + p2)
    );
  };

  /** Determines if a window property was injected by client-side code. */
  const isClient = (key: string): boolean => {
    if (/_$/.test(key)) return true;
    const d = Object.getOwnPropertyDescriptor(window, key);
    if (!d) return true;
    return key === 'chrome' ? names.includes(key) : !isEngine(d.get || d.value);
  };

  return Object.keys(window)
    .slice(-limit)
    .filter((x) => isClient(x));
}

/**
 * Gets battery status from BatteryManager API.
 *
 * Note: This API is deprecated in Firefox and restricted in many browsers
 * due to privacy concerns (battery patterns can track users).
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Battery_Status_API
 * @returns Battery status or null if unsupported
 */
async function getBattery(): Promise<BatteryInfo | null> {
  if (!('getBattery' in navigator)) return null;
  // @ts-expect-error - getBattery may not be typed
  return navigator.getBattery();
}

/**
 * Gets storage quota from StorageManager API.
 *
 * Storage quota correlates with device storage capacity:
 * - Desktop: Often 60% of free disk space
 * - Mobile: Typically more limited
 *
 * Note: Quota randomization in privacy browsers is detected by
 * calling this twice and checking for differences.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/StorageManager
 * @returns Storage quota in bytes or null if unsupported
 */
export async function getStorage(): Promise<number | null> {
  if (!navigator?.storage?.estimate) return null;
  return Promise.all([
    navigator.storage.estimate().then(({ quota }) => quota),
    /** Queries webkitTemporaryStorage for a fallback quota value. */
    new Promise((resolve) => {
      // @ts-expect-error - webkitTemporaryStorage may not be typed
      navigator.webkitTemporaryStorage.queryUsageAndQuota(
        (_: unknown, quota: number) => {
          resolve(quota);
        },
      );
    }).catch(() => null),
  ]).then(([quota1, quota2]) => (quota2 || quota1) as number);
}

/**
 * Gets the size of the current script.
 *
 * Script size can indicate:
 * - Which version of a library is in use
 * - Whether code injection has occurred
 *
 * @returns Script size in bytes or null if unavailable
 */
async function getScriptSize(): Promise<number | null> {
  let url = null;
  try {
    // @ts-expect-error - document.currentScript may not exist
    url = document?.currentScript?.src || import.meta.url;
  } catch {
    expectFailure('getScriptSize', 'import.meta not supported');
  }

  if (!url) return null;
  return fetch(url)
    .then((res) => res.blob())
    .then((blob) => blob.size)
    .catch(() => null);
}

/**
 * Collects comprehensive system status fingerprint.
 *
 * Gathers data from multiple status APIs:
 * - Battery: charging, level, times
 * - Memory: JS heap limit
 * - Storage: quota estimate
 * - Network: connection type, speed, RTT
 * - Engine: stack depth, timer resolution
 * - Pollution: client-added globals
 *
 * @returns System status fingerprint data
 */
export async function getStatus(): Promise<StatusFingerprint> {
  const [batteryInfo, quotaA, quotaB, scriptSize, stackSize, timingRes] =
    await Promise.all([
      getBattery(),
      getStorage(),
      getStorage(), // Called twice to detect randomization
      getScriptSize(),
      getMaxCallStackSize(),
      getTimingResolution(),
    ]);

  // Client-injected window properties
  const clientLitter = [...new Set([...getClientLitter(), ...getClientCode()])]
    .sort()
    .slice(0, 50);

  // BatteryManager
  const { charging, chargingTime, dischargingTime, level } = batteryInfo || {};

  // MemoryInfo (Chrome only)
  // @ts-expect-error - performance.memory is non-standard
  const memory = performance?.memory?.jsHeapSizeLimit || null;
  const memoryInGigabytes = memory ? +(memory / GIGABYTE).toFixed(2) : null;

  // StorageManager
  const quotaInGigabytes = quotaA ? +(+quotaA / GIGABYTE).toFixed(2) : null;

  // NetworkInformation
  const { downlink, effectiveType, rtt, saveData, downlinkMax, type } =
    // @ts-expect-error - navigator.connection is non-standard
    (navigator?.connection as {
      downlink?: number;
      effectiveType?: string;
      rtt?: number;
      saveData?: boolean;
      downlinkMax?: number;
      type?: string;
    }) || {};

  // Script sources on the page
  const scripts: string[] = [...document.querySelectorAll('script')]
    .map((x) => x.src.replace(/^https?:\/\//, ''))
    .slice(0, 10);

  return {
    charging,
    chargingTime,
    dischargingTime,
    level,
    memory,
    memoryInGigabytes,
    quota: quotaA,
    quotaIsInsecure: quotaA !== quotaB,
    quotaInGigabytes,
    downlink,
    effectiveType,
    rtt,
    saveData,
    downlinkMax,
    type,
    stackSize,
    timingRes,
    clientLitter,
    scripts,
    scriptSize,
  };
}
