import { test, expect } from '@playwright/test';
import { verifyServerSession } from './helpers';

const SPOOF_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
`;

test.describe('adversarial: naive navigator spoofing', () => {
  test('lies scanner catches Object.defineProperty tampering', async ({
    page,
    request,
  }) => {
    // Inject spoofing before any page JS runs
    await page.addInitScript(SPOOF_SCRIPT);

    await page.goto('/test-integrity.html');
    await expect(page.locator('#status')).toHaveText('idle');

    await page.evaluate(() => (window as any).__runIntegrity());
    await expect(page.locator('#status')).not.toHaveText('running', {
      timeout: 30_000,
    });

    const status = await page.locator('#status').textContent();
    const resultText = await page.locator('#result').textContent();
    expect(status).not.toBe('error');

    const result = JSON.parse(resultText!);
    const fp = result.fingerprint;

    console.log('Naive spoofing result:', {
      sessionId: result.sessionId,
      tampered: result.tampered,
      vmSignals: result.vmSignals,
      totalLies: fp.lies?.totalLies,
      liesData: fp.lies?.data ? Object.keys(fp.lies.data) : [],
      headlessRating: fp.headless?.likeHeadlessRating,
    });

    // Session should still work (server accepts spoofed sessions too)
    expect(result.sessionId, 'Should get a session ID').toBeTruthy();

    // Lies scanner should catch the defineProperty tampering
    expect(
      fp.lies?.totalLies,
      'Lie scanner should detect navigator property tampering',
    ).toBeGreaterThan(0);

    // Headless signals should still fire (Playwright is headless)
    expect(
      fp.headless?.likeHeadlessRating,
      'Should still detect headless signals',
    ).toBeGreaterThan(0);

    // Server-side verification
    await verifyServerSession(result.sessionId, request);
  });
});
