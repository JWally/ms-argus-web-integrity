import { test, expect } from '@playwright/test';
import { fetchAdversarialRecord } from './helpers';

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
  }) => {
    // addInitScript runs on EVERY frame including the loader's srcdoc
    // iframe, so the spoof lands in the collection realm. More
    // pessimistic than a real bot (which can't reach into a child
    // srcdoc), but tests that the lies scanner catches the patch
    // regardless of which realm it was applied in.
    await page.addInitScript(SPOOF_SCRIPT);

    await page.goto('/test-loader.html');

    // Wait for loader to register window.argus
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof (window as unknown as { argus?: unknown }).argus ===
            'object',
        ),
      )
      .toBeTruthy();

    const cpi = process.env.ARGUS_TEST_CPI;
    const result = await page.evaluate(
      async ({ c }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const argus = (window as any).argus;
        return (await argus.run({
          sessionId: `naive-${Date.now()}`,
          timeoutMs: 30_000,
          cpi: c,
        })) as { sessionId: string; argusSessionId: string; durationMs: number };
      },
      { c: cpi },
    );

    const record = await fetchAdversarialRecord(result.argusSessionId);
    const dev = (record.device ?? {}) as Record<string, unknown>;
    const lies = (dev.lies ?? {}) as {
      totalLies?: number;
      data?: Record<string, unknown>;
    };
    const headless = (dev.headless ?? {}) as Record<string, unknown>;

    console.log('Naive spoofing result:', {
      sessionId: result.argusSessionId,
      totalLies: lies.totalLies,
      liesData: lies.data ? Object.keys(lies.data) : [],
      headlessRating: headless.likeHeadlessRating,
    });

    // Session landed
    expect(result.argusSessionId, 'Should get a session ID').toBeTruthy();

    // Lies scanner should catch the defineProperty tampering
    expect(
      lies.totalLies,
      'Lie scanner should detect navigator property tampering',
    ).toBeGreaterThan(0);

    // Headless signals should still fire (Playwright is headless)
    expect(
      headless.likeHeadlessRating as number,
      'Should still detect headless signals',
    ).toBeGreaterThan(0);
  });
});
