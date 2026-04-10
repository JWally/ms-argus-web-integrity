import { test, expect } from '@playwright/test';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { runIntegrityPuppeteer, verifyServerSession } from './helpers';

puppeteerExtra.use(StealthPlugin());

test.describe('adversarial: puppeteer-stealth', () => {
  test('detects stealth plugin evasion artifacts', async ({ request }) => {
    const browser = await puppeteerExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      const result = await runIntegrityPuppeteer(page);
      const fp = result.fingerprint;

      console.log('Puppeteer-stealth result:', {
        sessionId: result.sessionId,
        tampered: result.tampered,
        vmSignals: result.vmSignals,
        headlessRating: fp.headless?.likeHeadlessRating,
        stealthRating: fp.headless?.stealthRating,
        headlessSignals: fp.headless?.headless,
        stealthSignals: fp.headless?.stealth,
        totalLies: fp.lies?.totalLies,
      });

      // Session should be accepted by server
      expect(result.sessionId, 'Should get a session ID').toBeTruthy();

      // Stealth plugin should leave detectable artifacts.
      // At least one of these should be true:
      const stealth = fp.headless?.stealth ?? {};
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
      const liesDetected = (fp.lies?.totalLies ?? 0) > 0;
      const headlessDetected = (fp.headless?.likeHeadlessRating ?? 0) > 0;

      expect(
        stealthDetected || liesDetected || headlessDetected,
        `Stealth should be detected via at least one signal. ` +
        `stealth=${JSON.stringify(stealth)}, lies=${fp.lies?.totalLies}, headlessRating=${fp.headless?.likeHeadlessRating}`,
      ).toBe(true);

      // Server-side verification
      await verifyServerSession(result.sessionId, request);
    } finally {
      await browser.close();
    }
  });
});
