import { test, expect } from '@playwright/test';

const API_BASE = 'https://api-dev-jw.argus.pw';
const API_KEY =
  process.env.INTEGRITY_API_KEY ??
  'ak_integrity_e06efb721ca47390a521bf7934c82c540fd3416f0e515a733e73d2a0c89c10a9';

test.describe('integrity VM end-to-end', () => {
  test('collects fingerprint, runs VM, server decrypts and stores payload', async ({
    page,
    request,
    browserName,
  }) => {
    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') consoleErrors.push(text);
      consoleLogs.push(`[${msg.type()}] ${text}`);
    });

    await page.goto('/test-integrity.html');
    await expect(page.locator('#status')).toHaveText('idle');

    // Run the integrity flow
    await page.evaluate(() => (window as any).__runIntegrity());

    // Wait for completion (up to 30s for slow network)
    await expect(page.locator('#status')).not.toHaveText('running', {
      timeout: 30_000,
    });

    const status = await page.locator('#status').textContent();
    const resultText = await page.locator('#result').textContent();

    // Dump console for debugging
    console.log('\n--- Browser console ---');
    for (const line of consoleLogs) console.log(line);
    console.log('--- End console ---\n');

    // VM must not throw "Execution limit exceeded"
    const hasExecLimit = consoleErrors.some((e) =>
      e.includes('Execution limit exceeded'),
    );
    expect(hasExecLimit, 'VM hit execution limit').toBe(false);

    // VM must not throw any uncaught errors
    expect(status, `status was "${status}", result: ${resultText}`).not.toBe(
      'error',
    );

    // Parse the client-side result
    const clientResult = JSON.parse(resultText!);
    console.log('Client VM result:', {
      sessionId: clientResult.sessionId,
      tampered: clientResult.tampered,
      vmSignals: clientResult.vmSignals,
      vmHash: clientResult.vmHash,
    });

    // ── A. VM result basics ──────────────────────────────────────────
    expect(
      clientResult.sessionId,
      'Server should return a session ID (decryption succeeded)',
    ).toBeTruthy();
    expect(clientResult.vmHash).toBeTruthy();
    expect(typeof clientResult.tampered).toBe('boolean');
    expect(Array.isArray(clientResult.vmSignals)).toBe(true);

    // ── B. Fingerprint structure ─────────────────────────────────────
    const fp = clientResult.fingerprint;
    expect(fp, 'fingerprint should be present in result').toBeTruthy();

    // Meta
    expect(fp.meta.durationMs).toBeGreaterThan(0);
    expect(fp.meta.durationMs).toBeLessThan(10_000);
    expect(fp.meta.timestamp).toBeGreaterThan(0);

    // Engine detection ran
    expect(fp.engine, 'engine detection should produce a result').toBeTruthy();

    // Navigator
    expect(fp.navigator, 'navigator should be collected').toBeTruthy();
    expect(fp.navigator.userAgent).toBeTruthy();

    // Timezone
    expect(fp.timezone, 'timezone should be collected').toBeTruthy();

    // Screen
    expect(fp.screen, 'screen should be collected').toBeTruthy();

    // CSS media
    expect(fp.cssMedia, 'cssMedia should be collected').toBeTruthy();
    expect(fp.cssMedia.matchMediaCSS).toBeTruthy();
    expect(fp.cssMedia.mediaCSS).toBeTruthy();

    // Lies scanner
    expect(fp.lies, 'lies scanner should produce a result').toBeTruthy();
    expect(typeof fp.lies.totalLies).toBe('number');

    // Headless detection
    expect(fp.headless, 'headless detection should produce a result').toBeTruthy();
    expect(fp.headless.likeHeadless, 'likeHeadless signals should be an object').toBeTruthy();
    expect(typeof fp.headless.likeHeadlessRating).toBe('number');
    // Playwright IS headless — rating should be non-zero (some signals fire)
    expect(
      fp.headless.likeHeadlessRating,
      'Playwright should trigger some headless signals',
    ).toBeGreaterThan(0);

    // Trash / gibberish detection
    expect(fp.trash, 'trash detection should produce a result').toBeTruthy();

    // Worker scope
    // Workers may not be available in all Playwright browsers, so just check structure
    if (fp.workerScope) {
      expect(fp.workerScope.best).toBeTruthy();
    }

    // ── C. WebRTC ────────────────────────────────────────────────────
    if (browserName === 'chromium' || browserName === 'firefox') {
      // WebRTC should work in Chromium and Firefox under Playwright
      expect(fp.webrtc, `webrtc should be collected in ${browserName}`).toBeTruthy();
      expect(fp.webrtc.extensions, 'RTP extensions should be an array').toBeInstanceOf(Array);
      expect(fp.webrtc.extensions.length, 'should have RTP extensions').toBeGreaterThan(0);
    }
    // WebKit may not support WebRTC in Playwright — don't hard-fail

    // ── D. Webdriver detection check ─────────────────────────────────
    // The VM no longer emits vm:* signal strings (stripped 2026-04-13).
    // Detection assertion now reads from the headless module's
    // webDriverIsOn signal — fed by navigator.webdriver, lieProps, and
    // the modern-Chrome-with-undefined-webdriver heuristic.
    if (browserName === 'chromium') {
      // Playwright Chromium always sets navigator.webdriver = true
      expect(
        fp.headless?.headless?.webDriverIsOn,
        'Chromium should detect webdriver via headless module',
      ).toBe(true);
    }

    // ── E. Server-side verification ──────────────────────────────────
    const sessionUrl = `${API_BASE}/v1/integrity-session/${clientResult.sessionId}`;
    const serverResp = await request.get(sessionUrl, {
      headers: { 'X-Api-Key': API_KEY },
    });

    console.log(`\n--- Server response (${serverResp.status()}) ---`);

    // Hard assert on server response status
    expect(
      serverResp.status(),
      `Server returned ${serverResp.status()} for session lookup`,
    ).toBe(200);

    const serverData = await serverResp.json();
    console.log(JSON.stringify(serverData, null, 2));
    console.log('--- End server response ---\n');

    // Verify the server stored meaningful data
    const integrity = serverData.integrity ?? serverData;

    // The payload should contain device fingerprint data
    const device = integrity.device ?? integrity.payload?.device;
    expect(device, 'Server should have device fingerprint data').toBeTruthy();

    // VM signals should match what the client reported
    if (integrity.vm_signals) {
      expect(integrity.vm_signals).toEqual(clientResult.vmSignals);
    }

    // vmHash should match
    if (integrity.vm_hash) {
      expect(integrity.vm_hash).toBe(clientResult.vmHash);
    }
  });
});
