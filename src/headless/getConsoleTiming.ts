/**
 * CDP attach detector via console-serialization timing.
 *
 * **Mechanism.** When a CDP client is connected and has issued
 * `Runtime.enable` (Playwright, Puppeteer, Selenium-w/-CDP, etc. all do
 * this at session start), Chrome serializes every `console.*` argument
 * into the `Runtime.RemoteObject` wire format to push over the WebSocket.
 * The cost scales with the argument's structural complexity.
 *
 * Without a CDP client, console output is dropped at near-zero cost
 * regardless of argument complexity (no serialization happens).
 *
 * **The ratio test.** We bench two console.log calls:
 *   - `console.log("a")`   → cheapest possible: 1-byte string
 *   - `console.log(heavy)` → deep nested object: serializer must walk it
 *
 * Under CDP, `heavy/tiny ≳ 2`. No CDP, `heavy/tiny ≈ 1` (both dropped).
 *
 * **Why a ratio.** Absolute thresholds are fragile across hardware —
 * a slow phone might naturally hit `console.log = 30µs`. The ratio
 * self-normalizes: a slow phone scales both numbers together, ratio
 * stays near 1; only CDP scales `heavy` independently.
 *
 * **Why a pristine iframe.** The bench is 3000 console calls. Doing it
 * in the page's main frame would pollute the user's DevTools console if
 * they open it later. The iframe is hidden, shadow-DOM hosted, and torn
 * down immediately after the bench — console output stays attributed to
 * the iframe context (visible only when the iframe is selected as the
 * console execution context, which no one does).
 *
 * **Why Blink-only.** The technique relies on V8's inspector
 * implementation. Firefox/WebKit have different debugger protocols
 * (Juggler, custom WebKit) and different serialization paths; the same
 * bench has no signal there.
 *
 * **Calibration notes (initial deploy as observational signal).**
 *   - Playwright Chromium + channel:'chrome' on a quiet Linux desktop:
 *     log_tiny=30, log_heavy=63, heavy_over_tiny=2.11
 *   - Real Chrome same machine: log_tiny=9, log_heavy=7, ratio=0.79
 *   - --headless=new same machine: log_tiny=6, log_heavy=8, ratio=1.22
 *   - Threshold from initial measurement: `heavy_over_tiny > 1.5` OR
 *     `log_heavy_us > 25` flags CDP. Tune from real-user telemetry
 *     before treating as STRICT in the merchant projection.
 */

import { IS_BLINK } from '../utils/helpers';

import type { ConsoleTiming } from './types';

const N = 1000;
const HEAVY = {
  l1: { l2: { l3: { l4: [1, 2, 3, 4, 5, 'abc', true, null] } } },
  other: { a: 1, b: 2, c: 3, d: 'hello', arr: [10, 20, 30] },
};

function setupIframe(): HTMLIFrameElement | null {
  try {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'display:none;width:0;height:0;border:none';
    shadow.appendChild(iframe);
    document.body.appendChild(host);
    // Schedule teardown on the next task — the bench runs synchronously
    // below and finishes before the timeout fires.
    setTimeout(() => host.remove(), 0);
    return iframe;
  } catch {
    return null;
  }
}

const NATIVE_RE = /\{\s*\[native code\]\s*\}/;

/**
 * Native-shape oracle.
 *
 * The CDP-timing bench is only meaningful if the timing primitives it
 * relies on (`Performance.prototype.now`, `Date.now`) haven't been
 * replaced. An attacker who patches either with a JS function that
 * returns predictable values can drive the bench to any timing they
 * want, regardless of how slow real `console.log` is under CDP.
 *
 * `Performance` is structurally outside the lie scanner's reach
 * (`API_SEARCH_TARGETS` covers fingerprint-relevant prototypes, not
 * timing oracles). `Date.now` is doubly out of reach — it's a static
 * method on the constructor, and the scanner walks `Date.prototype`.
 *
 * This check sits at the detector use-site instead. We pull
 * `Function.prototype.toString` from the iframe's realm (same realm
 * the bench runs in, so any addInitScript that patched there has
 * landed) and test the toString against the standard `[native code]`
 * pattern. A plain `Object.defineProperty` replacement produces
 * `function now() { ... }` and fails the regex.
 *
 * A Proxy-with-fake-native-toString attack would slip past this check
 * but requires patching `Function.prototype.toString` itself, which
 * (a) lights up `stealth.hasToStringProxy` (Function IS in the lie
 * scanner) and (b) propagates to the cross-realm check.
 */
