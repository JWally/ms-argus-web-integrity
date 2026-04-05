/**
 * Brave Browser Detection Module
 *
 * Detects Brave browser and its fingerprint protection modes.
 * Brave has three shield modes that affect fingerprinting:
 * - Allow: No fingerprint protection
 * - Standard: Basic protection (removes Chrome plugins)
 * - Strict: Adds noise to audio/WebGL data
 *
 * @module utils/brave
 */

import { EngineId } from '../constants/engine';

/**
 * Get the JS engine identifier from error message characteristics.
 * Duplicated here to avoid circular dependency with engine detection.
 */
function getEngineId(): number {
  const x = [].constructor;
  try {
    (-1).toFixed(-1);
  } catch (err) {
    return (
      (err as Error).message.length + (x + '').split(x.name).join('').length
    );
  }
  return 0;
}

const IS_BLINK = getEngineId() === EngineId.V8_BLINK;

/**
 * Heuristic check for Brave-like browsers.
 * Brave removes ReportingObserver from Chrome 69+.
 */
export const LIKE_BRAVE =
  IS_BLINK &&
  'flat' in Array.prototype /* Chrome 69 */ &&
  !('ReportingObserver' in self); /* Brave */

/**
 * Detect Brave browser via navigator.brave API.
 * Returns true only if the native Brave API is present and valid.
 */
export function braveBrowser(): boolean {
  const brave =
    'brave' in navigator &&
    // @ts-ignore
    Object.getPrototypeOf(navigator.brave).constructor.name == 'Brave' &&
    // @ts-ignore
    navigator.brave.isBrave.toString() ==
      'function isBrave() { [native code] }';
  return brave;
}

/**
 * Brave shield mode detection result.
 */
export interface BraveMode {
  unknown: boolean;
  allow: boolean;
  standard: boolean;
  strict: boolean;
}

/**
 * Detect Brave's fingerprint protection mode.
 *
 * Detection methods:
 * - Strict: Audio analyser returns randomized frequency data
 * - Standard: Chrome PDF plugins are removed
 * - Allow: Default Chrome behavior
 */
export function getBraveMode(): BraveMode {
  const mode: BraveMode = {
    unknown: false,
    allow: false,
    standard: false,
    strict: false,
  };
  try {
    /** Detect strict mode by checking if AnalyserNode returns randomized frequency data. */
    const strictMode = () => {
      try {
        window.OfflineAudioContext =
          // @ts-ignore
          OfflineAudioContext || webkitOfflineAudioContext;
      } catch (err) {}

      if (!window.OfflineAudioContext) {
        return false;
      }
      const context = new OfflineAudioContext(1, 1, 44100);
      const analyser = context.createAnalyser();
      const data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);
      const strict = new Set(data).size > 1; // native only has -Infinity
      return strict;
    };

    if (strictMode()) {
      mode.strict = true;
      return mode;
    }
    // standard and strict mode do not have chrome plugins
    const chromePlugins = /(Chrom(e|ium)|Microsoft Edge) PDF (Plugin|Viewer)/;
    const pluginsList = [...navigator.plugins];
    const hasChromePlugins =
      pluginsList.filter((plugin) => chromePlugins.test(plugin.name)).length ==
      2;
    if (pluginsList.length && !hasChromePlugins) {
      mode.standard = true;
      return mode;
    }
    mode.allow = true;
    return mode;
  } catch (e) {
    mode.unknown = true;
    return mode;
  }
}

/**
 * WebGL parameters blocked by Brave in strict mode.
 * These parameters are randomized/blocked for fingerprint protection.
 */
const BRAVE_BLOCKED_WEBGL_PARAMS = new Set([
  'FRAGMENT_SHADER.HIGH_FLOAT.precision',
  'FRAGMENT_SHADER.HIGH_FLOAT.rangeMax',
  'FRAGMENT_SHADER.HIGH_FLOAT.rangeMin',
  'FRAGMENT_SHADER.HIGH_INT.precision',
  'FRAGMENT_SHADER.HIGH_INT.rangeMax',
  'FRAGMENT_SHADER.HIGH_INT.rangeMin',
  'FRAGMENT_SHADER.LOW_FLOAT.precision',
  'FRAGMENT_SHADER.LOW_FLOAT.rangeMax',
  'FRAGMENT_SHADER.LOW_FLOAT.rangeMin',
  'FRAGMENT_SHADER.MEDIUM_FLOAT.precision',
  'FRAGMENT_SHADER.MEDIUM_FLOAT.rangeMax',
  'FRAGMENT_SHADER.MEDIUM_FLOAT.rangeMin',
  'MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS',
  'MAX_COMBINED_UNIFORM_BLOCKS',
  'MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS',
  'MAX_DRAW_BUFFERS_WEBGL',
  'MAX_FRAGMENT_INPUT_COMPONENTS',
  'MAX_FRAGMENT_UNIFORM_BLOCKS',
  'MAX_FRAGMENT_UNIFORM_COMPONENTS',
  'MAX_TEXTURE_MAX_ANISOTROPY_EXT',
  'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
  'MAX_UNIFORM_BUFFER_BINDINGS',
  'MAX_VARYING_COMPONENTS',
  'MAX_VERTEX_OUTPUT_COMPONENTS',
  'MAX_VERTEX_UNIFORM_BLOCKS',
  'MAX_VERTEX_UNIFORM_COMPONENTS',
  'SHADING_LANGUAGE_VERSION',
  'UNMASKED_RENDERER_WEBGL',
  'UNMASKED_VENDOR_WEBGL',
  'VERSION',
  'VERTEX_SHADER.HIGH_FLOAT.precision',
  'VERTEX_SHADER.HIGH_FLOAT.rangeMax',
  'VERTEX_SHADER.HIGH_FLOAT.rangeMin',
  'VERTEX_SHADER.HIGH_INT.precision',
  'VERTEX_SHADER.HIGH_INT.rangeMax',
  'VERTEX_SHADER.HIGH_INT.rangeMin',
  'VERTEX_SHADER.LOW_FLOAT.precision',
  'VERTEX_SHADER.LOW_FLOAT.rangeMax',
  'VERTEX_SHADER.LOW_FLOAT.rangeMin',
  'VERTEX_SHADER.MEDIUM_FLOAT.precision',
  'VERTEX_SHADER.MEDIUM_FLOAT.rangeMax',
  'VERTEX_SHADER.MEDIUM_FLOAT.rangeMin',
]);

/**
 * Filter WebGL parameters to exclude Brave-blocked ones.
 * Use this to get stable fingerprints on Brave browsers.
 *
 * @param parameters - WebGL parameter object
 * @returns Parameters with Brave-blocked keys removed
 */
export function getBraveUnprotectedParameters<
  T extends Record<string, unknown>,
>(parameters: T): Partial<T> {
  const safeParameters: Partial<T> = {};
  for (const key of Object.keys(parameters)) {
    if (!BRAVE_BLOCKED_WEBGL_PARAMS.has(key)) {
      safeParameters[key as keyof T] = parameters[key as keyof T];
    }
  }
  return safeParameters;
}
