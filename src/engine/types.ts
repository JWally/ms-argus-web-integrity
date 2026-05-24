/**
 * JavaScript Engine Fingerprinting Types
 */

/** JavaScript engine identifiers */
export type JSEngine = 'V8' | 'SpiderMonkey' | 'JavaScriptCore' | 'unknown';

/** Layout/rendering engine identifiers */
export type LayoutEngine = 'Blink' | 'Gecko' | 'WebKit' | 'unknown';

/**
 * Engine fingerprint — raw behavioral signals collected client-side.
 *
 * SERVER-SIDE analysis expected for:
 *   - engineMismatch: compare jsEngine vs UA header received by server
 *   - claimedEngine: parse UA server-side (server has it in headers already)
 *   - errors[]: validate messages against versioned expected-value table per engine
 *   - stackFormatHash: check against whitelist of known-good hashes per engine version
 *   - evalToStringLength / functionToStringLength: cross-validate against jsEngine
 *     (known V8 ≈ 37, SpiderMonkey ≈ 39 — mismatch = spoofed UA)
 */
export interface ConsoleErrorsFingerprint {
  /** Raw error messages from intentionally triggered JS errors */
  errors: string[];
  /** Detected JS engine from behavioral tests (stack format, error messages, API presence) */
  jsEngine: JSEngine;
  /**
   * Detected layout engine from CSS/DOM behavior.
   * NOTE: Brave and privacy-focused Chromium forks remove window.chrome,
   * causing this to report WebKit even when jsEngine=V8. Server should
   * not treat layoutEngine=WebKit + jsEngine=V8 as a hard mismatch signal.
   */
  layoutEngine: LayoutEngine;
  /** Hash of normalized stack trace structure — varies by engine, stable across versions */
  stackFormatHash: string;
  /**
   * Raw stack-trace sample with URLs/origins scrubbed but frame internals
   * intact. Captures Chrome/Firefox/Safari version drift and function-name
   * patterns the engine emits ("at Object.<anonymous>", "@", spaces).
   * Mirrors FingerprintJS v4 slot s119 — server hashes/parses flexibly.
   * Capped at 600 chars to keep payload small.
   */
  stackRaw: string;
  /** eval.toString().length — constant per engine, cross-validate server-side */
  evalToStringLength: number;
  /** Function.toString.call(eval).length — constant per engine, cross-validate server-side */
  functionToStringLength: number;
}
