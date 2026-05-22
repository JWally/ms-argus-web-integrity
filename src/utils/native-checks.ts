/**
 * Use-site behavioral checks for native JS APIs.
 *
 * The lie scanner in `src/lies/` walks ~80 native function references and
 * checks `Function.prototype.toString` on each for the `[native code]`
 * shape. That whole scan is defeated by one WeakMap that maps wrapped
 * functions to their cached `[native code]` source text — `toString`
 * returns the lie, the scanner reports clean, every hook lands. See
 * CASTLE-TO-ARGUS §3.3 for the attack and X.Castle.md §9 for the
 * proof against Castle's identical scan.
 *
 * This module provides **use-site behavioral verifiers** that survive the
 * WeakMap-toString attack because they check things the WeakMap can't
 * answer: the native binding's own runtime behavior. A permissive Proxy
 * apply trap that just forwards arguments doesn't re-implement
 * `this`-validation or argument-validation TypeErrors. Each behavioral
 * signature the attacker has to fake raises the cost wall; eventually
 * faking them all is equivalent to re-implementing the engine.
 *
 * The pattern landed first in `getConsoleTiming.ts` (v5 closure) and
 * `headless/index.ts` (v3 closure for `Object.getOwnPropertyNames`). This
 * module factors those out so additional use sites can adopt them in one
 * line.
 *
 * **Where to use these.** Right before invoking a security- or
 * performance-critical native (timing oracles, RNG, hash inputs). An
 * attacker who hooks the API between the scan-time check and the actual
 * use point is undetected by a scan-only signal; the use-site check
 * runs in the same realm at the same moment as the actual call.
 *
 * @module utils/native-checks
 */

/**
 * Canonical `[native code]` source-text shape. V8, JSC, and
 * SpiderMonkey all produce `function name() { [native code] }` for
 * native bindings (whitespace varies, hence the regex).
 */
const NATIVE_RE = /\{\s*\[native code\]\s*\}/;

/**
 * True if `fn`'s `toString` source text matches the engine's native shape.
 *
 * Defeated by a Proxy whose `apply` target is a real native (V8 forwards
 * `toString` to the target per ECMA-262), and by a WeakMap-backed
 * `Function.prototype.toString` replacement (the attack §3.3 names).
 * Stack with `isNativeMethodValidatesThis` or `isNativeStaticThrowsOnArg`
 * for behavioral confirmation.
 */
export function isNativeFn(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  try {
    return NATIVE_RE.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

/**
 * True if `fn` is a native method that validates its `this` receiver —
 * `fn.call({})` throws TypeError ("Illegal invocation" in V8, similar in
 * other engines).
 *
 * Catches the v5-class attack from clean-verdict v5: wrap a native in
 * `new Proxy(real, { apply })` so `toString` still reports `[native code]`
 * (V8 forwards to the target), but the apply trap just runs the
 * attacker's code without re-implementing the receiver-validation
 * TypeError. A more sophisticated attacker can replicate the TypeError
 * (v6 attack), but each behavioral signature added raises the cost.
 *
 * Use for instance methods bound to a specific receiver class:
 * `performance.now` (needs `Performance`), `Date.prototype.getTime`,
 * `CanvasRenderingContext2D.prototype.measureText`,
 * `WebGLRenderingContext.prototype.getParameter`.
 *
 * **Do NOT use for static-like functions** (`Math.random`,
 * `Date.now`, `crypto.getRandomValues`) — those don't validate `this`,
 * so this check returns false against a real native. Use
 * `isNativeStaticThrowsOnArg` instead.
 */
export function isNativeMethodValidatesThis(fn: unknown): boolean {
  if (!isNativeFn(fn)) return false;
  try {
    (fn as (this: unknown) => unknown).call({});
    return false;
  } catch (e) {
    return e instanceof TypeError;
  }
}

/**
 * True if `fn` is a native function that throws TypeError when called
 * with `badArg` — used for static-like functions that don't validate
 * `this` but do validate their arguments.
 *
 * Example: `crypto.getRandomValues({})` throws TypeError because the
 * arg isn't a TypedArray. A naive Proxy apply trap that just returns
 * random bytes won't re-implement the TypedArray-shape check. Same for
 * `JSON.parse(undefined)`, `subtle.digest('SHA-256', null)`, etc.
 *
 * @param fn — the native function to verify (e.g. `crypto.getRandomValues`)
 * @param badArg — an argument that the real native rejects with TypeError
 */
export function isNativeStaticThrowsOnArg(
  fn: unknown,
  badArg: unknown,
): boolean {
  if (!isNativeFn(fn)) return false;
  try {
    (fn as (a: unknown) => unknown)(badArg);
    return false;
  } catch (e) {
    return e instanceof TypeError;
  }
}
