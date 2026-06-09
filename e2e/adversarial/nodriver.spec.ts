import { join } from 'node:path';
import { homedir } from 'node:os';

import { test, expect } from '@playwright/test';
import {
  findVenvPython,
  runPythonBrowserRunner,
  fetchAdversarialRecord,
} from './helpers';

/**
 * nodriver — raw-CDP driver that enables the minimum domains and never
 * attaches the inspector to worker sessions. In the signal-lab matrix it
 * evaded every CDP-tell probe. This is a COVERAGE / telemetry spec, not a
 * pass/fail catch: it asserts a record landed and logs every CDP signal,
 * so the day a probe finally catches nodriver we'll see it here.
 *
 * Python-only and launches headed (needs a display) — skipped otherwise.
 */
const PY = findVenvPython([
  join(homedir(), 'Dev/ms-argus-signal-lab/.venv-stealth/bin/python'),
]);
const RUNNER = join(
  process.cwd(),
  'e2e/adversarial/runners/nodriver-runner.py',
);

test.describe('adversarial: nodriver (coverage)', () => {
  test.skip(!PY, 'nodriver venv not found (~/Dev/ms-argus-signal-lab/.venv-stealth)');
  test.skip(!process.env.DISPLAY, 'nodriver launches headed; no DISPLAY');

  test('records nodriver session and reports CDP-signal status', async () => {
    const sessionId = runPythonBrowserRunner(PY as string, RUNNER);
    const record = await fetchAdversarialRecord(sessionId);

    const dev = (record.device ?? {}) as Record<string, unknown>;
    const headless = (dev.headless ?? {}) as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cdp = (headless.cdp ?? {}) as Record<string, any>;
    const wmic = (cdp.workerModuleImportChain ?? {}) as {
      cdp_shaped?: boolean;
      ratio?: number;
      per_import_us?: number;
    };
    const consoleTiming = (cdp.consoleTiming ?? {}) as { log_heavy_us?: number };
    const consoleTimingWorker = (cdp.consoleTimingWorker ?? {}) as {
      log_heavy_us?: number;
    };
    const lies = (dev.lies ?? {}) as { totalLies?: number };

    const caught =
      wmic.cdp_shaped === true ||
      Math.min(
        consoleTiming.log_heavy_us ?? 0,
        consoleTimingWorker.log_heavy_us ?? 0,
      ) > 40 ||
      ((headless.likeHeadlessRating as number) ?? 0) > 0 ||
      (lies.totalLies ?? 0) > 0;

    console.log('nodriver result:', {
      sessionId,
      caught,
      workerModuleImportChain: wmic,
      consoleHeavyUs: {
        iframe: consoleTiming.log_heavy_us,
        worker: consoleTimingWorker.log_heavy_us,
      },
      headlessRating: headless.likeHeadlessRating,
      totalLies: lies.totalLies,
    });
    console.log(
      caught
        ? 'nodriver: DETECTED — a probe now catches it; update the known-gap notes.'
        : 'nodriver: evaded (expected per signal-lab matrix).',
    );

    expect(sessionId, 'Should get a session ID').toBeTruthy();
    expect(record, 'nodriver session should be stored').toBeTruthy();
  });
});
