/**
 * Error Trap Utilities
 *
 * Pure error testing utilities for lie detection. These functions test if
 * browser APIs produce the expected errors when used incorrectly.
 *
 * Native browser functions throw specific TypeErrors when called with invalid
 * arguments or contexts. If the error is different, or no error is thrown,
 * the function may have been modified by automation tools.
 *
 * @module lies/error-traps
 */

import type { ErrorTrap } from './types';

/**
 * Checks if an error is a TypeError.
 *
 * Many lie detection tests expect TypeError to be thrown. If a different
 * error type is thrown, it may indicate tampering.
 *
 * @param err - The error to check
 * @returns true if the error is a TypeError
 */
export function isTypeError(err: unknown): boolean {
  return (err as Error).constructor.name === 'TypeError';
}

/**
 * Tests if a function call fails with the expected TypeError.
 *
 * This is a core lie detection technique. Native functions throw specific
 * TypeErrors when called incorrectly. If the error is different, or no
 * error is thrown, the function may have been modified.
 *
 * @param config - Error trap configuration
 * @returns true if the test indicates tampering
 */
export function failsTypeError({
  spawnErr,
  withStack,
  final,
}: ErrorTrap): boolean {
  try {
    spawnErr();
    throw Error();
  } catch (err) {
    if (!isTypeError(err)) return true;
    return withStack ? withStack(err as Error) : false;
  } finally {
    final && final();
  }
}

/**
 * Tests if a function call throws any error.
 *
 * @param fn - Function to test
 * @returns true if the function throws
 */
export function failsWithError(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return true;
  }
}

/**
 * Validates error stack trace contains expected pattern.
 *
 * Error stack traces reveal information about how functions were called.
 * Proxy-wrapped functions produce different stack traces than native ones.
 *
 * @param err - Error object to check
 * @param reg - Regex pattern to match
 * @param i - Line index to check (0 for message, 1+ for stack lines)
 * @returns true if the stack trace matches the expected pattern
 */
export function hasValidStack(err: Error, reg: RegExp, i: number = 1): boolean {
  if (i === 0) return reg.test(err.message);
  return reg.test(err.stack?.split('\n')[i] || '');
}

/**
 * Generates a random string for unique element IDs.
 *
 * Used to create unique identifiers for test elements (iframes, divs)
 * that won't conflict with page elements or be predictable.
 *
 * @returns Random alphanumeric string
 */
export function getRandomValues(): string {
  return (
    String.fromCharCode(Math.random() * 26 + 97) +
    Math.random().toString(36).slice(-7)
  );
}
