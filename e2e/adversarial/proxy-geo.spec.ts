import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import { fetchAdversarialRecord, BASE_URL } from './helpers';

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
  test.skip(
    !SOAX_PASS || !!process.env.SKIP_PROXY,
    'PROXY_PASSWORD not set or SKIP_PROXY=1',
  );

  test.skip(
    !process.env.ARGUS_TEST_CPI,
    'ARGUS_TEST_CPI not set — needed to authenticate via API',
  );

  for (const target of GEO_TARGETS) {
    test(`detects geo mismatch via ${target.label} proxy`, async () => {
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
        await page.goto(`${BASE_URL}/test-loader.html`, {
          waitUntil: 'networkidle',
          timeout: 60_000,
        });

        // Wait for loader to register
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
        const result = await page.evaluate(async (c) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const argus = (window as any).argus;
          return (await argus.run({
            sessionId: `proxy-geo-${Date.now()}`,
            timeoutMs: 60_000,
            cpi: c,
          })) as {
            sessionId: string;
            argusSessionId: string;
            durationMs: number;
          };
        }, cpi);

        const record = await fetchAdversarialRecord(result.argusSessionId);
        const dev = (record.device ?? {}) as Record<string, unknown>;
        const ana = (record.analysis ?? {}) as Record<string, unknown>;
        const clientTz = (dev.timezone ?? {}) as {
          location?: string;
          offset?: number;
        };
        const tzAnalysis = (ana.timezone ?? {}) as {
          lied?: boolean;
          cfTimezone?: string;
          clientTimezone?: string;
          checks?: { locationMatchesCfTimezone?: boolean };
        };

        console.log(`${target.label} proxy result:`, {
          sessionId: result.argusSessionId,
          clientTimezone: clientTz.location,
          clientOffset: clientTz.offset,
        });

        expect(result.argusSessionId, 'Should get a session ID').toBeTruthy();
        expect(clientTz.location).toBeTruthy();

        console.log(`${target.label} server timezone analysis:`, tzAnalysis);

        if (tzAnalysis.cfTimezone) {
          expect(
            tzAnalysis.cfTimezone,
            `CF should report ${target.label} timezone, not client local`,
          ).not.toBe(tzAnalysis.clientTimezone);

          expect(
            tzAnalysis.checks?.locationMatchesCfTimezone,
            'Should detect geo mismatch',
          ).toBe(false);

          expect(tzAnalysis.lied, 'Timezone analysis should flag as lied').toBe(
            true,
          );
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
