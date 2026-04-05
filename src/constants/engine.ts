/**
 * Browser Engine Constants
 *
 * Identifies JavaScript engines by their unique error message characteristics.
 * The magic numbers come from the getEngine() function which exploits
 * engine-specific error message formatting.
 *
 * @module constants/engine
 */

/**
 * Engine identifier values derived from error message length calculation.
 * Each engine produces a unique number when (-1).toFixed(-1) throws.
 */
export enum EngineId {
  /** V8 engine (Chrome, Edge, Opera, Brave) */
  V8_BLINK = 80,
  /** SpiderMonkey engine (Firefox) */
  SPIDERMONKEY_GECKO = 58,
  /** JavaScriptCore engine (Safari) */
  JAVASCRIPTCORE_WEBKIT = 77,
}

/**
 * Human-readable engine names keyed by EngineId.
 */
export const ENGINE_NAMES: Record<number, string> = {
  [EngineId.V8_BLINK]: 'V8',
  [EngineId.SPIDERMONKEY_GECKO]: 'SpiderMonkey',
  [EngineId.JAVASCRIPTCORE_WEBKIT]: 'JavaScriptCore',
};
