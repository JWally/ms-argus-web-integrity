import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import net from 'node:net';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

/**
 * Tor exit bot — vanilla Puppeteer routed through the local tor daemon.
 *
 * Setup (one-time on the runner):
 *   sudo apt install tor && sudo systemctl enable --now tor
 *   curl --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip
 *
 * The test skips cleanly if tor isn't listening on 127.0.0.1:9050 so CI
 * boxes without the daemon don't fail the suite.
 *
 * Expectations: Tor exits are published on every blocklist, so
 * network.proxy_score / vpn_score and ip.signals should fire strongly.
 * This is the purpose — it's a known-bad baseline for the classifier,
 * not an evasion attempt.
 *
 * Notes:
 *   - --proxy-bypass-list is required so the loopback test server
 *     (localhost:9100) doesn't get routed through Tor.
 *   - Tor latency inflates probe timings; bump integrity timeout to 60s.
 *   - No timezone spoof: the exit country is picked per-circuit and we
 *     don't want to second-guess it; this test is the "naive Tor bot"
 *     baseline, not a well-tuned evasion.
 */

const TOR_SOCKS = 'socks5://127.0.0.1:9050';

/** Best-effort check that a local tor daemon is listening. */
function isTorUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(9050, '127.0.0.1');
  });
}

test.describe('adversarial: tor exit bot', () => {
  let torUp = false;
  test.beforeAll(async () => {
    torUp = await isTorUp();
  });

  test('puppeteer routed through local tor SOCKS', async () => {
    test.skip(!torUp, 'tor daemon not listening on 127.0.0.1:9050');

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--proxy-server=${TOR_SOCKS}`,
        '--proxy-bypass-list=localhost;127.0.0.1',
      ],
    });

    try {
      const page = await browser.newPage();

      // Confirm we're actually going through Tor. If this fails we skip
      // rather than report a false clean-network signal.
      const ipPage = await browser.newPage();
      await ipPage.goto('https://check.torproject.org/api/ip', {
        waitUntil: 'networkidle0',
        timeout: 60_000,
      });
      const ipText = await ipPage.$eval('body', (el) => el.textContent);
      await ipPage.close();
      const ipInfo = JSON.parse(ipText ?? '{}') as { IsTor?: boolean; IP?: string };
      test.skip(
        !ipInfo.IsTor,
        `proxy did not route through Tor (IP=${ipInfo.IP ?? 'unknown'})`,
      );
      console.log('Tor exit IP:', ipInfo.IP);

      const result = await runIntegrityPuppeteer(page, { timeoutMs: 60_000 });
      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const ana = (record.analysis ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const lies = (dev.lies ?? {}) as {
        totalLies?: number;
        data?: Record<string, unknown>;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ip = (ana.ip ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const network = (ana.network ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timezone = (ana.timezone ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const worker = (ana.worker ?? {}) as any;

      console.log('\n=== TOR EXIT BOT ===');
      console.log('Session:', result.argusSessionId);
      console.log('Tor exit IP:', ipInfo.IP);
      console.log('Headless rating:', headless.likeHeadlessRating);
      console.log('Stealth rating:', headless.stealthRating);
      console.log('Total lies:', lies.totalLies);
      console.log(
        'Client TZ:',
        (dev.timezone as { location?: string })?.location,
      );

      expect(result.argusSessionId).toBeTruthy();

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Network proxy_score:', network.proxy_score);
      console.log('Network vpn_score:', network.vpn_score);
      console.log('Network signals:', network.signals);
      console.log('IP lied:', ip.lied);
      console.log('IP addresses:', ip.ips);
      console.log('IP probes consistent:', ip.checks?.probesConsistent);
      console.log('Timezone lied:', timezone.lied);
      console.log('Timezone CF:', timezone.cfTimezone);
      console.log('Timezone client:', timezone.clientTimezone);
      console.log('Worker lied:', worker.lied);

      const allSignals = [
        ...(worker.signals ?? []),
        ...(timezone.signals ?? []),
        ...(ip.signals ?? []),
        ...(network.signals ?? []),
      ];
      console.log('\n=== ALL SIGNALS ===');
      for (const s of allSignals) {
        console.log(`  ${s.code} (${s.severity}): ${s.evidence}`);
      }
      console.log(`Total signals: ${allSignals.length}`);

      // Baseline expectation: tor should be flagged. If proxy_score and
      // vpn_score are both 0, something upstream (proxy-detection DB) is
      // stale — loud failure is the point of this test.
      const detected =
        (network.proxy_score ?? 0) > 0 ||
        (network.vpn_score ?? 0) > 0 ||
        ip.lied === true ||
        allSignals.length > 0;
      expect(
        detected,
        'Tor exit produced zero detection signals — classifier is broken',
      ).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
