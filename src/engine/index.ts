/**
 * JavaScript Engine Fingerprinting Module
 *
 * Detects the actual JavaScript engine (V8, SpiderMonkey, JavaScriptCore) and
 * collects behavioral signals that can't be spoofed at the C++ level.
 *
 * ## What's collected here (raw signals only)
 *
 * - `jsEngine`              — detected engine from behavioral tests
 * - `layoutEngine`          — detected render engine from CSS/DOM behavior
 * - `errors[]`              — raw error messages per trigger (vary by engine version)
 * - `stackFormatHash`       — hash of normalized stack trace structure
 * - `evalToStringLength`    — eval.toString().length (constant per engine)
 * - `functionToStringLength`— Function.toString.call(eval).length (constant per engine)
 *
 * ## What is NOT computed here — do it server-side
 *
 * - engineMismatch: server compares jsEngine vs the UA it received in headers.
 *   Client-computed mismatch is a liability — a bot just sets it to false.
 *
 * - UA parsing / claimedEngine: server already has the raw UA string from HTTP
 *   headers. Parsing it client-side is redundant and spoofable.
 *
 * - Error message validation: server maintains a versioned table of expected
 *   messages per engine. When V8/SM/JSC update wording the table gets updated
 *   without a client deploy. Client just ships the raw strings.
 *
 * - stackFormatHash whitelist: server maintains known-good hashes per engine
 *   version. An unknown hash is itself a signal.
 *
 * - evalToStringLength cross-check: server validates reported length matches
 *   the engine (e.g. V8=37 vs SpiderMonkey=39). Mismatch = spoofed UA.
 *
 * ## Why This Catches Camoufox
 *
 * Camoufox is Firefox-based (SpiderMonkey) but may claim to be Chrome (V8) or
 * Safari (JavaScriptCore). The JS engine behavior cannot be spoofed at the C++
 * level — it's fundamental to how the browser executes JavaScript.
 *
 * @module engine
 */

import { captureError } from '../errors';
import { hashMini } from '../utils/crypto';
import { createTimer, logTestResult } from '../utils/helpers';
import { expectFailure } from '../utils/expected-failure';
import type { ConsoleErrorsFingerprint, JSEngine, LayoutEngine } from './types';

/**
 * Detect JavaScript engine from error stack trace format.
 *
 * V8 (Chrome/Edge/Opera): "    at functionName (file:line:col)"
 * SpiderMonkey (Firefox): "functionName@file:line:col"
 * JavaScriptCore (Safari): Similar to SpiderMonkey but with variations
 */
function detectJSEngineFromStack(): JSEngine {
  try {
    const err = new Error('test');
    const stack = err.stack || '';

    if (stack.includes('\n    at ')) {
      return 'V8';
    }

    if (stack.includes('@') && !stack.includes('    at ')) {
      // Both SpiderMonkey and JSC use @ format — refined by detectFromErrorMessages()
      return 'SpiderMonkey';
    }

    return 'unknown';
  } catch {
    expectFailure('Error.stack', 'Stack trace unavailable in this environment');
    return 'unknown';
  }
}

/**
 * Detect JavaScript engine using V8-specific APIs.
 * Error.captureStackTrace is V8-only.
 *
 * NOTE: Playwright polyfills captureStackTrace in WebKit, so treat as
 * supplementary only — use error messages as primary signal.
 */
function hasV8StackTraceAPI(): boolean {
  return typeof (Error as any).captureStackTrace === 'function';
}

/**
 * Detect JavaScript engine using property descriptor differences.
 *
 * V8: stack is a getter-setter on Error.prototype
 * SpiderMonkey/JSC: stack is a data property on each Error instance
 */
function detectFromStackPropertyDescriptor(): JSEngine | null {
  try {
    const err = new Error('test');
    const descriptor = Object.getOwnPropertyDescriptor(err, 'stack');

    if (descriptor && descriptor.value !== undefined) {
      return null; // Data property — SpiderMonkey or JSC, can't distinguish here
    }

    const protoDescriptor = Object.getOwnPropertyDescriptor(
      Error.prototype,
      'stack',
    );
    if (protoDescriptor && (protoDescriptor.get || protoDescriptor.set)) {
      return 'V8';
    }

    return null;
  } catch {
    expectFailure(
      'Error.stack descriptor',
      'Property descriptor access failed',
    );
    return null;
  }
}

