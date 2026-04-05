/**
 * API Scanner
 *
 * Data-driven API scanning that replaces 60+ individual searchLies calls
 * with a single loop over the API_SEARCH_TARGETS configuration.
 *
 * @module lies/scanner
 */

import { API_SEARCH_TARGETS } from './constants';
import type { LieDetector, PrototypeLiesResult } from './types';
import { createLieDetector } from './detector';

/**
 * Resolves an API name string to the actual object.
 *
 * Handles special cases like:
 * - Intl.DateTimeFormat (dot notation)
 * - speechSynthesis (lowercase)
 * - CSS2Properties (Gecko-specific)
 *
 * @param scope - Window scope to resolve in
 * @param apiName - API name string
 * @returns The API object or undefined if not available
 */
function resolveApi(
  scope: Window & typeof globalThis,
  apiName: string,
): unknown {
  try {
    // Handle dot notation (e.g., "Intl.DateTimeFormat")
    if (apiName.includes('.')) {
      const parts = apiName.split('.');
      let obj: unknown = scope;
      for (const part of parts) {
        obj = (obj as Record<string, unknown>)?.[part];
        if (obj === undefined) return undefined;
      }
      return obj;
    }

    // Handle lowercase globals (e.g., "speechSynthesis")
    if (apiName[0] === apiName[0].toLowerCase()) {
      return (scope as unknown as Record<string, unknown>)[apiName];
    }

    // Standard global (e.g., "Navigator", "Function")
    return (scope as unknown as Record<string, unknown>)[apiName];
  } catch {
    return undefined;
  }
}

/**
 * Runs lie detection across all configured browser APIs.
 *
 * This replaces 60+ individual searchLies() calls with a data-driven loop.
 * The API_SEARCH_TARGETS configuration defines which APIs and properties
 * to test.
 *
 * @param scope - Window scope to test in (usually PHANTOM_DARKNESS)
 * @returns Complete lie detection results
 */
export function getPrototypeLies(
  scope: Window & typeof globalThis,
): PrototypeLiesResult {
  const lieDetector = createLieDetector(scope);
  const { searchLies } = lieDetector;

  // Scan all configured APIs using data-driven loop
  for (const { api, target, ignore } of API_SEARCH_TARGETS) {
    const apiObj = resolveApi(scope, api);
    if (apiObj !== undefined) {
      searchLies(() => apiObj, { target, ignore });
    }
  }

  // Additional APIs not in the standard list (CSS, WebRTC, Worker, History)
  // These have special handling or are browser-specific

  // CSS Style/Rule APIs - detect stylesheet manipulation tampering
  searchLies(() => CSSStyleSheet, {
    target: ['cssRules', 'insertRule', 'deleteRule'],
  });
  searchLies(() => CSSRule, {
    target: ['style', 'cssText'],
  });

  // WebRTC APIs - critical for IP leak detection tampering
  searchLies(() => RTCPeerConnection, {
    ignore: ['peerIdentity'], // Throws in Firefox
  });

  // Plugin/MimeType APIs - often spoofed by bots
  searchLies(() => Plugin);
  searchLies(() => PluginArray);
  searchLies(() => MimeTypeArray);

  // Worker APIs - automation tools often modify these
  searchLies(() => ServiceWorker);
  searchLies(() => SharedWorker);
  searchLies(() => Worker);

  // History API - navigation spoofing detection
  searchLies(() => History);

  // Return results
  const props = lieDetector.getProps();
  const propsSearched = lieDetector.getPropsSearched();

  return {
    lieDetector,
    lieList: Object.keys(props).sort(),
    lieDetail: props,
    lieCount: Object.keys(props).reduce(
      (acc, key) => acc + props[key].length,
      0,
    ),
    propsSearched,
  };
}
