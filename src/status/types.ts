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
  /**
   * Nested-iframe `crypto.subtle.generateKey` liveness. Real browsers
   * resolve in <100ms. Marionette-augmented automation runtimes
   * (Playwright Firefox, Camoufox) orphan the iframe's WebCrypto thread
   * and never resolve — the 1s timeout fires and `responsive: false` is
   * recorded. See `iframe-crypto-probe.ts`.
   */
  iframeCrypto: {
    responsive: boolean;
    elapsed_ms: number | null;
    iframe_created: boolean;
  };

  /**
   * Use-site behavioral checks for native JS APIs (CASTLE-TO-ARGUS §3.3).
   * Each boolean is true when the API still behaves like a real native
   * binding at the moment of check. The lie scanner in `src/lies/` is one
   * WeakMap away from being defeated; these checks pair with it so
   * post-WeakMap attackers also have to re-implement runtime behavior, not
   * just the `toString` source text. Helpers in `utils/native-checks.ts`.
   *
   * Per-field semantics:
   *  - true  → native shape + behavioral signature both pass
   *  - false → either source-text shape or runtime behavior tampered
   *  - null  → API absent in this environment (don't penalize)
   */
  nativeIntegrity: {
    /**
     * `crypto.getRandomValues({})` MUST throw TypeError (arg is not a
     * TypedArray). A permissive Proxy apply trap that just returns random
     * bytes for any input skips this validation. Used by the bridge IV
     * generation path (`bridge.ts:503`) and ECDH-derived envelope sealing,
     * so a tampered RNG = predictable IV = potential ciphertext analysis.
     */
    cryptoGetRandomValues: boolean | null;
    /**
     * Native shape check + variance over 32 samples > 0.01. Real
     * `Math.random` has variance ≈ 1/12; audio/canvas-evasion frameworks
     * commonly replace it with a fixed-value stub (variance 0). Catches
     * non-Proxy attacks against the RNG path too.
     */
    mathRandom: boolean | null;
    /**
     * `CanvasRenderingContext2D.prototype.measureText.call({}, 'x')` MUST
     * throw TypeError (receiver validation). A Proxy apply trap that
     * forwards to a fake TextMetrics object slips past the lie scanner
     * but can't fake this. Critical for canvas fingerprint integrity —
     * `measureText` is the primary signal for the §1.1 font-width path.
     */
    canvasMeasureText: boolean | null;
    /**
     * `WebGLRenderingContext.prototype.getParameter.call({}, 0x1F00)` MUST
     * throw TypeError (receiver validation). WebGL fingerprint slot is
     * one of the highest-entropy signals in the SDK; a stub that returns
     * fake renderer strings hides the real GPU. WebGL2 inherits the
     * prototype so this check covers both. Null when WebGL is absent
     * (Safari Tahoe iframe, certain mobile webviews).
     */
    webglGetParameter: boolean | null;
  };
}
