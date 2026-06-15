/**
 * Worker-isolated CDP timing bench.
 *
 * **What this adds over `getConsoleTiming`.** The iframe bench in
 * `getConsoleTiming.ts` runs on the main thread inside a srcdoc-style
 * shadow-hosted iframe. Two attacks have made it through historical
 * red-team rounds:
 *
 *   1. **Function-replacement.** Patch `console.log` / `console.dir` /
 *      `Performance.prototype.now` in the parent realm before the bench
 *      runs. Each iteration of this attack has been closed with native
 *      shape + behavioral checks (toString matches `[native code]`,
 *      `fn.call({})` throws Illegal invocation, etc.) — but the cost is
 *      a cat-and-mouse loop, and a v7-class Proxy-with-validation attack
 *      remained open as of 2026-05-19.
 *
 *   2. **Bundle rewrite.** An attacker with `page.route` (Playwright,
 *      Puppeteer, mitmproxy) intercepts the integrity bundle in flight
 *      and replaces `function getConsoleTiming(){` with a stub that
 *      returns clean numbers. One regex defeats the whole oracle.
 *
 * The worker bench closes both:
 *
 *   - The bench runs in a Worker realm. Main-thread patches on
 *     `Element.prototype`, `console.*`, or `Performance.*` don't apply
 *     — the worker creates its own `console`, `performance`, `Date`
 *     when its global scope is initialized.
 *
 *   - The worker source is delivered via `URL.createObjectURL(blob)`.
 *     `blob:` URLs are browser-internal — `page.route` cannot intercept
 *     them (Playwright/Puppeteer have no hook for blob fetch). To
 *     replace the source the attacker has to either wrap the `Worker`
 *     constructor with a Proxy whose construct trap injects a stub
 *     (detectable via the lie scanner's coverage of `Worker`) or wrap
 *     `URL.createObjectURL` and rewrite the blob's bytes (much higher
 *     engineering cost than a one-line route handler).
 *
 * **Hardware anchor.** The worker also reports `math_loop_us`, µs/iter
 * of a `Math.sqrt + Math.sin` loop. CDP's `Runtime.consoleAPICalled`
 * does not intercept Math intrinsics, so this number reflects pure
 * V8/CPU throughput. The server cross-checks `log_*_us` against this
 * value and against the device's `hardwareConcurrency` /
 * `deviceMemory` — a stubbed bench has to pick numbers consistent with
 * an unknown CPU, which is hard to do plausibly.
 *
 * **Cross-check with iframe bench.** Both `consoleTiming` (iframe) and
 * `consoleTimingWorker` (this) are submitted when available. The
 * server expects them to agree on `math_loop_us` (same CPU) and
 * agree-or-both-trigger on `heavy_over_tiny` (same CDP state). Any
 * single-path stub leaves the other intact, and the disagreement
 * itself flags as automation regardless of which side reads "clean".
 *
 * **Lighthouse-safe.** Worker spawn + postMessage on the main thread
 * cost ~5-15ms total. The 4000+ `console.log` calls and math loop run
 * in the worker thread, parallel to main. No long task is generated
 * on the main thread.
 *
 * **Blink-only.** Same as the iframe bench — V8's inspector is what
 * makes the `console.log` cost scale with structural complexity.
 * Firefox/WebKit use different debugger protocols and the bench is
 * undefined on them.
 */

import { IS_BLINK } from '../utils/helpers';

import type { ConsoleTiming } from './types';

/**
 * Timeout for the worker bench. Real-Chrome with no CDP finishes in
 * ~15-30ms. Playwright + CDP can stretch the heavy loop to ~60ms.
 * Worker startup adds ~5-20ms. 1500ms gives generous slack while
 * keeping the total collect time bounded.
 */
const TIMEOUT_MS = 1500;

/**
 * Inline worker script. Runs in the worker's own realm — no imports
 * (blob workers don't have access to module resolution by default,
 * and we don't want to depend on `type: 'module'` worker support).
 *
 * The shape returned in `e.data.timing` must match `ConsoleTiming`.
 * Field names are stable across both bench paths so the server can
 * compare iframe and worker results directly.
 */
