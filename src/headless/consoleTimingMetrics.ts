export interface DebugVsPerfTiming {
  /** µs/call for `console.debug("")` over `debug_iters` calls. */
  debug_empty_us: number;
  /** µs/call for `performance.now()` over `debug_iters` calls. */
  perf_now_call_us: number;
  /** `debug_empty_us / perf_now_call_us`; self-calibrated CDP console tax. */
  debug_over_perf: number;
  /** Iteration count used for both debug and performance.now loops. */
  debug_iters: number;
}

const DEFAULT_DEBUG_ITERS = 3000;

export function measureDebugVsPerf(
  scope: Window & typeof globalThis,
  iterations: number = DEFAULT_DEBUG_ITERS,
): DebugVsPerfTiming | undefined {
  const con = scope.console;
  const perf = scope.performance;
  if (!con || typeof con.debug !== 'function' || !perf) return undefined;

  try {
    const p0 = perf.now();
    for (let i = 0; i < iterations; i++) perf.now();
    const p1 = perf.now();

    const d0 = perf.now();
    for (let i = 0; i < iterations; i++) con.debug('');
    const d1 = perf.now();

    const perfNowCallUs = ((p1 - p0) * 1000) / iterations;
    const debugEmptyUs = ((d1 - d0) * 1000) / iterations;
    return {
      debug_empty_us: round2(debugEmptyUs),
      perf_now_call_us: round2(perfNowCallUs),
      debug_over_perf: round2(debugEmptyUs / Math.max(perfNowCallUs, 0.01)),
      debug_iters: iterations,
    };
  } catch {
    return undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