/**
 * Detect engine from error message patterns.
 *
 * These message strings are the most reliable engine signal — generated deep
 * in the C++ engine, can't be polyfilled or patched by automation tools.
 *
 * NOTE (rot risk): Engine vendors occasionally update error message wording.
 * V8 already did this once (added "(reading 'foo')" suffix). If patterns stop
 * matching the functions below degrade to 'unknown' silently. Monitor the
 * raw errors[] array server-side to catch drift before it causes false negatives.
 */
function detectFromErrorMessages(): JSEngine {
  try {
    try {
      // @ts-expect-error intentional error
      null.foo;
    } catch (e: any) {
      const msg = e.message || '';
      // V8: "Cannot read properties of null (reading 'foo')"
      if (msg.includes('Cannot read propert')) {
        return 'V8';
      }
      // SpiderMonkey: "null has no properties"
      if (msg.includes('has no properties')) {
        return 'SpiderMonkey';
      }
      // JavaScriptCore: "null is not an object"
      if (msg.includes('is not an object')) {
        return 'JavaScriptCore';
      }
    }
    return 'unknown';
  } catch {
    expectFailure('error.message detection', 'Error pattern detection failed');
    return 'unknown';
  }
}

/**
 * Primary JS engine detection combining multiple techniques.
 *
 * Priority: error messages (most reliable, C++-level) → stack format
 * → V8 API existence → property descriptor.
 */
function detectJSEngine(): JSEngine {
  const fromMessages = detectFromErrorMessages();
  if (fromMessages !== 'unknown') {
    return fromMessages;
  }

  const fromStack = detectJSEngineFromStack();
  if (fromStack !== 'unknown') {
    return fromStack;
  }

  // Less reliable — can be polyfilled. Only trust if messages agree.
  if (hasV8StackTraceAPI()) {
    const errorCheck = detectFromErrorMessages();
    if (errorCheck === 'V8' || errorCheck === 'unknown') {
      return 'V8';
    }
    return errorCheck;
  }

  const fromDescriptor = detectFromStackPropertyDescriptor();
  if (fromDescriptor) {
    return fromDescriptor;
  }

  return 'unknown';
}

/**
 * Detect layout/rendering engine from CSS and DOM behavior.
 *
 * This is a client-side behavioral signal — collected here, cross-validated
 * server-side against jsEngine and the UA header.
 */
function detectLayoutEngine(): LayoutEngine {
  try {
    const div = document.createElement('div');

    // Gecko detection: MozAppearance was removed in modern Firefox (replaced by
    // unprefixed `appearance`). Fall back to CSS.supports() for -moz- prefixes
    // and MozBoxSizing which persists longer.
    // @ts-expect-error vendor prefix
    if (typeof div.style.MozAppearance !== 'undefined') {
      return 'Gecko';
    }
    // @ts-expect-error vendor prefix — fallback for Firefox 148+ where MozAppearance is gone
    if (typeof div.style.MozBoxSizing !== 'undefined') {
      return 'Gecko';
    }
    if (typeof CSS !== 'undefined' && CSS.supports?.('-moz-appearance', 'none')) {
      return 'Gecko';
    }

    const hasWebkit = typeof div.style.webkitAppearance !== 'undefined';
    // @ts-expect-error chrome global
    const hasChrome = typeof window.chrome !== 'undefined';

    if (hasWebkit) {
      // NOTE: Brave and other privacy-focused Chromium forks remove window.chrome,
      // so this falls through to WebKit even though the engine is Blink.
      // Server should not treat layoutEngine=WebKit + jsEngine=V8 as a hard mismatch.
      return hasChrome ? 'Blink' : 'WebKit';
    }

    return 'unknown';
  } catch {
    expectFailure('layout engine detection', 'DOM style access failed');
    return 'unknown';
  }
}

