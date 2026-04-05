/**
 * JavaScript Engine Detection Module
 *
 * Detects the browser's JavaScript engine (V8, SpiderMonkey, JavaScriptCore)
 * using error message characteristics that cannot be spoofed.
 *
 * @module utils/engine
 */

import { EngineId, ENGINE_NAMES } from '../constants/engine';

/**
 * Detect JS engine from error message length.
 *
 * Each engine produces a unique error message for (-1).toFixed(-1),
 * and when combined with Array constructor string manipulation,
 * produces a unique numeric identifier.
 *
 * @returns Engine identifier number
 */
function getEngine(): number {
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

/** Detected engine identifier */
export const ENGINE_IDENTIFIER = getEngine();

/** True if running V8 (Chrome, Edge, Opera, Brave) */
export const IS_BLINK = ENGINE_IDENTIFIER === EngineId.V8_BLINK;

/** True if running SpiderMonkey (Firefox) */
export const IS_GECKO = ENGINE_IDENTIFIER === EngineId.SPIDERMONKEY_GECKO;

/** True if running JavaScriptCore (Safari) */
export const IS_WEBKIT = ENGINE_IDENTIFIER === EngineId.JAVASCRIPTCORE_WEBKIT;

/** Human-readable engine name or null if unknown */
export const JS_ENGINE: string | null = ENGINE_NAMES[ENGINE_IDENTIFIER] || null;
