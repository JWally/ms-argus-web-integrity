import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

/**
 * Maximum evasion bot — Bright Data ISP proxy variant (Dallas):
 *
 * Improvements over the SOAX/proxy-evasion-dallas bot:
 *   1. Bright Data ISP proxy = static residential IP block leased from a real
 *      US ISP and routed from a datacenter. Userspace relay is minimal/absent
 *      vs SOAX's peer-based architecture, so `rcv_rtt/rtt` should not inflate.
 *   2. ICE candidate filter drops IPv6 entirely — closes the IPv6 ASN leak
 *      that exposed the SOAX bot's real AT&T Dallas v6 prefix despite v4 spoof.
 *   3. Less obvious RTCPeerConnection wrapper (anonymous class) — reduces the
 *      obvious `SpoofedRTC.*` keys in `lies.data` (does NOT fully defeat the
 *      lies detector; rewriting prototype methods is still detectable via
 *      Function.prototype.toString).
 *   4. Geo target = Dallas, TX 75201 — matches host machine's TZ
 *      (America/Chicago) and AT&T home ASN region, so TZ_GEOLOCATION_MISMATCH
 *      should not fire.
 *
 * Requires PROXY_PASSWORD_BD env var (see ~/Dev/brightdata-isp-proxy.txt).
 * Skip with: SKIP_PROXY=1 npm run test:adversarial
 */

const BD_PASS = process.env.PROXY_PASSWORD_BD || '';
const BD_SERVER = 'http://brd.superproxy.io:33335';

// Bright Data ISP proxy base auth — session token appended per-run below.
//   * country-us: this zone allows country-only (HTTP 407 if state/city/zip added)
//   * -session-{token}: pins one exit IP for the lifetime of the session.
//     Without this, BD rotates IP per request and IP_PROBE_SCATTER fires 100%.
//     Session persists ~7min idle / up to 30min active. Fresh token per test
//     run ensures each run gets an independent exit IP.
const BD_USER_BASE = 'brd-customer-hl_d1f42c2a-zone-isp_proxy1-country-us';

test.describe('adversarial: Bright Data ISP proxy bot (Dallas)', () => {
  test.skip(!BD_PASS || !!process.env.SKIP_PROXY, 'PROXY_PASSWORD_BD not set or SKIP_PROXY=1');

  test('puppeteer + BD ISP Dallas proxy + IPv4 spoof + IPv6 drop', async () => {
    // Fresh session token per run → pinned exit IP for this test only
    const sessionToken = `argus${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const BD_USER = `${BD_USER_BASE}-session-${sessionToken}`;
    console.log('BD session token:', sessionToken);

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--proxy-server=${BD_SERVER}`,
        '--proxy-bypass-list=localhost;127.0.0.1',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();

      await page.authenticate({
        username: BD_USER,
        password: BD_PASS,
      });

      // Discover our proxy exit IP (so we can spoof WebRTC ICE candidates to it)
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
      console.log('BD ISP exit IP:', proxyIp);

      // Spoof timezone to match Dallas exit (Central Time)
      await page.emulateTimezone('America/Chicago');

      // Inject WebRTC patches:
      //  (1) drop all IPv6 candidates (no IPv6 ASN leak)
      //  (2) replace IPv4 in surviving candidates with the proxy exit IP
      // Wrapper class is anonymous to reduce leak via class .name; actual
      // Function.prototype.toString() of patched methods is still visible.
      await page.evaluateOnNewDocument((fakeIp: string) => {
        const OrigRTC = window.RTCPeerConnection;

        const isIpv6Candidate = (candidateStr: string): boolean => {
          // Candidate format: "candidate:F C P PRI ADDR PORT typ TYPE ..."
          // The ADDR field is at index 4 when split on whitespace.
          const parts = candidateStr.split(/\s+/);
          const addr = parts[4] || '';
          // IPv6 contains colons; IPv4 contains dots. Catches both global v6
          // and link-local. mDNS hostnames (.local) won't be filtered here.
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
            // Drop IPv6 candidates entirely
            if (isIpv6Candidate(evt.candidate.candidate)) {
              return;
            }
            // Patch IPv4 in remaining candidates
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

        // Anonymous wrapper assigned to a const; avoids `SpoofedRTC` class
        // name appearing in stack traces / lies.data keys. Note: this does
        // NOT defeat Function.prototype.toString-based detection of patched
        // methods — that's a separate, harder problem.
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

        // Reassign so `RTCPeerConnection.name === "RTCPeerConnection"` and
        // typeof checks still pass.
        Object.defineProperty(Patched, 'name', { value: 'RTCPeerConnection' });
        (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = Patched;
        (window as unknown as { webkitRTCPeerConnection: unknown }).webkitRTCPeerConnection =
          Patched;
      }, proxyIp);

      const result = await runIntegrityPuppeteer(page);
      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const ana = (record.analysis ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const lies = (dev.lies ?? {}) as {
        totalLies?: number;
        data?: Record<string, unknown>;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const worker = (ana.worker ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const timezone = (ana.timezone ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ip = (ana.ip ?? {}) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const network = (ana.network ?? {}) as any;

      console.log('\n=== BRIGHT DATA ISP DALLAS BOT ===');
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
      console.log(
        'Client offset:',
        (dev.timezone as { offset?: number })?.offset,
      );
      console.log(
        'Computed offset:',
        (dev.timezone as { offsetComputed?: number })?.offsetComputed,
      );

      expect(result.argusSessionId).toBeTruthy();

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Worker lied:', worker.lied);
      console.log(
        'Worker divergences:',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        worker.divergences?.map((d: any) => d.field),
      );
      console.log('Timezone lied:', timezone.lied);
      console.log('Timezone CF:', timezone.cfTimezone);
      console.log('Timezone client:', timezone.clientTimezone);
      console.log('TZ checks:', timezone.checks);
      console.log('IP lied:', ip.lied);
      console.log('IP probes consistent:', ip.checks?.probesConsistent);
      console.log('IP WebRTC matches:', ip.checks?.webrtcMatchesProbes);
      console.log('IP addresses:', ip.ips);
      console.log('IP ASN:', ip.asn);
      console.log('Network proxy_score:', network.proxy_score);
      console.log('Network vpn_score:', network.vpn_score);
      console.log('Network signals:', network.signals);

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
      console.log(
        'Modules that flagged lied:',
        [
          worker.lied && 'worker',
          timezone.lied && 'timezone',
          ip.lied && 'ip',
          ((network.proxy_score ?? 0) > 0 ||
            (network.vpn_score ?? 0) > 0) &&
            'network',
        ].filter(Boolean),
      );
    } finally {
      await browser.close();
    }
  });
});