/**
 * Error-triggering functions — each produces engine-specific wording.
 *
 * The raw messages are shipped to the server as `errors[]`. The server
 * maintains the expected-value table per engine+version so message drift
 * is caught without a client deploy.
 *
 * NOTE (rot risk): Message wording can change across engine versions.
 * See module-level comment for monitoring guidance.
 */
const ERROR_TRIGGERS: Array<() => void> = [
  // SyntaxError — V8: "Invalid or unexpected token" / SM: "unterminated string literal"
  () => new Function('alert(")')(),

  // TypeError — V8: "Cannot read properties of undefined" / SM: "foo is undefined"
  () => new Function('const foo;foo.bar')(),

  // TypeError — V8: "Cannot read properties of null" / SM: "null has no properties"
  () => new Function('null.bar')(),

  // ReferenceError — V8+SM: "abc is not defined"
  () => new Function('abc.xyz = 123')(),

  // RangeError — V8: "toString() radix must be between 2 and 36"
  //              SM: "radix must be an integer at least 2 and no greater than 36"
  () => new Function('(1).toString(1000)')(),

  // TypeError — V8+SM: "undefined is not iterable"
  () => new Function('[...undefined].length')(),

  // RangeError — V8: "Invalid array length" / SM: "invalid array length"
  () => new Function('var x = new Array(-1)')(),

  // SyntaxError — V8: "Identifier 'a' has already been declared"
  //               SM: "redeclaration of const a"
  () => new Function('const a=1; const a=2;')(),
];

function collectErrorMessages(fns: Array<() => void>): string[] {
  const messages: string[] = [];
  for (const fn of fns) {
    try {
      fn();
    } catch (err) {
      messages.push((err as Error).message);
    }
  }
  return messages;
}

/**
 * Hash the error stack trace FORMAT to fingerprint the engine.
 *
 * Normalizes URLs and line:col numbers to capture only structure.
 *
 * SERVER-SIDE: maintain a whitelist of known-good hashes per engine version.
 * An unknown hash that doesn't match any known engine is itself a signal.
 */
function getStackFormatHash(): string {
  try {
    // @ts-expect-error intentional null method call
    null[0]();
  } catch (e: any) {
    const stack = (e.stack || '').toString();
    const normalized = stack
      .replace(/https?:\/\/[^\s)]+/g, 'URL')
      .replace(/\d+:\d+/g, 'L:C')
      .replace(/<anonymous>/g, 'ANON');
    return hashMini(normalized);
  }
  return '';
}

/**
 * Returns eval.toString().length — constant per engine.
 *
 * SERVER-SIDE: cross-validate against jsEngine.
 * Known values: V8 ≈ 37, SpiderMonkey ≈ 39.
 * A mismatch (e.g. reported SpiderMonkey but length=37) indicates UA spoofing.
 */
function getEvalToStringLength(): number {
  return eval.toString().length;
}

/**
 * Returns Function.toString.call(eval).length — second constant per engine.
 *
 * SERVER-SIDE: same cross-validation as evalToStringLength.
 */
function getFunctionToStringLength(): number {
  return Function.prototype.toString.call(eval).length;
}

/**
 * Collects JavaScript engine fingerprint signals.
 *
 * Raw signals only — no mismatch booleans, no UA parsing.
 * All analysis (engine vs UA cross-check, error message validation,
 * hash whitelisting) is done server-side. See module-level comment.
 */
export default function getConsoleErrors():
  | ConsoleErrorsFingerprint
  | undefined {
  try {
    const timer = createTimer();
    timer.start();

    const errors = collectErrorMessages(ERROR_TRIGGERS);
    const jsEngine = detectJSEngine();
    const layoutEngine = detectLayoutEngine();
    const stackFormatHash = getStackFormatHash();
    const evalToStringLength = getEvalToStringLength();
    const functionToStringLength = getFunctionToStringLength();

    logTestResult({ time: timer.stop(), test: 'console errors', passed: true });
    return {
      errors,
      jsEngine,
      layoutEngine,
      stackFormatHash,
      evalToStringLength,
      functionToStringLength,
    };
  } catch (error) {
    logTestResult({ test: 'console errors', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
