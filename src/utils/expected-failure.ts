/**
 * Expected Failure Helper
 *
 * Documents intentional failure points in the codebase.
 * Provides searchability (grep expectFailure) and dev-mode debugging.
 *
 * @module utils/expected-failure
 */

/**
 * Documents an expected failure point.
 * In development mode, logs to console for debugging.
 * Zero cost in production (no-op).
 *
 * @param context - Which API or operation failed (e.g., "canvas.getImageData")
 * @param reason - Why this failure is expected (e.g., "Safari throws SecurityError")
 */
export function expectFailure(context: string, reason: string): void {
  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV === 'development'
  ) {
    console.debug(`[Expected] ${context}: ${reason}`);
  }
}
