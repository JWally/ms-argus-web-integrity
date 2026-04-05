/**
 * JavaScript Engine Fingerprinting Module
 *
 * Detects the actual JavaScript engine (V8, SpiderMonkey, JavaScriptCore) and
 * compares against User-Agent claims to detect spoofing.
 *
 * ## Detection Techniques
 *
 * 1. **Error Stack Format**: Each engine has distinct stack trace formatting
 *    - V8: `    at functionName (file:line:col)`
 *    - SpiderMonkey: `functionName@file:line:col`
 *    - JavaScriptCore: `functionName@file:line:col` with "global code@" for global
 *
 * 2. **V8-Only APIs**: `Error.captureStackTrace` only exists in V8
 *
 * 3. **Error Messages**: Unique error message wording per engine
 *
 * 4. **Property Descriptors**: Stack property differs (getter/setter vs data)
 *
 * ## Why This Catches Camoufox
 *
 * Camoufox is Firefox-based (SpiderMonkey) but may claim to be Chrome (V8) or
 * Safari (JavaScriptCore). The JS engine behavior cannot be spoofed at the C++
 * level - it's fundamental to how the browser executes JavaScript.
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

    // V8 format: starts with "Error" and uses "    at " prefix
    if (stack.includes('\n    at ')) {
      return 'V8';
    }

    // SpiderMonkey/JSC use @ symbol without "at " prefix
    // Check for SpiderMonkey-specific patterns
    if (stack.includes('@') && !stack.includes('    at ')) {
      // Both SpiderMonkey and JSC use @ format
      // Try to distinguish via other means
      return 'SpiderMonkey'; // Default to SpiderMonkey, refined below
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
 */
function hasV8StackTraceAPI(): boolean {
  return typeof (Error as any).captureStackTrace === 'function';
}

/**
 * Detect JavaScript engine using property descriptor differences.
 *
 * V8: stack is a getter-setter pair on Error.prototype
 * SpiderMonkey/JSC: stack is a data property on each Error instance
 */
