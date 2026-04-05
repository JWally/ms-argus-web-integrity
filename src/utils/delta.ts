/**
 * Delta-based volatility detection.
 *
 * Runs a fingerprint module twice and returns only the attributes
 * that produced identical values across both runs. Any attribute
 * that differs is volatile (randomized, noisy, or timing-dependent)
 * and should not be included in stable hashes.
 */

/**
 * Recursively compare two values and return only the parts that are identical.
 * - For primitives: returns the value if equal, undefined if not.
 * - For arrays: returns the array if JSON-equal, undefined if not.
 * - For objects: recurses into each key, dropping volatile keys.
 */
export function removeVolatile<T>(a: T, b: T): T | undefined {
  // Both nullish
  if (a == null && b == null) return a;

  // One nullish
  if (a == null || b == null) return undefined;

  // Primitives
  if (typeof a !== 'object' || typeof b !== 'object') {
    return a === b ? a : undefined;
  }

  // Arrays - compare as JSON since element-level diffing gets messy
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return undefined;
    return JSON.stringify(a) === JSON.stringify(b) ? a : undefined;
  }

  // Objects - recurse
  const result: any = {};
  const keys = new Set([...Object.keys(a as any), ...Object.keys(b as any)]);
  let hasKeys = false;

  for (const key of keys) {
    const stable = removeVolatile((a as any)[key], (b as any)[key]);
    if (stable !== undefined) {
      result[key] = stable;
      hasKeys = true;
    }
  }

  return hasKeys ? result : undefined;
}

/**
 * Compute which keys were dropped (present in original but not in stable).
 * Returns a flat list of dot-separated paths that were volatile.
 */
export function getDroppedKeys(
  original: any,
  stable: any,
  prefix = '',
): string[] {
  if (original == null || typeof original !== 'object') return [];
  if (Array.isArray(original)) {
    // If the array was dropped entirely
    if (stable === undefined) return [prefix || '(root)'];
    return [];
  }

  const dropped: string[] = [];
  for (const key of Object.keys(original)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (stable == null || !(key in stable)) {
      dropped.push(path);
    } else if (
      typeof original[key] === 'object' &&
      original[key] !== null &&
      !Array.isArray(original[key])
    ) {
      dropped.push(...getDroppedKeys(original[key], stable[key], path));
    }
  }
  return dropped;
}
