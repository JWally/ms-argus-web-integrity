import { join } from 'node:path';
import { homedir } from 'node:os';

import { test, expect } from '@playwright/test';
import {
  findVenvPython,
  runPythonBrowserRunner,
  fetchAdversarialRecord,
} from './helpers';

/**
 * CloakBrowser — Chromium binary fork (~58 C++ stealth patches) driven
 * over CDP. The source-level patches hide the user-space tells, but the
 * inspector still attaches to worker sessions, so the module-worker
 * import-chain probe catches it (signal-lab matrix: 2.45-2.78x, caught;
 * it actually shows MORE inspector activity than vanilla).
 *
 * Python-only and launches headed (needs a display) — skipped otherwise.
 */
const PY = findVenvPython([
  join(homedir(), 'Dev/ms-argus-signal-lab/.venv-stealth/bin/python'),
]);
const RUNNER = join(
  process.cwd(),
  'e2e/adversarial/runners/cloakbrowser-runner.py',
);

test.describe('adversarial: cloakbrowser', () => {
  test.skip(!PY, 'cloakbrowser venv not found (~/Dev/ms-argus-signal-lab/.venv-stealth)');
  test.skip(!process.env.DISPLAY, 'cloakbrowser launches headed; no DISPLAY');

  test('detects cloakbrowser via CDP worker-attach residue', async () => {
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
      reps?: number;
    };
    const consoleTiming = (cdp.consoleTiming ?? {}) as { log_heavy_us?: number };
    const consoleTimingWorker = (cdp.consoleTimingWorker ?? {}) as {
      log_heavy_us?: number;
    };
    const lies = (dev.lies ?? {}) as { totalLies?: number };

    console.log('CloakBrowser result:', {
      sessionId,
      workerModuleImportChain: wmic,
      consoleHeavyUs: {
        iframe: consoleTiming.log_heavy_us,
        worker: consoleTimingWorker.log_heavy_us,
      },
      headlessRating: headless.likeHeadlessRating,
      totalLies: lies.totalLies,
    });

    expect(sessionId, 'Should get a session ID').toBeTruthy();

    const moduleCaught = wmic.cdp_shaped === true;
    const consoleCaught =
      Math.min(
        consoleTiming.log_heavy_us ?? 0,
        consoleTimingWorker.log_heavy_us ?? 0,
      ) > 40;
    const headlessCaught =
      ((headless.likeHeadlessRating as number) ?? 0) > 0;
    const liesCaught = (lies.totalLies ?? 0) > 0;

    expect(
      moduleCaught || consoleCaught || headlessCaught || liesCaught,
      `CloakBrowser should be detected via >=1 CDP signal. ` +
        `wmic=${JSON.stringify(wmic)}`,
    ).toBe(true);
  });
});