function detectFromStackPropertyDescriptor(): JSEngine | null {
  try {
    const err = new Error('test');
    const descriptor = Object.getOwnPropertyDescriptor(err, 'stack');

    // In V8, the property might be on the prototype with get/set
    // In SpiderMonkey/JSC, it's a data property on the instance
    if (descriptor && descriptor.value !== undefined) {
      // Data property - SpiderMonkey or JSC
      return null; // Can't distinguish SM from JSC this way
    }

    // Check Error.prototype
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
 * Detect using error message patterns.
 * Different engines produce different error messages for the same error.
 */
function detectFromErrorMessages(): JSEngine {
  try {
    // Test null property access
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
 * Detect JS engine using Math implementation quirks.
 * Some edge cases produce different results across engines.
 */
function detectFromMathQuirks(): JSEngine | null {
  try {
    // Math.asinh for very large values can differ slightly
    // This is a weak signal but adds confidence
    const val = Math.asinh(1e300);
    const str = val.toString();

    // Different engines may have subtle precision differences
    // This is more of a validation than primary detection
    return null;
  } catch {
    expectFailure('Math.asinh', 'Math operation failed');
    return null;
  }
}

/**
 * Primary JS engine detection combining multiple techniques.
 *
 * Priority order matters: Error messages are most reliable because they're
 * generated deep in the engine and can't be easily polyfilled. API existence
 * checks (like Error.captureStackTrace) can be polyfilled by automation tools.
 */
function detectJSEngine(): JSEngine {
  // Method 1: Error message format (MOST reliable - can't be polyfilled)
  // Different engines produce fundamentally different error messages
  const fromMessages = detectFromErrorMessages();
  if (fromMessages !== 'unknown') {
    return fromMessages;
  }

  // Method 2: Stack trace format (reliable)
  const fromStack = detectJSEngineFromStack();
  if (fromStack !== 'unknown') {
    return fromStack;
  }

  // Method 3: V8-specific API (less reliable - can be polyfilled by automation)
  // Playwright polyfills captureStackTrace in WebKit, so check this last
  if (hasV8StackTraceAPI()) {
    // Double-check with error messages to avoid false positives
    const errorCheck = detectFromErrorMessages();
    if (errorCheck === 'V8' || errorCheck === 'unknown') {
      return 'V8';
    }
    // If error messages say different engine, trust that instead
    return errorCheck;
  }

  // Method 4: Property descriptor (supplementary)
  const fromDescriptor = detectFromStackPropertyDescriptor();
  if (fromDescriptor) {
    return fromDescriptor;
  }

  return 'unknown';
}

/**
 * Detect layout/rendering engine from CSS and DOM behavior.
 */
function detectLayoutEngine(): LayoutEngine {
  try {
    // Check for engine-specific CSS prefixes in computed styles
    const div = document.createElement('div');

    // Gecko (Firefox) specific
    // @ts-expect-error vendor prefix
    if (typeof div.style.MozAppearance !== 'undefined') {
      return 'Gecko';
    }

    // WebKit (Safari) specific - check for webkit prefix without chrome
    const hasWebkit = typeof div.style.webkitAppearance !== 'undefined';

    // Check window properties for engine hints
    // @ts-expect-error chrome global
    const hasChrome = typeof window.chrome !== 'undefined';

    if (hasWebkit) {
      if (hasChrome) {
        return 'Blink'; // Chrome/Edge/Opera use Blink
      }
      return 'WebKit'; // Safari uses WebKit
    }

    return 'unknown';
  } catch {
    expectFailure('layout engine detection', 'DOM style access failed');
    return 'unknown';
  }
}

/**
 * Parse User-Agent to determine claimed engines.
 */
function parseUserAgentEngines(): { js: JSEngine; layout: LayoutEngine } {
  const ua = navigator.userAgent;

  let js: JSEngine = 'unknown';
  let layout: LayoutEngine = 'unknown';

  // Layout engine detection from UA
  if (ua.includes('Gecko/') && ua.includes('Firefox')) {
    layout = 'Gecko';
    js = 'SpiderMonkey';
  } else if (ua.includes('Chrome/') || ua.includes('Chromium/')) {
    layout = 'Blink';
    js = 'V8';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    layout = 'WebKit';
    js = 'JavaScriptCore';
  } else if (ua.includes('Edg/')) {
    layout = 'Blink';
    js = 'V8';
  } else if (ua.includes('OPR/') || ua.includes('Opera/')) {
    layout = 'Blink';
    js = 'V8';
  }

  return { js, layout };
}

/**
 * Hash the error stack trace FORMAT to fingerprint the engine.
 *
 * Normalizes URLs and line:col numbers to capture only the structural
 * format of the stack trace, which differs between V8, SpiderMonkey, and JSC.
 *
 * @returns Hash of the normalized stack format
 */
function getStackFormatHash(): string {
  try {
    // @ts-expect-error intentional null method call
    null[0]();
  } catch (e: any) {
    const stack = (e.stack || '').toString();
    // Replace URLs with placeholder, line:col with L:C
    const normalized = stack
      .replace(/https?:\/\/[^\s)]+/g, 'URL')
      .replace(/\d+:\d+/g, 'L:C')
      .replace(/<anonymous>/g, 'ANON');
    return hashMini(normalized);
  }
  return '';
}

/**
 * Returns `eval.toString().length`.
 * This value varies by engine (V8 ≠ SpiderMonkey ≠ JSC).
 */
function getEvalToStringLength(): number {
  return eval.toString().length;
}

/**
 * Returns `Function.toString.call(eval).length`.
 * Provides a second check that varies by engine.
 */
function getFunctionToStringLength(): number {
  return Function.prototype.toString.call(eval).length;
}

/**
 * Test functions that trigger specific JavaScript errors.
 *
 * Each function is designed to trigger a specific type of error with
 * predictable behavior across browser engines.
 */
const ERROR_TRIGGERS: Array<() => void> = [
  // SyntaxError: Unterminated string literal
  // V8: "Invalid or unexpected token"
  // SpiderMonkey: "unterminated string literal"
  () => new Function('alert(")')(),

  // TypeError: Property access on undefined
  // V8: "Cannot read properties of undefined"
  // SpiderMonkey: "foo is undefined"
  () => new Function('const foo;foo.bar')(),

  // TypeError: Property access on null
  // V8: "Cannot read properties of null"
  // SpiderMonkey: "null has no properties"
  () => new Function('null.bar')(),

  // ReferenceError: Undefined variable
  // V8: "abc is not defined"
  // SpiderMonkey: "abc is not defined"
  () => new Function('abc.xyz = 123')(),

  // TypeError: Property access on undefined (duplicate for consistency)
  () => new Function('const foo;foo.bar')(),

  // RangeError: Invalid radix for toString
  // V8: "toString() radix must be between 2 and 36"
  // SpiderMonkey: "radix must be an integer at least 2 and no greater than 36"
  () => new Function('(1).toString(1000)')(),

  // TypeError: Spread of undefined
  // V8: "undefined is not iterable"
  // SpiderMonkey: "undefined is not iterable"
  () => new Function('[...undefined].length')(),

  // RangeError: Invalid array length
  // V8: "Invalid array length"
  // SpiderMonkey: "invalid array length"
  () => new Function('var x = new Array(-1)')(),

  // SyntaxError: Duplicate const declaration
  // V8: "Identifier 'a' has already been declared"
  // SpiderMonkey: "redeclaration of const a"
  () => new Function('const a=1; const a=2;')(),
];

/**
 * Executes error-triggering functions and collects error messages.
 *
 * Each function is executed in a try-catch to capture the error message.
 * The message text (not the stack trace) is what provides fingerprint value.
 *
 * @param errorFunctions - Array of functions that throw errors
 * @returns Array of error message strings
 */
function collectErrorMessages(errorFunctions: Array<() => void>): string[] {
  const messages: string[] = [];

  for (const fn of errorFunctions) {
    try {
      fn();
    } catch (err) {
      messages.push((err as Error).message);
    }
  }

  return messages;
}

/**
 * Collects JavaScript engine fingerprint including engine detection.
 *
 * Combines error message fingerprinting with JS engine detection to
 * identify User-Agent spoofing (e.g., Camoufox claiming to be Chrome).
 *
 * @returns Console errors fingerprint data or undefined on error
 */
export default function getConsoleErrors():
  | ConsoleErrorsFingerprint
  | undefined {
  try {
    const timer = createTimer();
    timer.start();

    // Collect error messages for fingerprinting
    const errors = collectErrorMessages(ERROR_TRIGGERS);

    // Detect actual JS engine from behavior
    const jsEngine = detectJSEngine();
    const layoutEngine = detectLayoutEngine();

    // Parse claimed engine from User-Agent
    const claimedEngine = parseUserAgentEngines();

    // Check for mismatch (spoofing indicator)
    // Layout engine check excluded: window.chrome removal by Brave/privacy-focused
    // Chromium forks causes systematic false positives (detected WebKit, claimed Blink).
    const engineMismatch =
      claimedEngine.js !== 'unknown' &&
      jsEngine !== 'unknown' &&
      claimedEngine.js !== jsEngine;

    // Stack format and eval fingerprinting
    const stackFormatHash = getStackFormatHash();
    const evalToStringLength = getEvalToStringLength();
    const functionToStringLength = getFunctionToStringLength();

    logTestResult({ time: timer.stop(), test: 'console errors', passed: true });
    return {
      errors,
      jsEngine,
      layoutEngine,
      claimedEngine,
      engineMismatch,
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
