import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, verifyServerSession } from './helpers';

/**
 * Maximum evasion bot (Dallas variant) — vanilla Puppeteer + sticky proxy + TZ spoof:
 * - No stealth plugin (avoids lie detection)
 * - SOAX sticky session: same IP across all probes, US exit (Dallas, TX)
 * - Timezone spoofed via CDP to match proxy exit city (America/Chicago)
 * - WebRTC patched to inject proxy IP into ICE candidates
 * - AutomationControlled blink feature disabled
 *
 * Purpose: red-team test to find what detection still catches.
 */

const SOAX_PASS = process.env.PROXY_PASSWORD || '';
const SOAX_SERVER = 'http://proxy.soax.com:5000';
const STICKY_SESSION =
  'package-267218-country-us-city-dallas-sessionid-evasiontestdal789-sessionlength-300';

// We'll discover the proxy's exit IP by hitting a "what's my IP" service
// through the proxy, then inject that IP into WebRTC candidates.

test.describe('adversarial: maximum evasion bot (Dallas)', () => {
  test.skip(!SOAX_PASS || !!process.env.SKIP_PROXY, 'PROXY_PASSWORD not set or SKIP_PROXY=1');

  test('puppeteer + sticky Dallas proxy + TZ spoof + fake WebRTC IP', async ({ request }) => {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--proxy-server=${SOAX_SERVER}`,
        '--proxy-bypass-list=localhost;127.0.0.1',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();

      await page.authenticate({
        username: STICKY_SESSION,
        password: SOAX_PASS,
      });

      // Discover our proxy exit IP
      const ipPage = await browser.newPage();
      await ipPage.authenticate({
        username: STICKY_SESSION,
        password: SOAX_PASS,
      });
      await ipPage.goto('https://api.ipify.org?format=json', {
        waitUntil: 'networkidle0',
        timeout: 30_000,
      });
      const ipText = await ipPage.$eval('body', (el) => el.textContent);
      const proxyIp = JSON.parse(ipText!).ip;
      await ipPage.close();
      console.log('Proxy exit IP:', proxyIp);

      // Spoof timezone to match Dallas exit node (Central Time)
      await page.emulateTimezone('America/Chicago');

      // Inject WebRTC IP spoofing — replace all IPs in ICE candidates
      // with the proxy's exit IP so WebRTC "leaks" the proxy IP
      await page.evaluateOnNewDocument((fakeIp: string) => {
        const OrigRTC = window.RTCPeerConnection;

        class SpoofedRTC extends OrigRTC {
          constructor(config?: RTCConfiguration) {
            super(config);
          }

          set onicecandidate(handler: ((ev: RTCPeerConnectionIceEvent) => void) | null) {
            if (!handler) {
              super.onicecandidate = null;
              return;
            }
            super.onicecandidate = (evt: RTCPeerConnectionIceEvent) => {
              if (evt.candidate?.candidate) {
                const spoofed = evt.candidate.candidate.replace(
                  /(\d+\.\d+\.\d+\.\d+)/g,
                  fakeIp,
                );
                const newCandidate = new RTCIceCandidate({
                  candidate: spoofed,
                  sdpMid: evt.candidate.sdpMid,
                  sdpMLineIndex: evt.candidate.sdpMLineIndex,
                });
                const fakeEvt = new Event('icecandidate') as any;
                fakeEvt.candidate = newCandidate;
                handler.call(this, fakeEvt);
              } else {
                handler.call(this, evt);
              }
            };
          }

          get onicecandidate() {
            return super.onicecandidate;
          }

          addEventListener(type: string, listener: any, options?: any) {
            if (type === 'icecandidate') {
              const wrapped = (evt: RTCPeerConnectionIceEvent) => {
                if (evt.candidate?.candidate) {
                  const spoofed = evt.candidate.candidate.replace(
                    /(\d+\.\d+\.\d+\.\d+)/g,
                    fakeIp,
                  );
                  const newCandidate = new RTCIceCandidate({
                    candidate: spoofed,
                    sdpMid: evt.candidate.sdpMid,
                    sdpMLineIndex: evt.candidate.sdpMLineIndex,
                  });
                  const fakeEvt = new Event('icecandidate') as any;
                  fakeEvt.candidate = newCandidate;
                  listener.call(this, fakeEvt);
                } else {
                  listener.call(this, evt);
                }
              };
              return super.addEventListener(type, wrapped, options);
            }
            return super.addEventListener(type, listener, options);
          }
        }

        (window as any).RTCPeerConnection = SpoofedRTC;
        (window as any).webkitRTCPeerConnection = SpoofedRTC;
      }, proxyIp);

      const result = await runIntegrityPuppeteer(page);
      const fp = result.fingerprint;

      console.log('\n=== MAXIMUM EVASION BOT (DALLAS) ===');
      console.log('Session:', result.sessionId);
      console.log('Tampered:', result.tampered);
      console.log('VM Signals:', result.vmSignals);
      console.log('Headless rating:', fp.headless?.likeHeadlessRating);
      console.log('Headless hard:', fp.headless?.headless);
      console.log('Stealth rating:', fp.headless?.stealthRating);
      console.log('Total lies:', fp.lies?.totalLies);
      console.log('Lies data:', fp.lies?.data ? Object.keys(fp.lies.data) : []);
      console.log('WebRTC:', fp.webrtc);
      console.log('Client TZ:', fp.timezone?.location);
      console.log('Client offset:', fp.timezone?.offset);
      console.log('Computed offset:', fp.timezone?.offsetComputed);

      expect(result.sessionId).toBeTruthy();
      const serverData = await verifyServerSession(result.sessionId, request);
      const analysis = (serverData.integrity ?? serverData).analysis;

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Worker lied:', analysis?.worker?.lied);
      console.log('Worker divergences:', analysis?.worker?.divergences?.map((d: any) => d.field));
      console.log('Timezone lied:', analysis?.timezone?.lied);
      console.log('Timezone CF:', analysis?.timezone?.cfTimezone);
      console.log('Timezone client:', analysis?.timezone?.clientTimezone);
      console.log('TZ checks:', analysis?.timezone?.checks);
      console.log('IP lied:', analysis?.ip?.lied);
      console.log('IP probes consistent:', analysis?.ip?.checks?.probesConsistent);
      console.log('IP WebRTC matches:', analysis?.ip?.checks?.webrtcMatchesProbes);
      console.log('IP addresses:', analysis?.ip?.ips);
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
