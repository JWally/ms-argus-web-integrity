import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import {
  fetchAdversarialRecord,
  BASE_URL,
  discoverExitIp,
  installWebrtcIpSpoof,
} from './helpers';

/**
 * SOAX datacenter proxy bot — commodity DC proxy pool.
 *
 * Tests what detection fires when a bot routes through datacenter IPs
 * without attempting to look residential:
 *   - Exit IPs belong to hosting/cloud providers (datacenter ASNs)
 *   - IP consistency analyzer's asn-catalog lookup should flag the
 *     ASN with category "datacenter" → IP_PROBE_SCATTER at severity 0.7
 *   - Network-probe analyzer may additionally fire LIKELY_PROXY /
 *     LIKELY_VPN depending on the userspace relay path
 *
 * Country-pinned to US (matches package config). Sticky session pins
 * one IP across probes; sessions last 600s.
 *
 * Requires PROXY_PASSWORD_SOAX_DC. Skip with SKIP_PROXY=1.
 */

const SOAX_DC_PASS = process.env.PROXY_PASSWORD_SOAX_DC || '';
const SOAX_SERVER = 'http://proxy.soax.com:5000';

test.describe('adversarial: SOAX datacenter proxy', () => {
  test.skip(
    !SOAX_DC_PASS || !!process.env.SKIP_PROXY,
    'PROXY_PASSWORD_SOAX_DC not set or SKIP_PROXY=1',
  );

  test('puppeteer + SOAX US datacenter proxy + sticky session', async () => {
    const sessionToken = `argus${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const proxyUser = `package-267220-country-us-sessionid-${sessionToken}-sessionlength-600`;

    const browser = await chromium.launch({
      headless: true,
      proxy: {
        server: SOAX_SERVER,
        username: proxyUser,
        password: SOAX_DC_PASS,
        bypass: 'localhost,127.0.0.1',
      },
    });

    try {
      const proxyIp = await discoverExitIp(browser);
      console.log('SOAX Datacenter exit IP:', proxyIp);

      const page = await browser.newPage();
      await installWebrtcIpSpoof(page, proxyIp);

      await page.goto(`${BASE_URL}/test-loader.html`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              typeof (window as unknown as { argus?: unknown }).argus ===
              'object',
          ),
        )
        .toBeTruthy();

      const result = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const argus = (window as any).argus;
        return (await argus.run({
          sessionId: `soax-ipdc-${Date.now()}`,
          timeoutMs: 60_000,
        })) as {
          sessionId: string;
          argusSessionId: string;
          durationMs: number;
        };
      });

      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const ana = (record.analysis ?? {}) as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ip = (ana.ip ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timezone = (ana.timezone ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const network = (ana.network ?? {}) as any;

      console.log('\n=== SOAX DATACENTER BOT ===');
      console.log('Session:', result.argusSessionId);
      console.log('Exit IPs:', ip.ips);
      console.log('ASN:', ip.asn);
      console.log('IP lied:', ip.lied);
      console.log('TZ client:', timezone.clientTimezone);
      console.log('TZ CF:', timezone.cfTimezone);
      console.log('TZ lied:', timezone.lied);
      console.log('Network proxy_score:', network.proxy_score);
      console.log('Network vpn_score:', network.vpn_score);
      console.log('Network signals:', network.signals);
      console.log(
        'Headless rating:',
        (dev.headless as { likeHeadlessRating?: number } | undefined)
          ?.likeHeadlessRating,
      );

      expect(result.argusSessionId).toBeTruthy();

      const allSignals = [
        ...(ip.signals ?? []),
        ...(timezone.signals ?? []),
        ...(network.signals ?? []),
      ];
      console.log('\n=== ALL NETWORK-LAYER SIGNALS ===');
      for (const s of allSignals) {
        console.log(`  ${s.code} (${s.severity}): ${s.evidence}`);
      }
      console.log(`Total: ${allSignals.length}`);

      // Datacenter ASN should be caught by asn-catalog lookup
      if (ip.asn?.category) {
        console.log(
          `ASN category from server: ${ip.asn.category} (${ip.asn.org ?? 'unknown org'})`,
        );
      }
    } finally {
      await browser.close();
    }
  });
});
