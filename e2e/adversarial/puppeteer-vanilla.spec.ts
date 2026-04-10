import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, verifyServerSession } from './helpers';

test.describe('adversarial: vanilla puppeteer', () => {
  test('detects headless puppeteer without evasion', async ({ request }) => {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      const result = await runIntegrityPuppeteer(page);
      const fp = result.fingerprint;

      console.log('Vanilla Puppeteer result:', {
        sessionId: result.sessionId,
        tampered: result.tampered,
        vmSignals: result.vmSignals,
        headlessRating: fp.headless?.likeHeadlessRating,
        stealthRating: fp.headless?.stealthRating,
        totalLies: fp.lies?.totalLies,
      });

      // Session should be accepted by server
      expect(result.sessionId, 'Should get a session ID').toBeTruthy();

      // Headless detection
      expect(fp.headless, 'headless detection should run').toBeTruthy();
      expect(
        fp.headless.headless?.webDriverIsOn,
        'navigator.webdriver should be detected',
      ).toBe(true);
      expect(
        fp.headless.likeHeadlessRating,
        'should trigger headless soft signals',
      ).toBeGreaterThan(0);

      // VM should detect webdriver
      expect(result.vmSignals).toContain('vm:webdriver');
      expect(result.tampered).toBe(true);

      // Server-side verification
      await verifyServerSession(result.sessionId, request);
    } finally {
      await browser.close();
    }
  });
});