function isNativeFunction(
  fn: unknown,
  scope: Window & typeof globalThis,
): boolean {
  if (typeof fn !== 'function') return false;
  try {
    return NATIVE_RE.test(scope.Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

/**
 * Proxy-aware native check for methods that validate `this`.
 *
 * The toString check alone is fooled by a Proxy wrapping the real
 * native: V8's `Function.prototype.toString.call(proxy)` returns the
 * target's source text per ECMA-262 step 4, so the Proxy reports as
 * `[native code]`. The behavioral side, however, is not: the apply
 * trap runs the attacker's code, not the native's binding.
 *
 * `Performance.prototype.now` requires its `this` to be a Performance
 * instance — the native binding throws `TypeError: Illegal invocation`
 * when called with the wrong receiver. A permissive apply trap (the
 * basic v5 attack pattern) returns its counter without checking,
 * exposing the wrapping.
 *
 * A sophisticated attacker can re-implement the this-validation in the
 * trap, defeating this check. That's a real follow-up risk, but the
 * cost rises with each behavioral signature added — eventually the
 * trap is a full re-implementation, at which point it can't fake
 * V8-internal timing characteristics either.
 */
function isNativeMethodValidatesThis(
  fn: unknown,
  scope: Window & typeof globalThis,
): boolean {
  if (!isNativeFunction(fn, scope)) return false;
  try {
    (fn as (this: unknown) => unknown).call({});
    return false;
  } catch (e) {
    return e instanceof scope.TypeError;
  }
}

export default function getConsoleTiming(): ConsoleTiming | undefined {
  if (!IS_BLINK) return undefined;
  const iframe = setupIframe();
  if (!iframe) return undefined;
  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
  if (!win) return undefined;
  const con = win.console;
  const perf = win.performance;
  if (!con || !perf) return undefined;

  const perfNowNative = isNativeMethodValidatesThis(
    win.Performance?.prototype?.now,
    win,
  );
  const dateNowNative = isNativeFunction(win.Date?.now, win);
  // The bench's signal IS the cost of `con.log(...)`. If those methods
  // have been replaced (the v3 attack), the measurement is meaningless —
  // it times a JS function call, not V8 inspector serialization. The
  // broad lie scanner now covers `console`, but checking inline keeps
  // the bench self-describing: one boolean per dependency the bench
  // actually uses, in the realm the bench actually ran in.
  const conLogNative = isNativeFunction(con.log, win);
  const conDirNative = isNativeFunction(con.dir, win);

  try {
    // Warm up to amortize V8 JIT and any cold-cache cost.
    for (let i = 0; i < 100; i++) con.log('warmup');

    const t0 = perf.now();
    for (let i = 0; i < N; i++) con.log('a');
    const t1 = perf.now();

    const t2 = perf.now();
    for (let i = 0; i < N; i++) con.log(HEAVY);
    const t3 = perf.now();

    const t4 = perf.now();
    for (let i = 0; i < N; i++) con.dir(HEAVY);
    const t5 = perf.now();

    const logTinyUs = ((t1 - t0) * 1000) / N;
    const logHeavyUs = ((t3 - t2) * 1000) / N;
    const dirHeavyUs = ((t5 - t4) * 1000) / N;

    return {
      log_tiny_us: round2(logTinyUs),
      log_heavy_us: round2(logHeavyUs),
      dir_heavy_us: round2(dirHeavyUs),
      heavy_over_tiny: round2(logHeavyUs / Math.max(logTinyUs, 0.01)),
      perf_now_native: perfNowNative,
      date_now_native: dateNowNative,
      con_log_native: conLogNative,
      con_dir_native: conDirNative,
    };
  } catch {
    return undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
