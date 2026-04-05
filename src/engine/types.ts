/**
 * Console Errors Fingerprinting Types
 *
 * Type definitions for JavaScript engine error message fingerprinting.
 */

/** JavaScript engine identifiers */
export type JSEngine = 'V8' | 'SpiderMonkey' | 'JavaScriptCore' | 'unknown';

/** Layout/rendering engine identifiers */
export type LayoutEngine = 'Blink' | 'Gecko' | 'WebKit' | 'unknown';

/**
 * Console errors fingerprint result.
 *
 * Contains error messages from intentionally triggered JavaScript errors.
 * The exact wording varies by browser engine.
 */
export interface ConsoleErrorsFingerprint {
  /** Array of error messages from triggered JavaScript errors */
  errors: string[];
  /** Detected JavaScript engine based on behavioral tests */
  jsEngine: JSEngine;
  /** Detected layout engine based on behavioral tests */
  layoutEngine: LayoutEngine;
  /** Engine expected from User-Agent string */
  claimedEngine: {
    js: JSEngine;
    layout: LayoutEngine;
  };
  /** True if detected engine doesn't match User-Agent claim */
  engineMismatch: boolean;
  /** Hash of the stack trace format pattern (normalized) */
  stackFormatHash: string;
  /** Length of eval.toString() — varies by engine */
  evalToStringLength: number;
  /** Length of Function.toString.call(eval) — varies by engine */
  functionToStringLength: number;
}
