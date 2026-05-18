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

export default function getConsoleTiming(): ConsoleTiming | undefined {
  if (!IS_BLINK) return undefined;
  const iframe = setupIframe();
  if (!iframe) return undefined;
  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
  if (!win) return undefined;
  const con = win.console;
  const perf = win.performance;
  if (!con || !perf) return undefined;

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
    };
  } catch {
    return undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
