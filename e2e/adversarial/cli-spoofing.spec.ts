/**
 * CLI-arg spoofing bot — Puppeteer with Chrome command-line flags only.
 *
 * Cleaner than naive-spoofing (Object.defineProperty) and stealth
 * (Proxy-wrapped getters) because nothing is patched at runtime:
 *   - `--disable-blink-features=AutomationControlled` removes the
 *     `navigator.webdriver` flag at the Chromium source. Not patched
 *     to false — actually undefined. No descriptor tells.
 *   - `--user-agent=...` sets the UA at the browser level before any
 *     JS runs. Consistent across main/worker/fetch. No
 *     Object.defineProperty on Navigator.prototype, no lies scanner hit.
 *   - `ignoreDefaultArgs: ['--enable-automation']` strips the default
 *     Puppeteer automation marker flag.
 *
 * No proxy. No runtime JS patching. UA is shifted to Chrome 120 — 27
 * versions below what PW actually runs (147) — to probe whether the
 * server's engine-stable signal baselines catch the mismatch (they
 * don't yet; see earlier notes about baseline detector not being wired
 * into the integrity ingestion path).
 *
 * Detection paths we're watching:
 *   - Does the shared-worker realm honor the --user-agent override, or
 *     does it leak the real HeadlessChrome UA? (answer so far: CLI UA
 *     propagates, no main↔shared divergence)
 *   - Do environmental headless signals fire — noTaskbar,
 *     hasSoftwareRenderer, devToolsOpen? (answer: yes, 4/11 firing)
 */

import { test, expect } from '@playwright/test';
import puppeteer from 'puppeteer';
import { runIntegrityPuppeteer, fetchAdversarialRecord } from './helpers';

const SPOOFED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.129 Safari/537.36';

test.describe('adversarial: CLI-arg spoofing', () => {
  test('chrome launch flags hide automation without runtime patching', async () => {
    const browser = await puppeteer.launch({
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--user-agent=${SPOOFED_UA}`,
        '--lang=en-US',
        '--window-size=1920,1080',
      ],
    });

    try {
      const page = await browser.newPage();
      const result = await runIntegrityPuppeteer(page);

      const record = await fetchAdversarialRecord(result.argusSessionId);
      const dev = (record.device ?? {}) as Record<string, unknown>;
      const headless = (dev.headless ?? {}) as Record<string, unknown>;
      const hard = (headless.headless ?? {}) as Record<string, boolean>;
      const nav = (dev.navigator ?? {}) as { userAgent?: string };
      const lies = (dev.lies ?? {}) as {
        totalLies?: number;
        data?: Record<string, unknown>;
      };

      console.log('CLI-spoofing result:', {
        sessionId: result.argusSessionId,
        claimedUA: nav.userAgent,
        webDriverIsOn: hard.webDriverIsOn,
        hasHeadlessUA: hard.hasHeadlessUA,
        hasHeadlessWorkerUA: hard.hasHeadlessWorkerUA,
        headlessRating: headless.likeHeadlessRating,
        stealthRating: headless.stealthRating,
        totalLies: lies.totalLies,
        liesKeys: lies.data ? Object.keys(lies.data).slice(0, 10) : [],
      });

      expect(result.argusSessionId, 'Should get a session ID').toBeTruthy();

      // UA spoof worked at the main-thread level
      expect(
        nav.userAgent,
        'main-thread UA should be the spoofed Chrome 120',
      ).toContain('Chrome/120');
    } finally {
      await browser.close();
    }
  });
});
