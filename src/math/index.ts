/**
 * Math Precision Module
 *
 * Runs a small set of Math operations that produce different floating-point
 * results across V8, SpiderMonkey, and JavaScriptCore. The results are hashed
 * for engine discrimination and sent raw for server-side analysis.
 *
 * These values are C++ libm constants — no JavaScript hook, Proxy wrapper,
 * or anti-detect browser can change them.
 *
 * @module math
 */

import { captureError } from '../errors';
import { hashMini } from '../utils/crypto';
import { createTimer, logTestResult } from '../utils/timing';
import type { MathPrecisionFingerprint } from './types';

/**
 * Operations that produce different results across engines.
 * Format: [functionName, args[]]
 */
const ENGINE_TESTS: [string, number[]][] = [
  ['asinh', [1]],
  ['expm1', [1]],
  ['sinh', [1]],
  ['cosh', [1]],
  ['atanh', [0.5]],
  ['cbrt', [Math.PI]],
  ['acosh', [Math.PI]],
  ['tan', [-1e308]],
];

/**
 * Functions to check for tampering by calling twice with the same input.
 * If results differ, a fingerprint randomizer is active.
 */
const TAMPER_CHECK_FUNCTIONS = ['asinh', 'expm1', 'sinh', 'cosh', 'atanh', 'cbrt'] as const;

function checkTampering(): boolean {
  for (const fn of TAMPER_CHECK_FUNCTIONS) {
    const a = Math[fn](Math.PI);
    const b = Math[fn](Math.PI);
    const match = isNaN(a) && isNaN(b) ? true : a === b;
    if (!match) return true;
  }
  return false;
}

function runTests(): number[] {
  return ENGINE_TESTS.map(([fn, args]) => {
    try {
      // @ts-expect-error — dynamic Math function access
      return Math[fn](...args) as number;
    } catch {
      return NaN;
    }
  });
}

export default function getMathPrecision(): MathPrecisionFingerprint | undefined {
  try {
    const timer = createTimer();
    timer.start();

    const lied = checkTampering();
    const data = runTests();
    const hash = hashMini(data.map((v) => v.toString()).join(','));

    logTestResult({ time: timer.stop(), test: 'math precision', passed: true });
    return { hash, lied, data };
  } catch (error) {
    logTestResult({ test: 'math precision', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