const WORKER_SCRIPT = `
const N = 1000;
const M = 5000;
const HEAVY = {
  l1: { l2: { l3: { l4: [1, 2, 3, 4, 5, 'abc', true, null] } } },
  other: { a: 1, b: 2, c: 3, d: 'hello', arr: [10, 20, 30] },
};
const NESTED_ITERS = 180;
const NATIVE_RE = /\\{\\s*\\[native code\\]\\s*\\}/;

function isNativeFn(fn) {
  if (typeof fn !== 'function') return false;
  try { return NATIVE_RE.test(self.Function.prototype.toString.call(fn)); }
  catch { return false; }
}

function isNativeMethodValidatesThis(fn) {
  if (!isNativeFn(fn)) return false;
  try { fn.call({}); return false; }
  catch (e) { return e instanceof self.TypeError; }
}

// The v3-closure scan for console.* tampering — moved out of the
// main-thread lie scanner (where it false-positived 5×11 = 55 lies per
// CriOS session via Google's iOS analytics shim) and into the worker
// realm. Engine gating is implicit: getConsoleTimingWorker bails on
// !IS_BLINK before ever spawning a worker, so this code never runs on
// WebKit-based browsers (Safari, CriOS, Brave iOS, etc.) where wrapped
// console.* is a legitimate app-shim signature, not bot patching.
//
// Probes mirror the main-scanner's 11-deep checks against each method
// but dedupe at emission: ≥1 failure on a method counts that method as
// one lie, not eleven. The returned count is the number of wrapped
// console methods in this realm. Real Chrome worker: 0. Patched (the
// only path being attacker-injected source via Worker / Blob /
// URL.createObjectURL wrapping): ≥1.
function probeConsoleMethod(method) {
  if (typeof method !== 'function') return true;
  try {
    if (!NATIVE_RE.test(self.Function.prototype.toString.call(method))) {
      return true;
    }
  } catch { return true; }
  // Native bound methods don't have an own 'prototype' property —
  // 'prototype' in console.log is false. A function wrapper has one.
  try {
    if ('prototype' in method) return true;
  } catch { return true; }
  // Native methods are not constructable. \`new console.log()\` should
  // throw a TypeError. A wrapper that forgot a construct trap or that
  // shadowed with a plain function will silently accept the call.
  try {
    new method();
    return true;
  } catch (e) {
    if (!(e instanceof self.TypeError)) return true;
  }
  return false;
}

function countConsoleLies(con) {
  if (!con) return 0;
  let n = 0;
  const methods = ['log', 'warn', 'error', 'info', 'debug', 'dir'];
  for (const name of methods) {
    if (probeConsoleMethod(con[name])) n++;
  }
  return n;
}

function round2(n) { return Math.round(n * 100) / 100; }

function buildNested() {
  let nested = { v: 1 };
  for (let i = 0; i < 20; i++) {
    nested = { c: nested, i, s: 'x'.repeat(32) };
  }
  return nested;
}

try {
  const con = self.console;
  const perf = self.performance;
  const dateNow = self.Date.now;

  const perfNowNative = isNativeMethodValidatesThis(
    self.Performance && self.Performance.prototype && self.Performance.prototype.now
  );
  const dateNowNative = isNativeFn(self.Date && self.Date.now);
  const conLogNative = isNativeFn(con && con.log);
  const conDirNative = isNativeFn(con && con.dir);
  const consoleLies = countConsoleLies(con);

  // CDP-attachment tripwire in the worker realm: prototype-chain Proxy
  // ownKeys trap. Fires only when a CDP consumer builds a preview and
  // walks the prototype chain. Patchright/Puppeteer attach worker
  // sessions too, so the worker copy catches worker-scope inspectors.
  let protoProxyTrapFired = false;
  try {
    const trap = new self.Proxy({}, {
      ownKeys() { protoProxyTrapFired = true; return []; },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
    });
    con.debug(self.Object.create(trap));
  } catch (_) { /* leave false */ }

  for (let i = 0; i < 100; i++) con.log('warmup');

  const t0 = perf.now();
  for (let i = 0; i < N; i++) con.log('a');
  const t1 = perf.now();

  // Multi-clock bracket (matches getConsoleTiming.ts iframe bench).
  // Worker realm is already resistant to main-thread addInitScript
  // patches (init scripts don't propagate), but the same four-clock
  // schema keeps payload parity and catches attackers who also patch
  // inside the worker via wrapped Worker/Blob/URL.createObjectURL.
  let perfMark;
  try { perfMark = perf.mark.bind(perf); } catch (_) { perfMark = undefined; }
  if (perfMark) perfMark('arg-h-s');
  const t2 = perf.now();
  const d2 = dateNow();
  const w2 = +new self.Date();
  for (let i = 0; i < N; i++) con.log(HEAVY);
  const w3 = +new self.Date();
  const d3 = dateNow();
  const t3 = perf.now();
  if (perfMark) perfMark('arg-h-e');

  const t4 = perf.now();
  for (let i = 0; i < N; i++) con.dir(HEAVY);
  const t5 = perf.now();

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

  const nested = buildNested();
  for (let i = 0; i < 30; i++) {
    con.log();
    con.log(nested);
  }

  if (perfMark) perfMark('arg-n-empty-s');
  const neWallStart = +new self.Date();
  const nePerfStart = perf.now();
  for (let i = 0; i < NESTED_ITERS; i++) con.log();
  const nePerfEnd = perf.now();
  const neWallEnd = +new self.Date();
  if (perfMark) perfMark('arg-n-empty-e');

  if (perfMark) perfMark('arg-n-heavy-s');
  const nhWallStart = +new self.Date();
  const nhPerfStart = perf.now();
  for (let i = 0; i < NESTED_ITERS; i++) con.log(nested);
  const nhPerfEnd = perf.now();
  const nhWallEnd = +new self.Date();
  if (perfMark) perfMark('arg-n-heavy-e');

  const nestedEmptyWall = neWallEnd - neWallStart;
  const nestedHeavyWall = nhWallEnd - nhWallStart;
  const nestedEmptyPerf = nePerfEnd - nePerfStart;
  const nestedHeavyPerf = nhPerfEnd - nhPerfStart;
  let nestedEmptyMeasureUs;
  let nestedHeavyMeasureUs;
  if (perfMark) {
    try {
      perf.measure('arg-n-empty', 'arg-n-empty-s', 'arg-n-empty-e');
      const emptyEntries = perf.getEntriesByName('arg-n-empty');
      const emptyLast = emptyEntries[emptyEntries.length - 1];
      if (emptyLast && Number.isFinite(emptyLast.duration)) {
        nestedEmptyMeasureUs = round2(
          (emptyLast.duration * 1000) / NESTED_ITERS,
        );
      }
      perf.clearMarks('arg-n-empty-s');
      perf.clearMarks('arg-n-empty-e');
      perf.clearMeasures('arg-n-empty');
    } catch (_) {
      nestedEmptyMeasureUs = undefined;
    }
    try {
      perf.measure('arg-n-heavy', 'arg-n-heavy-s', 'arg-n-heavy-e');
      const heavyEntries = perf.getEntriesByName('arg-n-heavy');
      const heavyLast = heavyEntries[heavyEntries.length - 1];
      if (heavyLast && Number.isFinite(heavyLast.duration)) {
        nestedHeavyMeasureUs = round2(
          (heavyLast.duration * 1000) / NESTED_ITERS,
        );
      }
      perf.clearMarks('arg-n-heavy-s');
      perf.clearMarks('arg-n-heavy-e');
      perf.clearMeasures('arg-n-heavy');
    } catch (_) {
      nestedHeavyMeasureUs = undefined;
    }
  }

  let measureHeavyUs;
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
    } catch (_) {
      measureHeavyUs = undefined;
    }
  }

  self.postMessage({
    ok: true,
    timing: {
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
      console_lies: consoleLies,
      nested_worker_heavy_us: round2(
        (nestedHeavyWall * 1000) / NESTED_ITERS,
      ),
      nested_worker_empty_us: round2(
        (nestedEmptyWall * 1000) / NESTED_ITERS,
      ),
      nested_worker_delta_us: round2(
        ((nestedHeavyWall - nestedEmptyWall) * 1000) / NESTED_ITERS,
      ),
      nested_worker_heavy_perf_us: round2(
        (nestedHeavyPerf * 1000) / NESTED_ITERS,
      ),
      nested_worker_empty_perf_us: round2(
        (nestedEmptyPerf * 1000) / NESTED_ITERS,
      ),
      nested_worker_heavy_measure_us: nestedHeavyMeasureUs,
      nested_worker_empty_measure_us: nestedEmptyMeasureUs,
      nested_worker_heavy_lie_ms: round2(nestedHeavyWall - nestedHeavyPerf),
      nested_worker_empty_lie_ms: round2(nestedEmptyWall - nestedEmptyPerf),
      nested_worker_iters: NESTED_ITERS,
    },
  });
} catch (_e) {
  try { self.postMessage({ ok: false }); } catch (_) {}
}
`;

