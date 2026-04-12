import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, verifyServerSession } from './helpers';

/**
 * Direct-connection evasion bot — vanilla Puppeteer, no proxy, no spoofing:
 * - No stealth plugin (avoids lie detection)
 * - No proxy — real ISP IP exits directly
 * - No timezone emulation — browser reports host TZ
 * - No WebRTC IP patching — genuine ICE candidates
 * - AutomationControlled blink feature disabled
 *
 * Purpose: baseline for comparing proxy-induced network signals
 * (e.g. rcv_rtt/rtt ratio) against a direct connection from the same
 * geography as the SOAX Dallas exit.
 */

test.describe('adversarial: direct-connection evasion bot', () => {
  test('puppeteer + no proxy + no spoofing', async ({ request }) => {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7727.15 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();

      const result = await runIntegrityPuppeteer(page);
      const fp = result.fingerprint;

      console.log('\n=== DIRECT-CONNECTION EVASION BOT ===');
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
