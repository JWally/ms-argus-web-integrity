import { describe, expect, it } from 'vitest';

import { measureDebugVsPerf } from './consoleTimingMetrics';

function makeScope(opts: {
  perfCostMs: number;
  debugCostMs: number;
  hasDebug?: boolean;
}) {
  let now = 0;
  const perf = {
    now: () => {
      now += opts.perfCostMs;
      return now;
    },
  };
  const con =
    opts.hasDebug === false
      ? {}
      : {
          debug: () => {
            now += opts.debugCostMs;
          },
        };
  return { console: con, performance: perf } as unknown as Window &
    typeof globalThis;
}

describe('measureDebugVsPerf', () => {
  it('reports the self-calibrated empty-console/debug-to-performance ratio', () => {
    const timing = measureDebugVsPerf(
      makeScope({ perfCostMs: 0.001, debugCostMs: 0.02 }),
      100,
    );

    expect(timing).toEqual({
      debug_empty_us: 20.01,
      perf_now_call_us: 1.01,
      debug_over_perf: 19.81,
      debug_iters: 100,
    });
  });

  it('returns undefined when console.debug is unavailable', () => {
    expect(
      measureDebugVsPerf(
        makeScope({ perfCostMs: 0.001, debugCostMs: 0.02, hasDebug: false }),
        100,
      ),
    ).toBeUndefined();
  });
});
