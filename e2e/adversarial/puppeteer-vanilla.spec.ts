import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

test.describe('adversarial: vanilla puppeteer', () => {
  test('detects headless puppeteer without evasion', async ({ browserName }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void browserName;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      const result = await runIntegrityPuppeteer(page);

      // Fetch the server-stored record — all fingerprint assertions live
      // here now. No fingerprint data reaches the parent-realm test
      // context (loader returns only {argusSessionId, sessionId,
      // durationMs}), so we read from DDB.
      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;

      console.log('Vanilla Puppeteer result:', {
        sessionId: result.argusSessionId,
        headlessRating: headless.likeHeadlessRating,
        stealthRating: headless.stealthRating,
        totalLies: (dev.lies as { totalLies?: number } | undefined)?.totalLies,
      });

      // Session landed
      expect(result.argusSessionId, 'Should get a session ID').toBeTruthy();

      // Headless module ran
      expect(headless, 'headless detection should run').toBeTruthy();
      expect(
        (headless.headless as { webDriverIsOn?: boolean } | undefined)
          ?.webDriverIsOn,
        'navigator.webdriver should be detected',
      ).toBe(true);
      expect(
        headless.likeHeadlessRating as number,
        'should trigger headless soft signals',
      ).toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  });
});
