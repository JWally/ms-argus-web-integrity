#!/usr/bin/env node
/**
 * Drives the deployed Argus SDK twice in the same browser context to
 * verify the localStorage('cache') round-trip works end-to-end:
 *
 *   run 1 — fresh context, localStorage empty
 *     → bot should NOT send payload.cache
 *     → server stores row with freshDevice=true, scanCount=0
 *     → server response has .cache
 *     → SDK writes localStorage('cache') = <blob>
 *
 *   run 2 — same context, localStorage('cache') populated
 *     → bot should send payload.cache
 *     → server stores row with freshDevice=false, scanCount=1
 *
 * Reads DDB to confirm both rows' analysis.device_history.
 *
 * Usage: node bots/cache-roundtrip-real-sdk.mjs [--loader-url <url>] [--cpi <cpi>]
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";

const argv = process.argv.slice(2);
const getVal = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : d;
};
const LOADER_URL = getVal(
  "loader-url",
  "https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js",
);
const CPI = getVal("cpi", "argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4");
const STAGE = "dev-jw";
const DDB_TABLE = `ms-argus-api-${STAGE}-integrity-results-v2`;

function readDeviceHistory(sessionId) {
  const cmd = [
    "aws", "dynamodb", "get-item",
    "--region", "us-east-1",
    "--table-name", DDB_TABLE,
    "--key", JSON.stringify({ cpi: { S: CPI }, session_id: { S: sessionId } }),
    "--projection-expression", "#a.device_history",
    "--expression-attribute-names", JSON.stringify({ "#a": "analysis" }),
    "--output", "json",
  ].map((s) => `'${s.replace(/'/g, "'\\''")}'`).join(" ");
  const out = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  const item = JSON.parse(out)?.Item;
  const dh = item?.analysis?.M?.device_history?.M;
  if (!dh) return null;
  return {
    freshDevice: dh.freshDevice?.BOOL,
    tampered: dh.tampered?.BOOL,
    scanCount: Number(dh.scanCount?.N),
    distinctIpCount: Number(dh.distinctIpCount?.N),
    ageSeconds: Number(dh.ageSeconds?.N),
  };
}

const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cache rt</title></head><body>
<script src="${LOADER_URL}"></script>
<script>
window.runArgus = async function() {
  if (!window.argus) throw new Error('no window.argus');
  return await window.argus.run({ cpi: ${JSON.stringify(CPI)} });
};
window.readCache = function() {
  try { return localStorage.getItem('cache') || ''; } catch { return ''; }
};
</script>
</body></html>`;

async function oneRun(label, context) {
  console.log(`\n[${label}] opening page, triggering scan...`);
  const page = await context.newPage();
  await page.route("**/cache-rt-host", (route) =>
    route.fulfill({ contentType: "text/html", body: HOST_PAGE }),
  );
  await page.goto("https://cache-rt-host.invalid/cache-rt-host");
  // wait until the SDK loader is present
  await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
  const cacheBefore = await page.evaluate(() => window.readCache());
  console.log(`[${label}] localStorage('cache') before scan: ${cacheBefore ? cacheBefore.slice(0, 24) + "... (" + cacheBefore.length + " chars)" : "<empty>"}`);
  const result = await page.evaluate(() => window.runArgus());
  const cacheAfter = await page.evaluate(() => window.readCache());
  console.log(`[${label}] localStorage('cache') after scan: ${cacheAfter ? cacheAfter.slice(0, 24) + "... (" + cacheAfter.length + " chars)" : "<empty>"}`);
  console.log(`[${label}] argusSessionId: ${result?.argusSessionId}`);
  await page.close();
  // give DDB a moment to settle
  await new Promise((r) => setTimeout(r, 1000));
  const dh = readDeviceHistory(result.argusSessionId);
  console.log(`[${label}] row.analysis.device_history: ${JSON.stringify(dh)}`);
  return { sessionId: result.argusSessionId, cacheBefore, cacheAfter, dh };
}

async function main() {
  console.log(`[cfg] loader=${LOADER_URL} cpi=${CPI}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    const r1 = await oneRun("run 1", context);
    const r2 = await oneRun("run 2", context);

    console.log(`\n[verdict]`);
    const checks = [
      [r1.cacheBefore === "", "run 1: localStorage('cache') was empty going in"],
      [r1.cacheAfter.length > 0, "run 1: localStorage('cache') written by SDK on response"],
      [r1.dh?.freshDevice === true, "run 1: server saw freshDevice=true"],
      [r1.dh?.scanCount === 0, "run 1: server saw scanCount=0"],
      [r2.cacheBefore === r1.cacheAfter, "run 2: SDK persisted cache between scans"],
      [r2.cacheAfter !== r1.cacheAfter, "run 2: SDK wrote a NEW blob on response (server appended visit)"],
      [r2.dh?.freshDevice === false, "run 2: server saw freshDevice=false (blob round-tripped)"],
      [r2.dh?.scanCount === 1, "run 2: server saw scanCount=1 (one prior visit)"],
    ];
    let allOk = true;
    for (const [ok, label] of checks) {
      console.log(`  ${ok ? "✓" : "✗"} ${label}`);
      if (!ok) allOk = false;
    }
    console.log();
    console.log(allOk ? "  [CLOSED] cache round-trip via real SDK works end-to-end" : "  [MISMATCH] inspect output");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error("[fatal]", e); process.exit(1); });
