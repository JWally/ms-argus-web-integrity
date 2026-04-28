#!/usr/bin/env node
/**
 * SOAX region × pool matrix runner.
 *
 * For each (country, pool) combination, launches N chromium sessions through
 * SOAX with a country-pinned exit, runs the integrity flow, and records the
 * argus session id. Results are written to a JSON file so a separate analysis
 * step can pull the matching S3 records.
 *
 * Usage:
 *   PROXY_PASSWORD=…              \  # SOAX residential pool (pkg 267218)
 *   PROXY_PASSWORD_SOAX_MOBILE=…  \  # SOAX mobile pool     (pkg 267217)
 *   node scripts/soax-region-matrix.mjs
 *
 * Tunable via env: REGIONS, POOLS, COUNT (defaults below).
 */
import { chromium } from 'playwright';
import {
  discoverExitIp,
  installWebrtcIpSpoof,
  BASE_URL,
} from '../e2e/adversarial/helpers';
import { writeFileSync, mkdirSync } from 'node:fs';

const REGIONS = (process.env.REGIONS || 'gb,de,au,br').split(',');
const POOLS = (process.env.POOLS || 'mobile,residential').split(',');
const COUNT = Number(process.env.COUNT || 20);
const SOAX_SERVER = 'http://proxy.soax.com:5000';
const RES_PASS = process.env.PROXY_PASSWORD || '';
const MOB_PASS = process.env.PROXY_PASSWORD_SOAX_MOBILE || '';

if (!RES_PASS) throw new Error('PROXY_PASSWORD (residential) required');
if (!MOB_PASS) throw new Error('PROXY_PASSWORD_SOAX_MOBILE required');

const POOL_PKG = { mobile: '267217', residential: '267218' };
const POOL_PASS = { mobile: MOB_PASS, residential: RES_PASS };

function buildProxy(country, pool) {
  const token =
    'argus' +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
  const username = `package-${POOL_PKG[pool]}-country-${country}-sessionid-${token}-sessionlength-300`;
  return { server: SOAX_SERVER, username, password: POOL_PASS[pool] };
}

async function runOne(country, pool, idx) {
  const proxy = buildProxy(country, pool);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: { ...proxy, bypass: 'localhost,127.0.0.1' },
    });
    let proxyIp = null;
    try {
      proxyIp = await discoverExitIp(browser);
    } catch {
      // discoverExitIp can fail on slow exits — proceed without WebRTC spoof
    }

    const page = await browser.newPage();
    if (proxyIp) await installWebrtcIpSpoof(page, proxyIp);

    await page.goto(`${BASE_URL}/test-loader.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => typeof window.argus === 'object',
      { timeout: 10_000 },
    );
    const result = await page.evaluate(async () => {
      return await window.argus.run({
        sessionId: `soax-matrix-${Date.now()}`,
        timeoutMs: 30_000,
      });
    });
    return {
      country,
      pool,
      idx,
      argusSessionId: result.argusSessionId,
      proxyIp,
      durationMs: result.durationMs,
      ok: true,
    };
  } catch (err) {
    return {
      country,
      pool,
      idx,
      ok: false,
      error: String(err?.message || err).slice(0, 200),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  mkdirSync('/tmp/soax-matrix', { recursive: true });
  const results = [];
  const startedAt = new Date().toISOString();
  console.log(
    `Starting matrix: regions=${REGIONS.join(',')} pools=${POOLS.join(',')} count=${COUNT}`,
  );
  console.log(
    `Total runs: ${REGIONS.length * POOLS.length * COUNT}\n`,
  );

  for (const country of REGIONS) {
    for (const pool of POOLS) {
      console.log(`\n=== ${country.toUpperCase()} / ${pool} (×${COUNT}) ===`);
      for (let i = 0; i < COUNT; i++) {
        const r = await runOne(country, pool, i);
        if (r.ok) {
          console.log(
            `  ${i + 1}/${COUNT} ✓ ${r.argusSessionId.slice(0, 8)} via ${r.proxyIp ?? '(unknown)'} (${r.durationMs}ms)`,
          );
        } else {
          console.log(`  ${i + 1}/${COUNT} ✗ ${r.error}`);
        }
        results.push(r);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = { startedAt, finishedAt, results };
  const outFile = `/tmp/soax-matrix/${startedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${results.length} results to ${outFile}`);
  console.log(
    `Successful: ${results.filter((r) => r.ok).length}/${results.length}`,
  );
}

main().catch((err) => {
  console.error('Matrix runner crashed:', err);
  process.exit(1);
});
