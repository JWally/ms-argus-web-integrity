/**
 * Races a promise against a timeout, returning fallback on timeout.
 *
 * Used for IndexedDB and other async operations that may hang
 * indefinitely in certain browsers (e.g., Firefox private mode).
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