export default function getConsoleTimingWorker(): Promise<
  ConsoleTiming | undefined
> {
  return new Promise((resolve) => {
    if (!IS_BLINK) return resolve(undefined);

    let worker: Worker | null = null;
    let blobUrl: string | null = null;
    let settled = false;

    const settle = (v: ConsoleTiming | undefined) => {
      if (settled) return;
      settled = true;
      try {
        worker?.terminate();
      } catch {
        /* worker not constructable on this CSP — no terminate to do */
      }
      try {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      } catch {
        /* createObjectURL may have been patched / blocked */
      }
      resolve(v);
    };

    const timer = setTimeout(() => settle(undefined), TIMEOUT_MS);

    try {
      blobUrl = URL.createObjectURL(
        new Blob([WORKER_SCRIPT], { type: 'application/javascript' }),
      );
      worker = new Worker(blobUrl);
      worker.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        const data = e.data as
          | { ok: true; timing: ConsoleTiming }
          | { ok: false }
          | undefined;
        if (data && data.ok && data.timing) {
          settle(data.timing);
        } else {
          settle(undefined);
        }
      };
      worker.onerror = () => {
        clearTimeout(timer);
        settle(undefined);
      };
    } catch {
      clearTimeout(timer);
      settle(undefined);
    }
  });
}
