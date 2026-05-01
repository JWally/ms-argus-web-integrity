import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import {
  fetchAdversarialRecord,
  BASE_URL,
  discoverExitIp,
  installWebrtcIpSpoof,
} from './helpers';

/**
 * SOAX Mobile proxy bot — commodity cellular CGNAT proxy.
 *
 * Tests what detection fires when a bot routes through real mobile
 * carrier IPs:
 *   - Exit IPs come from cellular pools (CGNAT'd, carrier-attributed
 *     ASNs rather than residential ISPs)
 *   - Radio path introduces measurable RTT jitter and compression-
 *     induced snd_mss shrinkage — picked up by network-probe analyzer
 *     (LIKELY_PROXY / LIKELY_VPN signals)
 *   - Geography follows carrier PoPs, so TZ geo-check may or may not
 *     fire depending on where the pool is today
 *
 * Sticky session pins one IP across all probes (avoids spurious
 * IP_PROBE_SCATTER). Sessions last 300s.
 *
 * Requires PROXY_PASSWORD_SOAX_MOBILE. Skip with SKIP_PROXY=1.
 */

const SOAX_MOBILE_PASS = process.env.PROXY_PASSWORD_SOAX_MOBILE || '';
const SOAX_SERVER = 'http://proxy.soax.com:5000';

test.describe('adversarial: SOAX mobile proxy', () => {
  test.skip(
    !SOAX_MOBILE_PASS || !!process.env.SKIP_PROXY,
    'PROXY_PASSWORD_SOAX_MOBILE not set or SKIP_PROXY=1',
  );

  test('puppeteer + SOAX mobile CGNAT proxy + sticky session', async () => {
    const sessionToken = `argus${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const proxyUser = `package-267217-sessionid-${sessionToken}-sessionlength-300`;

    const browser = await chromium.launch({
      headless: true,
      proxy: {
        server: SOAX_SERVER,
        username: proxyUser,
        password: SOAX_MOBILE_PASS,
        bypass: 'localhost,127.0.0.1',
      },
    });

    try {
      // Discover the proxy exit IP so we can patch WebRTC ICE
      // candidates to match — prevents the real home IP from leaking
      // via the WEBRTC_IP_MISMATCH signal.
      const proxyIp = await discoverExitIp(browser);
      console.log('SOAX Mobile exit IP:', proxyIp);

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

      const cpi = process.env.ARGUS_TEST_CPI;
      const result = await page.evaluate(async (c) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const argus = (window as any).argus;
        return (await argus.run({
          sessionId: `soax-mobile-${Date.now()}`,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ip = (ana.ip ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timezone = (ana.timezone ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const network = (ana.network ?? {}) as any;

      console.log('\n=== SOAX MOBILE BOT ===');
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
    } finally {
      await browser.close();
    }
  });
});
