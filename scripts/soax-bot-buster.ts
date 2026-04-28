#!/usr/bin/env node
/**
 * SOAX × arcades.click/bot-buster runner.
 *
 * Same shape as soax-region-matrix.ts but points at the production
 * Bot-Buster page on arcades.click. The page auto-profiles on mount,
 * shows a typewriter prompt, then fades in a [ YES ] button. Bot waits
 * for the button, clicks it, and waits for STATUS: COMPLETE.
 *
 * Usage:
 *   PROXY_PASSWORD=… PROXY_PASSWORD_SOAX_MOBILE=… \
 *     npx tsx scripts/soax-bot-buster.ts
 *
 * Tunable via env: REGIONS, POOLS, COUNT (defaults: us / mobile,residential / 5).
 */
import { chromium } from 'playwright';
import { discoverExitIp, installWebrtcIpSpoof } from '../e2e/adversarial/helpers';
import { writeFileSync, mkdirSync } from 'node:fs';

const TARGET_URL = 'https://arcades.click/bot-buster';
const REGIONS = (process.env.REGIONS || 'us').split(',');
const POOLS = (process.env.POOLS || 'mobile,residential').split(',');
const COUNT = Number(process.env.COUNT || 5);
const SOAX_SERVER = 'http://proxy.soax.com:5000';
const RES_PASS = process.env.PROXY_PASSWORD || '';
const MOB_PASS = process.env.PROXY_PASSWORD_SOAX_MOBILE || '';

if (POOLS.includes('residential') && !RES_PASS) {
  throw new Error('PROXY_PASSWORD (residential) required');
}
if (POOLS.includes('mobile') && !MOB_PASS) {
  throw new Error('PROXY_PASSWORD_SOAX_MOBILE required');
}

const POOL_PKG: Record<string, string> = { mobile: '267217', residential: '267218' };
const POOL_PASS: Record<string, string> = { mobile: MOB_PASS, residential: RES_PASS };

function buildProxy(country: string, pool: string) {
  const token =
    'argus' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const username = `package-${POOL_PKG[pool]}-country-${country}-sessionid-${token}-sessionlength-300`;
  return { server: SOAX_SERVER, username, password: POOL_PASS[pool] };
}

async function runOne(country: string, pool: string, idx: number) {
  const proxy = buildProxy(country, pool);
  let browser;
  const startedAt = Date.now();
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: { ...proxy, bypass: 'localhost,127.0.0.1' },
    });
    let proxyIp: string | null = null;
    try {
      proxyIp = await discoverExitIp(browser);
    } catch {
      // discoverExitIp can fail on slow exits — proceed without WebRTC spoof
    }

    const page = await browser.newPage();
    if (proxyIp) await installWebrtcIpSpoof(page, proxyIp);

    await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // YES button fades in once the typewriter animation finishes
    // (~5s). Playwright auto-waits for it to become actionable.
    const yesBtn = page.getByRole('button', { name: /\[\s*YES\s*\]/ });
    await yesBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await yesBtn.click({ timeout: 30_000 });

    // STATUS line appears after click. Wait for COMPLETE (or DIAGNOSTIC OFFLINE).
    const status = await page
      .waitForFunction(
        () => {
          const el = Array.from(document.querySelectorAll('span')).find((n) =>
            /COMPLETE|DIAGNOSTIC OFFLINE|ANALYZING/.test(n.textContent || ''),
          );
          const t = el?.textContent || '';
          if (/COMPLETE/.test(t)) return 'COMPLETE';
          if (/OFFLINE/.test(t)) return 'OFFLINE';
          return null;
        },
        null,
        { timeout: 60_000, polling: 500 },
      )
      .then((h) => h.jsonValue() as Promise<string>);

    return {
      country,
      pool,
      idx,
      proxyIp,
      status,
      durationMs: Date.now() - startedAt,
      ok: status === 'COMPLETE',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      country,
      pool,
      idx,
      ok: false,
      error: msg.slice(0, 200),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  mkdirSync('/tmp/soax-bot-buster', { recursive: true });
  const results: unknown[] = [];
  const startedAt = new Date().toISOString();
  console.log(
    `Starting bot-buster: regions=${REGIONS.join(',')} pools=${POOLS.join(',')} count=${COUNT}`,
  );
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Total runs: ${REGIONS.length * POOLS.length * COUNT}\n`);

  for (const country of REGIONS) {
    for (const pool of POOLS) {
      console.log(`\n=== ${country.toUpperCase()} / ${pool} (×${COUNT}) ===`);
      for (let i = 0; i < COUNT; i++) {
        const r = await runOne(country, pool, i);
        if (r.ok) {
          console.log(
            `  ${i + 1}/${COUNT} ✓ ${r.status} via ${r.proxyIp ?? '(unknown)'} (${r.durationMs}ms)`,
          );
        } else {
          console.log(
            `  ${i + 1}/${COUNT} ✗ ${(r as { error?: string; status?: string }).error ?? (r as { status?: string }).status ?? 'unknown'}`,
          );
        }
        results.push(r);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = { startedAt, finishedAt, target: TARGET_URL, results };
  const outFile = `/tmp/soax-bot-buster/${startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${results.length} results to ${outFile}`);
  console.log(
    `Successful: ${results.filter((r) => (r as { ok: boolean }).ok).length}/${results.length}`,
  );
}

main().catch((err) => {
  console.error('Bot-buster runner crashed:', err);
  process.exit(1);
});
