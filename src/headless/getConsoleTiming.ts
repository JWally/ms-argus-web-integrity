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
// M iterations of the Math-only loop. Picked so total wall time on
// real hardware is ~50-200µs — long enough to be insensitive to clock
// jitter, short enough to add no perceptible main-thread cost.
const M = 5000;
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

  // Second clock for cross-verification: `Date.now()`. Wall-clock,
  // 1ms resolution, lives on the Date constructor as a static (completely
  // different prototype chain from `Performance.prototype.now`).
  //
  // Critical detail: `DocumentTimeline.currentTime` was tried first but
  // only advances per animation frame — both reads inside a synchronous
  // loop return the same value, producing a useless delta of 0.
  // `Date.now()` reads the OS wall clock on every call and advances
  // mid-loop, which is exactly what we need.
  //
  // An attacker who patches `Performance.prototype.now` only (every
  // red-team round through v6) leaves `Date.now()` untouched: the proxy
  // returns a counter ~1µs/call while real wall time is ~7µs (no CDP)
  // or ~63µs (CDP). The cross-clock disagreement is the tell.
  //
  // `date_now_native` already verifies the toString shape of Date.now.
  // A v7-class attacker would need a second Proxy on Date.now whose
  // values agree with their perf.now counter — two coordinated lies on
  // separate prototype chains.
  const dateNow = win.Date.now;

  // CDP-attachment tripwire: prototype-chain Proxy ownKeys trap. Only
  // fires when a CDP Runtime consumer (or DevTools) builds an object
  // preview and walks the prototype chain. Lazy path — does NOT fire on
  // a plain Chrome with no consumer. See ConsoleTiming.cdp_proto_proxy_trap.
  let protoProxyTrapFired = false;
  try {
    const trap = new win.Proxy(
      {},
      {
        ownKeys() {
          protoProxyTrapFired = true;
          return [];
        },
        getOwnPropertyDescriptor() {
          return { enumerable: true, configurable: true };
        },
      },
    );
    con.debug(win.Object.create(trap));
  } catch {
    /* Proxy/console unavailable — leave false */
  }

  try {
    // Warm up to amortize V8 JIT and any cold-cache cost.
    for (let i = 0; i < 100; i++) con.log('warmup');

    const t0 = perf.now();
    for (let i = 0; i < N; i++) con.log('a');
    const t1 = perf.now();

    // Heavy loop is the highest-signal bucket — under CDP it takes ~60ms
    // for N=1000 console.log(heavyObj) calls, ~7ms without. That's the
    // window where a fake perf.now most visibly diverges from real wall
    // time. We bracket only this loop with the second clock to keep
    // overhead low.
    // Multi-clock bracket on the heaviest bucket. Each clock is on
    // independent infrastructure, so an attacker has to spoof all four
    // in lockstep to hide:
    //   perf.now    — patched by v4+ (replacement) and v5/6/7 (Proxy)
    //   Date.now    — patched by v7 (Proxy on the static)
    //   +new Date() — routes through DateConstructor::Construct, not
    //                 Date.now. v7 leaves it untouched. h04 validation.
    //   perf.measure(start, end).duration — uses C++ time captured at
    //                 mark-call, doesn't re-read perf.now at query time.
    let perfMark: ((name: string) => void) | undefined;
    try {
      perfMark = perf.mark.bind(perf);
    } catch {
      perfMark = undefined;
    }
    perfMark?.('arg-h-s');
    const t2 = perf.now();
    const d2 = dateNow();
    const w2 = +new win.Date();
    for (let i = 0; i < N; i++) con.log(HEAVY);
    const w3 = +new win.Date();
    const d3 = dateNow();
    const t3 = perf.now();
    perfMark?.('arg-h-e');

    const t4 = perf.now();
    for (let i = 0; i < N; i++) con.dir(HEAVY);
    const t5 = perf.now();

    // Math-only hardware anchor. CDP's Runtime.consoleAPICalled does not
    // intercept Math intrinsics; this number reflects pure V8/CPU
    // throughput. Server cross-checks log_*_us against this — a stubbed
    // bench has to pick values consistent with the device's actual CPU,
    // which it doesn't know in advance. The `if (mathAcc === Infinity)`
    // guard prevents V8 from dead-code-eliminating the loop body.
    let mathAcc = 0;
    const t6 = perf.now();
    for (let i = 0; i < M; i++) {
      mathAcc += Math.sqrt(i * 0.7) + Math.sin(i * 0.013);
    }
    const t7 = perf.now();
    if (mathAcc === Infinity) con.log('unreachable');

    const logTinyUs = ((t1 - t0) * 1000) / N;
    const logHeavyUs = ((t3 - t2) * 1000) / N;
    const dirHeavyUs = ((t5 - t4) * 1000) / N;
    const tlHeavyUs = ((d3 - d2) * 1000) / N;
    const wallHeavyUs = ((w3 - w2) * 1000) / N;
    const mathLoopUs = ((t7 - t6) * 1000) / M;

    // Resolve the measure() entry corresponding to the perfMark pair
    // bracketing the heavy loop. Skipped entirely if perf.mark wasn't
    // available, or if measure/getEntriesByName threw (some embedded
    // realms with cut-down Performance APIs).
    let measureHeavyUs: number | undefined;
    if (perfMark) {
      try {
        perf.measure('arg-h', 'arg-h-s', 'arg-h-e');
        const entries = perf.getEntriesByName('arg-h');
        const last = entries[entries.length - 1];
        if (last && Number.isFinite(last.duration)) {
          measureHeavyUs = round2((last.duration * 1000) / N);
        }
        perf.clearMarks('arg-h-s');
        perf.clearMarks('arg-h-e');
        perf.clearMeasures('arg-h');
      } catch {
        measureHeavyUs = undefined;
      }
    }

    return {
      log_tiny_us: round2(logTinyUs),
      log_heavy_us: round2(logHeavyUs),
      dir_heavy_us: round2(dirHeavyUs),
      tl_heavy_us: round2(tlHeavyUs),
      wall_heavy_us: round2(wallHeavyUs),
      measure_heavy_us: measureHeavyUs,
      math_loop_us: round2(mathLoopUs),
      heavy_over_tiny: round2(logHeavyUs / Math.max(logTinyUs, 0.01)),
      perf_now_native: perfNowNative,
      date_now_native: dateNowNative,
      con_log_native: conLogNative,
      con_dir_native: conDirNative,
      cdp_proto_proxy_trap: protoProxyTrapFired,
    };
  } catch {
    return undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
