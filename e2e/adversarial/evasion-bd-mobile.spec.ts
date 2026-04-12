import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, verifyServerSession } from './helpers';

/**
 * Maximum evasion bot — Bright Data Mobile proxy:
 *
 * Differences from the BD ISP bot:
 *   - Zone is `mobile_proxy1` instead of `isp_proxy1`. Exit IPs come from
 *     real cellular carrier pools (CGNAT'd), not ISP-leased blocks.
 *   - Expected network shape: higher RTT (cellular radio path),
 *     potentially mobile-clamped MSS (~1428 typical for cell tunnels), and
 *     possibly higher rttvar.
 *   - Real cellular users (iPhone test data) showed `tcp_options=15` (iOS
 *     ECN). This bot runs Chrome on Linux which exhibits `options=7`. So
 *     "claimed Windows desktop UA over cellular IP" is allowed (legit users
 *     do tether laptops to phones), but a TCP_OPTIONS_OS_MISMATCH-style
 *     check (not yet implemented in detector) would catch this.
 *
 * Same evasion stack as the ISP bot: session-pinned exit IP, IPv4 spoof in
 * WebRTC, IPv6 candidates dropped, Chromium UA spoof.
 *
 * Requires PROXY_PASSWORD_BD_MOBILE env var (see ~/Dev/brightdata-mobile-proxy.txt).
 * Skip with: SKIP_PROXY=1 npm run test:adversarial
 */

const BD_PASS = process.env.PROXY_PASSWORD_BD_MOBILE || '';
const BD_SERVER = 'http://brd.superproxy.io:33335';

// Mobile zone — empirically tested 2026-04-12: this plan returns
// HTTP 502 no_peer for `country-us` (US not in this plan's pool).
// Available alternatives observed: gb, de, ca, au, in.
// Using gb because UK has a single timezone (Europe/London) — predictable
// TZ matching, clean comparison against the BD ISP bot's results.
const BD_USER_BASE = 'brd-customer-hl_d1f42c2a-zone-mobile_proxy1-country-gb';
const SPOOF_TZ = 'Europe/London';

