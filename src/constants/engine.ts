/**
 * Browser Engine Constants
 *
 * Identifies JavaScript engines by their unique error message characteristics.
 * The magic numbers come from getEngine() in utils/engine.ts:
 *
 *   (-1).toFixed(-1) error message length + Array constructor string math
 *
 * ROT RISK: These values are derived from engine error message wording.
 * If V8, SpiderMonkey, or JSC ever change the (-1).toFixed(-1) error message,
 * these constants silently become wrong and IS_BLINK / IS_GECKO / IS_WEBKIT
 * will return false for every browser. There is no automated alert for this.
 *
 * Monitor: periodically run getEngine() against current browser versions and
 * verify the returned value still matches the constants below.
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
