import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

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
  test('puppeteer + no proxy + no spoofing', async () => {
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
      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const ana = (record.analysis ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const lies = (dev.lies ?? {}) as {
        totalLies?: number;
        data?: Record<string, unknown>;
      };
      const worker = (ana.worker ?? {}) as {
        lied?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        divergences?: any[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signals?: any[];
      };
      const timezone = (ana.timezone ?? {}) as {
        lied?: boolean;
        cfTimezone?: string;
        clientTimezone?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        checks?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signals?: any[];
      };
      const ip = (ana.ip ?? {}) as {
        lied?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ips?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        checks?: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signals?: any[];
      };
      const network = (ana.network ?? {}) as {
        proxy_score?: number;
        vpn_score?: number;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signals?: any[];
      };

      console.log('\n=== DIRECT-CONNECTION EVASION BOT ===');
      console.log('Session:', result.argusSessionId);
      console.log('Headless rating:', headless.likeHeadlessRating);
      console.log('Headless hard:', headless.headless);
      console.log('Stealth rating:', headless.stealthRating);
      console.log('Total lies:', lies.totalLies);
      console.log('Lies data:', lies.data ? Object.keys(lies.data) : []);
      console.log('WebRTC:', dev.webrtc);
      console.log('Client TZ:', (dev.timezone as { location?: string })?.location);
      console.log('Client offset:', (dev.timezone as { offset?: number })?.offset);
      console.log(
        'Computed offset:',
        (dev.timezone as { offsetComputed?: number })?.offsetComputed,
      );

      expect(result.argusSessionId).toBeTruthy();

      console.log('\n=== SERVER ANALYSIS ===');
      console.log('Worker lied:', worker.lied);
      console.log(
        'Worker divergences:',
        worker.divergences?.map((d) => d.field),
      );
      console.log('Timezone lied:', timezone.lied);
      console.log('Timezone CF:', timezone.cfTimezone);
      console.log('Timezone client:', timezone.clientTimezone);
      console.log('TZ checks:', timezone.checks);
      console.log('IP lied:', ip.lied);
      console.log('IP probes consistent:', ip.checks?.probesConsistent);
      console.log('IP WebRTC matches:', ip.checks?.webrtcMatchesProbes);
      console.log('IP addresses:', ip.ips);
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
