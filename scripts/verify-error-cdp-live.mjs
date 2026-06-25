#!/usr/bin/env node
/**
 * Drives the deployed SDK through Playwright/CDP and verifies the worker
 * deep-stack Error burst lands in DDB and scores server-side.
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const getVal = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const LOADER_URL = getVal(
  'loader-url',
  'https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js',
);
const CPI = getVal('cpi', 'argus_cpi_test_b9UX4lEWFto8KHIeYlw5L4');
const STAGE = getVal('stage', 'dev-jw');
const MIN_DELTA_MS = Number(getVal('min-delta-ms', '30'));
const REGION = getVal('region', 'us-east-1');
const TABLE = `ms-argus-api-${STAGE}-integrity-results-v2`;

const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>cdp bot</title></head><body>
<script src="${LOADER_URL}"></script>
<script>
window.runArgus = async function() {
  if (!window.argus) throw new Error('no window.argus');
  return await window.argus.run({ cpi: ${JSON.stringify(CPI)} });
};
</script>
</body></html>`;

async function runBot() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.route('**/error-cdp-host', (route) =>
      route.fulfill({ contentType: 'text/html', body: HOST_PAGE }),
    );
    await page.goto('https://error-cdp-host.invalid/error-cdp-host');
    await page.waitForFunction(() => !!window.argus, { timeout: 20000 });
    return await page.evaluate(() => window.runArgus());
  } finally {
    await browser.close();
  }
}

async function readRow(sessionId) {
  const ddb = new DynamoDBClient({ region: REGION });
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: {
        cpi: { S: CPI },
        session_id: { S: sessionId },
      },
    }),
  );
  if (!out.Item) throw new Error(`row_not_found:${sessionId}`);
  return unmarshall(out.Item);
}

function mainFields(row) {
  const timing = row.device?.headless?.cdp?.consoleTimingWorker ?? {};
  const projection = row.merchant_projection ?? {};
  return {
    sessionId: row.session_id,
    deltaMs: timing.error_stack_burst_delta_ms,
    emptyMs: timing.error_stack_burst_empty_ms,
    heavyMs: timing.error_stack_burst_heavy_ms,
    iters: timing.error_stack_burst_iters,
    depth: timing.error_stack_burst_depth,
    automation: projection.automation,
    verdict: projection.verdict,
    projectionVersion: row.projection_version,
  };
}

const result = await runBot();
const sessionId = result?.argusSessionId;
if (!sessionId) throw new Error('argus_session_missing');

await new Promise((r) => setTimeout(r, 1200));
const row = await readRow(sessionId);
const fields = mainFields(row);
console.log(JSON.stringify(fields, null, 2));

if (typeof fields.deltaMs !== 'number' || fields.deltaMs < MIN_DELTA_MS) {
  throw new Error(
    `error_stack_delta_too_low:${fields.deltaMs} < ${MIN_DELTA_MS}`,
  );
}
if (typeof fields.automation !== 'number' || fields.automation < 75) {
  throw new Error(`automation_not_scored:${fields.automation}`);
}
if (fields.verdict !== 'block') {
  throw new Error(`projection_not_block:${fields.verdict}`);
}

