import { test, expect } from '@playwright/test';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

puppeteerExtra.use(StealthPlugin());

test.describe('adversarial: puppeteer-stealth', () => {
  test('detects stealth plugin evasion artifacts', async () => {
    const browser = await puppeteerExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      const result = await runIntegrityPuppeteer(page);

      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const stealth = (headless.stealth ?? {}) as Record<string, boolean>;
      const lies = (dev.lies ?? {}) as { totalLies?: number };

      console.log('Puppeteer-stealth result:', {
        sessionId: result.argusSessionId,
        headlessRating: headless.likeHeadlessRating,
        stealthRating: headless.stealthRating,
        headlessSignals: headless.headless,
        stealthSignals: stealth,
        totalLies: lies.totalLies,
      });

      expect(result.argusSessionId, 'Should get a session ID').toBeTruthy();

      // Stealth plugin should leave detectable artifacts — any one path
      // is sufficient; we just need detection to fire.
      const stealthSignals = [
        stealth.hasToStringProxy,
        stealth.hasBadChromeRuntime,
        stealth.missingLoadTimes,
        stealth.missingCsi,
        stealth.incompleteAppSurface,
        stealth.hasHighChromeIndex,
        stealth.hasBadWebGL,
      ];
      const stealthDetected = stealthSignals.some(Boolean);
      const liesDetected = (lies.totalLies ?? 0) > 0;
      const headlessDetected =
        ((headless.likeHeadlessRating as number) ?? 0) > 0;

      expect(
        stealthDetected || liesDetected || headlessDetected,
        `Stealth should be detected via at least one signal. ` +
          `stealth=${JSON.stringify(stealth)}, lies=${lies.totalLies}, ` +
          `headlessRating=${headless.likeHeadlessRating}`,
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
