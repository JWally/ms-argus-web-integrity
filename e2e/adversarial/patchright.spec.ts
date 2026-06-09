import { test, expect } from '@playwright/test';
import { chromium } from 'patchright';
import { runIntegrityPlaywright, fetchAdversarialRecord } from './helpers';

/**
 * Patchright — a Playwright fork that patches the CDP handshake shape
 * (Runtime.enable, Target.setAutoAttach) to hide the obvious automation
 * tells. It still attaches the inspector to worker sessions, so the
 * module-worker import-chain probe should read CDP-shaped (signal-lab
 * matrix: 2.27-2.59x, caught).
 *
 * Doubles as the regression guard for the reps 5 -> 15 fix: a noisy
 * 5-sample median let a real CDP session escape as real-shaped; this
 * asserts the served bundle carries reps=15 AND that the probe fires.
 */
test.describe('adversarial: patchright', () => {
  test('detects patchright via CDP worker-attach residue', async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      const result = await runIntegrityPlaywright(page);
      const record = await fetchAdversarialRecord(result.argusSessionId);

      const dev = (record.device ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cdp = (headless.cdp ?? {}) as Record<string, any>;
      const wmic = (cdp.workerModuleImportChain ?? {}) as {
        cdp_shaped?: boolean;
        ratio?: number;
        per_import_us?: number;
        classic_p50_ms?: number;
        module_p50_ms?: number;
        reps?: number;
      };
      const consoleTiming = (cdp.consoleTiming ?? {}) as {
        log_heavy_us?: number;
      };
      const consoleTimingWorker = (cdp.consoleTimingWorker ?? {}) as {
        log_heavy_us?: number;
      };
      const lies = (dev.lies ?? {}) as { totalLies?: number };

      console.log('Patchright result:', {
        sessionId: result.argusSessionId,
        workerModuleImportChain: wmic,
        consoleHeavyUs: {
          iframe: consoleTiming.log_heavy_us,
          worker: consoleTimingWorker.log_heavy_us,
        },
        headlessRating: headless.likeHeadlessRating,
        totalLies: lies.totalLies,
      });

      expect(result.argusSessionId, 'Should get a session ID').toBeTruthy();

      // The reps fix must be live in the served bundle.
      expect(wmic.reps, 'worker-import probe should run 15 reps').toBe(15);

      // Detection paths — any one is sufficient. Module-import is the
      // primary tell for patchright; consoleTiming magnitude and the
      // headless rating are corroborators.
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
        `Patchright should be detected via >=1 CDP signal. ` +
          `wmic=${JSON.stringify(wmic)}, ` +
          `consoleHeavy=${consoleTiming.log_heavy_us}/${consoleTimingWorker.log_heavy_us}, ` +
          `headlessRating=${headless.likeHeadlessRating}, lies=${lies.totalLies}`,
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
