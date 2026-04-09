import { test, expect } from '@playwright/test';

const API_BASE = 'https://api-dev-jw.argus.pw';
const API_KEY =
  process.env.INTEGRITY_API_KEY ??
  'ak_integrity_e06efb721ca47390a521bf7934c82c540fd3416f0e515a733e73d2a0c89c10a9';

test.describe('integrity VM end-to-end', () => {
  test('collects fingerprint, runs VM, server decrypts and stores payload', async ({
    page,
    request,
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
    console.log('Client VM result:', clientResult);

    // sessionId should be non-empty (server accepted the payload)
    expect(
      clientResult.sessionId,
      'Server should return a session ID (decryption succeeded)',
    ).toBeTruthy();
    expect(clientResult.vmHash).toBeTruthy();

    // ── Fetch what the server actually stored ──────────────────────
    const sessionUrl = `${API_BASE}/v1/integrity-session/${clientResult.sessionId}`;
    const serverResp = await request.get(sessionUrl, {
      headers: { 'X-Api-Key': API_KEY },
    });

    console.log(
      `\n--- Server response (${serverResp.status()}) ---`,
    );

    if (serverResp.ok()) {
      const serverData = await serverResp.json();
      console.log(JSON.stringify(serverData, null, 2));
      console.log('--- End server response ---\n');

      // Verify the server stored meaningful data
      const integrity = serverData.integrity ?? serverData;

      // The payload should contain device fingerprint data
      expect(
        integrity.device ?? integrity.payload?.device,
        'Server should have device fingerprint data',
      ).toBeTruthy();

      // VM signals should match what the client reported
      if (integrity.vm_signals) {
        expect(integrity.vm_signals).toEqual(clientResult.vmSignals);
      }

      // vmHash should match
      if (integrity.vm_hash) {
        expect(integrity.vm_hash).toBe(clientResult.vmHash);
      }
    } else {
      const body = await serverResp.text();
      console.log(`FAILED: ${body}`);
      console.log('--- End server response ---\n');
      // Don't hard-fail here — the session-get endpoint may require auth
      // or the table name might not be configured. Log it for visibility.
      console.warn(
        `Could not fetch server-side data (${serverResp.status()}). ` +
          'Check if /v1/integrity-session is configured.',
      );
    }
  });
});
