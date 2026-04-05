/**
 * Lie Detection Module
 *
 * This module detects if browser APIs have been modified, wrapped in proxies,
 * or otherwise tampered with. This is critical for bot detection because
 * automation tools commonly modify APIs to:
 *
 * - **Spoof fingerprints**: Return fake values for navigator, screen, etc.
 * - **Hide automation**: Mask webdriver flags, headless indicators
 * - **Bypass security**: Modify permission checks, disable features
 *
 * ## How lie detection works:
 *
 * Native browser functions have specific behaviors that are hard to replicate:
 * 1. **toString()**: Returns "[native code]" in a specific format
 * 2. **Error handling**: Throws specific TypeError messages/stacks
 * 3. **Property descriptors**: Have specific enumerable/configurable flags
 * 4. **Prototype chain**: Follow expected inheritance patterns
 *
 * When functions are wrapped in Proxies or replaced, these behaviors change
 * in detectable ways. This module tests dozens of checks per function.
 *
 * ## Phantom Darkness (Isolated Testing):
 *
 * Some extensions only modify the main window's APIs. To detect this, we
 * create nested iframes ("phantom darkness") and test APIs there too.
 * If the iframe's APIs differ from the main window, tampering is detected.
 *
 * @module lies
 */

import { IS_WORKER_SCOPE } from '../utils/helpers';
import type { LieRecords } from './types';

// Re-export from sub-modules for backwards compatibility
export { getRandomValues } from './error-traps';
export { documentLie, lieRecords, getLies, createLieRecords } from './records';
export { createLieDetector } from './detector';
export { PHANTOM_DARKNESS, PARENT_PHANTOM } from './phantom';
export { getPluginLies } from './plugins';
export { getPrototypeLies } from './scanner';
export { queryLies } from './query-lies';

// Re-export types
export type {
  LieRecords,
  ErrorTrap,
  LieQueryResult,
  LieQueryConfig,
  SearchConfig,
  PrototypeLiesResult,
  LieDetector,
  PluginLiesResult,
  LiesResult,
  PhantomIframe,
  LieRecordsManager,
} from './types';

// ============================================================================
// WARM UP
// ============================================================================

/**
 * Warm up speech synthesis before lie detection.
 * Some browsers lazily initialize this API, so we trigger it early
 * to ensure consistent timing during detection.
 */
try {
  speechSynthesis.getVoices();
} catch (err) {
  // Ignore - speech synthesis may not be available
}

// ============================================================================
// INITIALIZATION
// ============================================================================

import { PHANTOM_DARKNESS } from './phantom';
import { getPrototypeLies } from './scanner';

/**
 * Filter out Function.toString lies when determining API trust.
 *
 * Some lies are about the toString proxy wrapper rather than the
 * actual API function. These are less severe and can be filtered.
 */
const getNonFunctionToStringLies = (x: string[]): number =>
  !x
    ? 0
    : x.filter(
        (item) => !/object toString|toString incompatible proxy/.test(item),
      ).length;

// Run lie detection on module load
const start = performance.now();
const { lieDetector, lieList, lieDetail, propsSearched } = getPrototypeLies(
  PHANTOM_DARKNESS as Window & typeof globalThis,
);

let lieProps: Record<string, number>;
let prototypeLies: LieRecords;
let PROTO_BENCHMARK = 0;

if (!IS_WORKER_SCOPE) {
  // Convert lie arrays to counts (excluding toString-related lies)
  lieProps = (() => {
    const props = lieDetector.getProps();
    return Object.keys(props).reduce(
      (acc, key) => {
        acc[key] = getNonFunctionToStringLies(props[key]);
        return acc;
      },
      {} as Record<string, number>,
    );
  })();

  prototypeLies = JSON.parse(JSON.stringify(lieDetail));
  const perf = performance.now() - start;
  PROTO_BENCHMARK = +perf.toFixed(2);

  const message = `${propsSearched.length} API properties analyzed in ${PROTO_BENCHMARK}ms (${lieList.length} corrupted)`;
  setTimeout(() => console.log(message), 3000);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { lieProps, prototypeLies, PROTO_BENCHMARK };
