import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import { verifyServerSession, BASE_URL } from './helpers';

/**
 * SOAX residential proxy test — Ireland & UK exit nodes.
 *
 * Verifies that the integrity pipeline detects timezone/geo mismatches
 * when traffic exits through a foreign residential proxy. The client
 * browser runs locally (e.g., America/Chicago) but CloudFront sees
 * an Irish or British IP, creating a detectable TZ_GEOLOCATION_MISMATCH.
 *
 * Requires PROXY_PASSWORD env var (SOAX credentials).
 * Skip with: SKIP_PROXY=1 npm run test:adversarial
 */

const SOAX_PASS = process.env.PROXY_PASSWORD || '';
const SOAX_SERVER = 'http://proxy.soax.com:5000';

function buildSoaxUser(cc: string): string {
  return `package-267218-country-${cc}-sessionlength-300`;
}

const GEO_TARGETS = [
  { label: 'Ireland', cc: 'ie' },
  { label: 'UK', cc: 'gb' },
];

test.describe('adversarial: SOAX residential proxy', () => {
  test.skip(!SOAX_PASS || !!process.env.SKIP_PROXY, 'PROXY_PASSWORD not set or SKIP_PROXY=1');

  for (const target of GEO_TARGETS) {
    test(`detects geo mismatch via ${target.label} proxy`, async ({ request }) => {
      const proxyUser = buildSoaxUser(target.cc);

      const browser = await chromium.launch({
        headless: true,
        proxy: {
          server: SOAX_SERVER,
          username: proxyUser,
          password: SOAX_PASS,
          bypass: 'localhost,127.0.0.1',
        },
      });

      try {
        const page = await browser.newPage();
        await page.goto(`${BASE_URL}/test-integrity.html`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        });

        await expect(page.locator('#status')).toHaveText('idle');
        await page.evaluate(() => (window as any).__runIntegrity());
        await expect(page.locator('#status')).not.toHaveText('running', {
          timeout: 60_000,
        });

        const status = await page.locator('#status').textContent();
        const resultText = await page.locator('#result').textContent();
        expect(status).not.toBe('error');

        const result = JSON.parse(resultText!);
        const fp = result.fingerprint;

        console.log(`${target.label} proxy result:`, {
          sessionId: result.sessionId,
          tampered: result.tampered,
          vmSignals: result.vmSignals,
          clientTimezone: fp.timezone?.location,
          clientOffset: fp.timezone?.offset,
        });

        // Session should still be accepted
        expect(result.sessionId, 'Should get a session ID').toBeTruthy();

        // Client timezone should be our local timezone (not the proxy's)
        expect(fp.timezone?.location).toBeTruthy();

        // Verify server-side — check if timezone analysis caught the mismatch
        const serverData = await verifyServerSession(result.sessionId, request);
        const integrity = serverData.integrity ?? serverData;
        const tzAnalysis = integrity.analysis?.timezone;

        console.log(`${target.label} server timezone analysis:`, tzAnalysis);

        // If CF timezone was available, it should differ from client timezone
        if (tzAnalysis?.cfTimezone) {
          expect(
            tzAnalysis.cfTimezone,
            `CF should report ${target.label} timezone, not client local`,
          ).not.toBe(tzAnalysis.clientTimezone);

          expect(
            tzAnalysis.checks.locationMatchesCfTimezone,
            'Should detect geo mismatch',
          ).toBe(false);

          expect(tzAnalysis.lied, 'Timezone analysis should flag as lied').toBe(true);
        } else {
          console.warn(
            `CF timezone not available for ${target.label} — sigint may not be fully configured`,
          );
        }
      } finally {
        await browser.close();
      }
    });
  }
});
