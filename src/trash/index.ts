/**
 * Trash/Validation Module
 *
 * Detects suspicious or invalid values that indicate fingerprint tampering.
 * This module provides critical fraud detection signals because:
 *
 * 1. **Gibberish Detection**: Fingerprint randomizers often generate fake
 *    values with random letter sequences. Real GPU names and user agents
 *    follow consistent patterns; gibberish indicates automation.
 *
 * 2. **WebGL Renderer Validation**: The WebGL renderer string is a key
 *    fingerprinting vector. We validate it against known GPU naming
 *    conventions to detect fake or spoofed values.
 *
 * 3. **Proxy Detection**: Some automation tools use JavaScript Proxies to
 *    intercept property access. We detect proxy-like behavior on values.
 *
 * 4. **Trash Collection**: Suspicious values from across all modules are
 *    collected in a central "trash bin" for analysis.
 *
 * ## Gibberish Detection Algorithm
 *
 * We use two complementary approaches:
 *
 * 1. **Letter Sequence Analysis**: Certain letter pairs almost never appear
 *    together in English or product names (e.g., "qx", "zf", "bq").
 *
 * 2. **Case Pattern Analysis**: Random strings often have irregular casing
 *    (e.g., "aBCDe") that real product names avoid.
 *
 * @module trash
 */

import {
  GIBBERISH_PATTERN,
  LETTER_CASE_TESTS,
  ALLOWED_GIBBERS,
  KNOWN_GPU_PARTS,
  MODEL_NORMALIZATION_PATTERN,
} from './constants';
import type { TrashEntry, RendererConfidence, TrashResult } from './types';

/**
 * Detects if a value exhibits proxy behavior.
 *
 * Some fingerprint protection tools wrap values in Proxies that intercept
 * property access. Functions returning true (rather than their expected
 * return value) may indicate such interception.
 *
 * @param value - Value to check
 * @returns True if value appears to be a proxy wrapper
 */
function proxyBehavior(value: unknown): boolean {
  return typeof value === 'function' ? true : false;
}

/**
 * Detects gibberish in a string.
 *
 * Analyzes the string for letter sequences and case patterns that indicate
 * randomly generated content rather than legitimate text.
 *
 * @param str - String to analyze
 * @param options - Detection options
 * @param options.strict - If true, use stricter thresholds
 * @returns Array of detected gibberish sequences
 */
