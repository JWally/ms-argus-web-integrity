import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import net from 'node:net';
import { fetchAdversarialRecord, BASE_URL } from './helpers';

/**
 * Dallas evasion bot, UDP-WebRTC variant — same shape as
 * proxy-evasion-dallas.spec.ts except:
 *
 *   - SOCKS5 (not HTTP) so WebRTC's UDP traffic can ride the proxy.
 *     Per SOAX docs (helpcenter.soax.com/.../9214905-udp-protocol),
 *     residential SOCKS5 carries UDP.
 *   - WebRTC is left ALONE — no patching of RTCPeerConnection. Real
 *     STUN/ICE candidates negotiated through the proxy. Whatever IP
 *     surfaces in WebRTC is what the residential exit actually shows.
 *   - Chromium, but routed through a local gost chain
 *     (socks5://127.0.0.1:1080 → socks5://USER:PASS@proxy.soax.com:5000)
 *     because Playwright refuses SOCKS5 auth on every browser:
 *     "Browser does not support socks5 proxy authentication". gost
 *     handles the auth; the browser just talks to a no-auth local
 *     SOCKS5 entry. UDP ASSOCIATE forwards through the chain too.
 *     Start the chain before running the test (PROXY_PORT defaults to 1080).
 *
 * Purpose: see what argus catches when the residential proxy is
 * "complete" — IP, TZ, and WebRTC all align with Dallas.
 */

const CHAIN_PORT = Number(process.env.PROXY_PORT || 1080);
const CHAIN_HOST = process.env.PROXY_HOST || '127.0.0.1';

async function chainUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: CHAIN_HOST, port: CHAIN_PORT });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => {
      s.destroy();
      resolve(false);
    });
  });
}

interface LoaderRunResult {
  sessionId: string;
  argusSessionId: string;
  durationMs: number;
}

test.describe('adversarial: dallas via SOCKS5 + UDP WebRTC', () => {
  test.beforeAll(async () => {
    if (!(await chainUp())) {
      throw new Error(
        `gost chain not running on ${CHAIN_HOST}:${CHAIN_PORT}. ` +
          `Start it first, e.g.:\n` +
          `  PROXY_PASSWORD=... USER=...\n` +
          `  /tmp/gost -L "socks5://:${CHAIN_PORT}" \\\n` +
          `    -F "socks5://$(printf %s "$USER" | jq -sRr @uri):$(printf %s "$PROXY_PASSWORD" | jq -sRr @uri)@proxy.soax.com:5000"`,
      );
    }
  });

  test('chromium + gost chain → SOAX socks5 (UDP) + natural WebRTC + TZ spoof', async () => {
    const browser = await chromium.launch({
      headless: true,
      proxy: {
        server: `socks5://${CHAIN_HOST}:${CHAIN_PORT}`,
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--proxy-bypass-list=localhost;127.0.0.1',
      ],
    });

    try {
      const ctx = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36',
        // Dallas is Central time. Match the proxy exit's local TZ.
        timezoneId: 'America/Chicago',
        viewport: { width: 1280, height: 800 },
      });

      // Discover the exit IP (just for the log)
      const ipPage = await ctx.newPage();
      await ipPage.goto('https://api.ipify.org?format=json', {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });
      const ipBody = await ipPage.textContent('body');
      const proxyIp = (JSON.parse(ipBody!) as { ip: string }).ip;
      await ipPage.close();
      console.log('Proxy exit IP:', proxyIp);

      // ── run the integrity loader (playwright equivalent of
      //    runIntegrityPuppeteer in helpers.ts) ───────────────────
      const page = await ctx.newPage();
      await page.goto(`${BASE_URL}/test-loader.html`, {
        waitUntil: 'networkidle',
      });
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { argus?: unknown }).argus === 'object',
        { timeout: 5_000 },
      );
      const merchantSessionId = `bot-udp-webrtc-${Date.now()}`;
      const cpi = process.env.ARGUS_TEST_CPI;
      const result = (await page.evaluate(
        async ({ sid, to, c }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const argus = (window as any).argus;
          return await argus.run({ sessionId: sid, timeoutMs: to, cpi: c });
        },
        { sid: merchantSessionId, to: 30_000, c: cpi },
      )) as LoaderRunResult;

      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const ana = (record.analysis ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const lies = (dev.lies ?? {}) as {
        totalLies?: number;
        data?: Record<string, unknown>;
      };
      const worker = (ana.worker ?? {}) as Record<string, unknown>;
      const timezone = (ana.timezone ?? {}) as Record<string, unknown>;
      const ip = (ana.ip ?? {}) as Record<string, unknown>;
      const network = (ana.network ?? {}) as Record<string, unknown>;

      console.log('\n=== DALLAS UDP-WEBRTC BOT ===');
      console.log('Session:', result.argusSessionId);
      console.log('Headless rating:', headless.likeHeadlessRating);
      console.log('Headless hard:', headless.headless);
      console.log('Stealth rating:', headless.stealthRating);
      console.log('Total lies:', lies.totalLies);
      console.log('Lies data:', lies.data ? Object.keys(lies.data) : []);
      console.log('WebRTC:', dev.webrtc);
      console.log(
        'Client TZ:',
        (dev.timezone as { location?: string })?.location,
      );

      expect(result.argusSessionId).toBeTruthy();

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Worker lied:', worker.lied);
      console.log(
        'Worker divergences:',
        (worker.divergences as { field: string }[] | undefined)?.map(
          (d) => d.field,
        ),
      );
      console.log('Timezone lied:', timezone.lied);
      console.log('Timezone CF:', timezone.cfTimezone);
      console.log('Timezone client:', timezone.clientTimezone);
      console.log('IP lied:', ip.lied);
      console.log(
        'IP probes consistent:',
        (ip.checks as { probesConsistent?: boolean } | undefined)
          ?.probesConsistent,
      );
      console.log(
        'IP WebRTC matches:',
        (ip.checks as { webrtcMatchesProbes?: boolean } | undefined)
          ?.webrtcMatchesProbes,
      );
      console.log('IP addresses:', ip.ips);
      console.log('Network proxy_score:', network.proxy_score);
      console.log('Network vpn_score:', network.vpn_score);
      console.log('Network signals:', network.signals);

      const allSignals = [
        ...((worker.signals ?? []) as {
          code: string;
          severity: string;
          evidence: string;
        }[]),
        ...((timezone.signals ?? []) as {
          code: string;
          severity: string;
          evidence: string;
        }[]),
        ...((ip.signals ?? []) as {
          code: string;
          severity: string;
          evidence: string;
        }[]),
        ...((network.signals ?? []) as {
          code: string;
          severity: string;
          evidence: string;
        }[]),
      ];
      console.log('\n=== ALL SIGNALS ===');
      for (const s of allSignals) {
        console.log(`  ${s.code} (${s.severity}): ${s.evidence}`);
      }
      console.log(`Total signals: ${allSignals.length}`);
      console.log(
        'Modules that flagged lied:',
        [
          worker.lied && 'worker',
          timezone.lied && 'timezone',
          ip.lied && 'ip',
          (((network.proxy_score as number) ?? 0) > 0 ||
            ((network.vpn_score as number) ?? 0) > 0) &&
            'network',
        ].filter(Boolean),
      );
    } finally {
      await browser.close();
    }
  });
});