test.describe('adversarial: Bright Data Mobile proxy bot', () => {
  test.skip(!BD_PASS || !!process.env.SKIP_PROXY, 'PROXY_PASSWORD_BD_MOBILE not set or SKIP_PROXY=1');

  test('puppeteer + BD Mobile proxy + IPv4 spoof + IPv6 drop + session pin', async ({ request }) => {
    // Fresh session token per run → pinned cellular exit IP for this test
    const sessionToken = `argus${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const BD_USER = `${BD_USER_BASE}-session-${sessionToken}`;
    console.log('BD session token:', sessionToken);

    // BD Mobile does TLS interception (custom CA) — must ignore cert errors,
    // unlike the ISP zone which does TLS passthrough. The downside: the
    // server-side JA4 fingerprint will reflect BD's TLS stack, not Chrome's,
    // creating a likely JA4_UA_BROWSER_MISMATCH.
    const browser = await puppeteer.launch({
      headless: true,
      acceptInsecureCerts: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--ignore-certificate-errors',
        `--proxy-server=${BD_SERVER}`,
        '--proxy-bypass-list=localhost;127.0.0.1',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();

      // Capture browser-side errors so we can see what BD's TLS interception
      // breaks (if anything) in the integrity flow.
      page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') {
          console.log(`[browser ${msg.type()}]`, msg.text());
        }
      });
      page.on('pageerror', (err) => console.log('[pageerror]', err.message));
      page.on('requestfailed', (req) =>
        console.log('[requestfailed]', req.url(), req.failure()?.errorText),
      );
      page.on('response', (resp) => {
        if (!resp.ok() && resp.url().includes('api-dev-jw.argus.pw')) {
          console.log('[api error]', resp.status(), resp.url());
        }
      });

      await page.authenticate({
        username: BD_USER,
        password: BD_PASS,
      });

      // Discover our proxy exit IP (so we can spoof WebRTC ICE candidates)
      const ipPage = await browser.newPage();
      await ipPage.authenticate({
        username: BD_USER,
        password: BD_PASS,
      });
      await ipPage.goto('https://api.ipify.org?format=json', {
        waitUntil: 'networkidle0',
        timeout: 30_000,
      });
      const ipText = await ipPage.$eval('body', (el) => el.textContent);
      const proxyIp = JSON.parse(ipText!).ip;
      await ipPage.close();
      console.log('BD Mobile exit IP:', proxyIp);

      // Spoof timezone to match the BD exit country's TZ (Europe/London for GB)
      await page.emulateTimezone(SPOOF_TZ);

      // Patch RTCPeerConnection: drop IPv6 candidates, replace IPv4 with proxy IP.
      // Wrapper class is anonymous to reduce obvious leak in lies.data.
      await page.evaluateOnNewDocument((fakeIp: string) => {
        const OrigRTC = window.RTCPeerConnection;

        const isIpv6Candidate = (candidateStr: string): boolean => {
          const parts = candidateStr.split(/\s+/);
          const addr = parts[4] || '';
          return addr.includes(':');
        };

        const wrapHandler = (
          handler: ((ev: RTCPeerConnectionIceEvent) => void) | EventListener,
          self: RTCPeerConnection,
        ) => {
          return (evt: RTCPeerConnectionIceEvent) => {
            if (!evt.candidate?.candidate) {
              return (handler as (e: RTCPeerConnectionIceEvent) => void).call(self, evt);
            }
            if (isIpv6Candidate(evt.candidate.candidate)) {
              return;
            }
            const spoofed = evt.candidate.candidate.replace(
              /(\d+\.\d+\.\d+\.\d+)/g,
              fakeIp,
            );
            const newCandidate = new RTCIceCandidate({
              candidate: spoofed,
              sdpMid: evt.candidate.sdpMid,
              sdpMLineIndex: evt.candidate.sdpMLineIndex,
            });
            const fakeEvt = new Event('icecandidate') as RTCPeerConnectionIceEvent &
              Event & { candidate: RTCIceCandidate };
            (fakeEvt as unknown as { candidate: RTCIceCandidate }).candidate = newCandidate;
            (handler as (e: RTCPeerConnectionIceEvent) => void).call(self, fakeEvt);
          };
        };

        const Patched = class extends OrigRTC {
          constructor(config?: RTCConfiguration) {
            super(config);
          }

          set onicecandidate(handler: ((ev: RTCPeerConnectionIceEvent) => void) | null) {
            if (!handler) {
              super.onicecandidate = null;
              return;
            }
            super.onicecandidate = wrapHandler(handler, this);
          }

          get onicecandidate() {
            return super.onicecandidate;
          }

          addEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
          ) {
            if (type !== 'icecandidate' || typeof listener !== 'function') {
              return super.addEventListener(type, listener, options);
            }
            return super.addEventListener(type, wrapHandler(listener, this), options);
          }
        };

        Object.defineProperty(Patched, 'name', { value: 'RTCPeerConnection' });
        (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = Patched;
        (window as unknown as { webkitRTCPeerConnection: unknown }).webkitRTCPeerConnection =
          Patched;
      }, proxyIp);

      const result = await runIntegrityPuppeteer(page);
      const fp = result.fingerprint;

      console.log('\n=== BRIGHT DATA MOBILE BOT ===');
      console.log('Session:', result.sessionId);
      console.log('Tampered:', result.tampered);
      console.log('VM Signals:', result.vmSignals);
      console.log('Headless rating:', fp.headless?.likeHeadlessRating);
      console.log('Total lies:', fp.lies?.totalLies);
      console.log('Lies data:', fp.lies?.data ? Object.keys(fp.lies.data) : []);
      console.log('Client TZ:', fp.timezone?.location);

      expect(result.sessionId).toBeTruthy();
      const serverData = await verifyServerSession(result.sessionId, request);
      const analysis = (serverData.integrity ?? serverData).analysis;

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Worker lied:', analysis?.worker?.lied);
      console.log('Timezone lied:', analysis?.timezone?.lied);
      console.log('Timezone CF:', analysis?.timezone?.cfTimezone);
      console.log('Timezone client:', analysis?.timezone?.clientTimezone);
      console.log('IP lied:', analysis?.ip?.lied);
      console.log('IP probes consistent:', analysis?.ip?.checks?.probesConsistent);
      console.log('IP WebRTC matches:', analysis?.ip?.checks?.webrtcMatchesProbes);
      console.log('IP addresses:', analysis?.ip?.ips);
      console.log('IP ASN:', analysis?.ip?.asn);
      console.log('Network proxy_score:', analysis?.network?.proxy_score);
      console.log('Network vpn_score:', analysis?.network?.vpn_score);
      console.log('Network signals:', analysis?.network?.signals);

      const allSignals = [
        ...(analysis?.worker?.signals ?? []),
        ...(analysis?.timezone?.signals ?? []),
        ...(analysis?.ip?.signals ?? []),
        ...(analysis?.network?.signals ?? []),
      ];
      console.log('\n=== ALL SIGNALS ===');
      for (const s of allSignals) {
        console.log(`  ${s.code} (${s.severity}): ${s.evidence}`);
      }
      console.log(`Total signals: ${allSignals.length}`);
      console.log('Modules that flagged lied:', [
        analysis?.worker?.lied && 'worker',
        analysis?.timezone?.lied && 'timezone',
        analysis?.ip?.lied && 'ip',
        (analysis?.network?.proxy_score > 0 || analysis?.network?.vpn_score > 0) && 'network',
      ].filter(Boolean));
    } finally {
      await browser.close();
    }
  });
});