function gibberish(
  str: string,
  { strict = false }: { strict?: boolean } = {},
): string[] {
  if (!str) return [];

  // Test letter case sequence patterns
  const letterCaseSequenceGibbers: string[] = [];
  LETTER_CASE_TESTS.forEach((regExp) => {
    const match = str.match(regExp);
    if (match) {
      letterCaseSequenceGibbers.push(match.join(', '));
    }
  });

  // Test letter sequence patterns
  const letterSequenceGibbers: string[] = [];
  const clean = str
    .replace(/\d|\W|_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .join('_');
  const len = clean.length;
  const arr = [...clean];

  arr.forEach((char, index) => {
    const nextIndex = index + 1;
    const nextChar = arr[nextIndex];
    const isWordSequence =
      nextChar !== '_' && char !== '_' && nextIndex !== len;

    if (isWordSequence) {
      const combo = char + nextChar;
      if (GIBBERISH_PATTERN.test(combo)) {
        letterSequenceGibbers.push(combo);
      }
    }
  });

  const gibbers = [
    // Ignore sequence if less than threshold
    ...(!strict && letterSequenceGibbers.length < 3
      ? []
      : letterSequenceGibbers),
    ...(!strict && letterCaseSequenceGibbers.length < 4
      ? []
      : letterCaseSequenceGibbers),
  ];

  // Filter out known allowable "gibberish" (brand names, etc.)
  return gibbers.filter((x) => !ALLOWED_GIBBERS.includes(x));
}

/**
 * Validates that a value is an integer.
 *
 * @param value - Value to check
 * @returns True if value is an integer
 */
function isInt(value: unknown): boolean {
  return typeof value === 'number' && value % 1 === 0;
}

/**
 * Validates and trusts an integer value, sending to trash if invalid.
 *
 * @param name - Name of the value for trash reporting
 * @param val - Value to validate
 * @returns The value if valid, otherwise sends to trash and returns undefined
 */
function trustInteger(name: string, val: unknown): number | undefined {
  const trusted = isInt(val);
  return trusted ? (val as number) : sendToTrash(name, val);
}

/**
 * Compresses a WebGL renderer string to a normalized form.
 *
 * Removes driver-specific details and version numbers to create a stable
 * fingerprint that doesn't change with driver updates.
 *
 * Example:
 * - Input: "ANGLE (NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0)"
 * - Output: "NVIDIA GeForce GTX 1000s"
 *
 * @param renderer - Raw WebGL renderer string
 * @returns Compressed renderer string or undefined
 */
function compressWebGLRenderer(renderer: string): string | undefined {
  if (!renderer) return undefined;

  return ('' + renderer)
    .replace(
      /ANGLE \(|\sDirect3D.+|\sD3D.+|\svs_.+\)|\((DRM|POLARIS|LLVM).+|Mesa.+|(ATI|INTEL)-.+|Metal\s-\s.+|NVIDIA\s[\d|\.]+/gi,
      '',
    )
    .replace(/(\s(ti|\d{1,2}GB|super)$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(MODEL_NORMALIZATION_PATTERN, (...args) => {
      return `${args[1]}${args[6][0]}${args[6].slice(1).replace(/\d/g, '0')}s`;
    });
}

/**
 * Extracts known GPU manufacturer/product parts from a renderer string.
 *
 * @param renderer - WebGL renderer string
 * @returns Comma-separated list of recognized parts
 */
function getWebGLRendererParts(renderer: string): string {
  const parts = KNOWN_GPU_PARTS.filter((name) =>
    ('' + renderer).includes(name),
  );
  return [...new Set(parts)].sort().join(', ');
}

/**
 * Hardens a WebGL renderer string if it contains known parts.
 *
 * If the renderer contains known GPU parts, it's compressed for stability.
 * Otherwise, it's returned as-is (may be fake).
 *
 * @param renderer - WebGL renderer string
 * @returns Hardened renderer string
 */
function hardenWebGLRenderer(renderer: string): string | undefined {
  const gpuHasKnownParts = getWebGLRendererParts(renderer).length;
  return gpuHasKnownParts ? compressWebGLRenderer(renderer) : renderer;
}

/**
 * Assesses confidence in a WebGL renderer string's authenticity.
 *
 * Checks for:
 * - Presence of known GPU manufacturer/product parts
 * - Correct ANGLE structure (if applicable)
 * - Absence of extra whitespace (indicates string manipulation)
 * - Absence of gibberish sequences
 *
 * @param renderer - WebGL renderer string
 * @returns Confidence assessment with grade and warnings
 */
function getWebGLRendererConfidence(
  renderer: string,
): RendererConfidence | undefined {
  if (!renderer) {
    return undefined;
  }

  const parts = getWebGLRendererParts(renderer);
  const hasKnownParts = parts.length > 0;
  const hasBlankSpaceNoise = /\s{2,}|^\s|\s$/.test(renderer);
  const hasBrokenAngleStructure =
    /^ANGLE/.test(renderer) && !(/^ANGLE \((.+)\)/.exec(renderer) || [])[1];

  const gibbers = gibberish(renderer, { strict: true }).join(', ');

  const valid =
    hasKnownParts && !hasBlankSpaceNoise && !hasBrokenAngleStructure;

  const confidence: RendererConfidence['confidence'] =
    valid && !gibbers.length
      ? 'high'
      : valid && gibbers.length
        ? 'moderate'
        : 'low';

  const grade: RendererConfidence['grade'] =
    confidence === 'high' ? 'A' : confidence === 'moderate' ? 'C' : 'F';

  const warnings: string[] = [];
  if (hasBlankSpaceNoise) warnings.push('found extra spaces');
  if (hasBrokenAngleStructure) warnings.push('broken angle structure');

  return {
    parts,
    warnings,
    gibbers,
    confidence,
    grade,
  };
}

/**
 * Creates a trash bin for collecting suspicious values.
 *
 * The trash bin aggregates suspicious values detected across all
 * fingerprinting modules for centralized analysis.
 *
 * @returns Trash bin interface with getBin and sendToTrash methods
 */
function createTrashBin(): {
  getBin: () => TrashEntry[];
  sendToTrash: <T>(name: string, val: unknown, response?: T) => T | undefined;
} {
  const bin: TrashEntry[] = [];

  return {
    getBin: () => bin,
    sendToTrash: <T>(
      name: string,
      val: unknown,
      response?: T,
    ): T | undefined => {
      const proxyLike = proxyBehavior(val);
      const value = !proxyLike ? val : 'proxy behavior detected';
      bin.push({ name, value });
      return response;
    },
  };
}

// Global trash bin instance
const trashBin = createTrashBin();

/**
 * Sends a suspicious value to the trash bin.
 */
const sendToTrash = trashBin.sendToTrash;

/**
 * Gets the collected trash for the fingerprint result.
 *
 * @returns Trash collection result
 */
function getTrash(): TrashResult {
  return { trashBin: trashBin.getBin() };
}

export {
  sendToTrash,
  proxyBehavior,
  gibberish,
  trustInteger,
  compressWebGLRenderer,
  getWebGLRendererParts,
  hardenWebGLRenderer,
  getWebGLRendererConfidence,
  trashBin,
  getTrash,
};
