/**
 * Math Precision Fingerprint Types
 *
 * Lightweight engine discrimination via floating-point precision differences.
 * V8 (Chrome), SpiderMonkey (Firefox), and JavaScriptCore (Safari) produce
 * different results for transcendental math functions due to different libm
 * implementations at the C++ level — unspoofable from JavaScript.
 */

export interface MathPrecisionFingerprint {
  /** FNV-1a hash of concatenated toString() results — identifies the engine */
  hash: string;
  /** True if any function returned different results on consecutive calls (tampering) */
  lied: boolean;
  /** Raw computed values for server-side engine classification */
  data: number[];
}
