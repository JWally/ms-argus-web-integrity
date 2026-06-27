#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const STATIC_ORIGIN =
  process.env.ARGUS_STATIC_ORIGIN ?? 'https://static-integrity-dev-jw.argus.pw';
const PAIR_ORIGIN =
  process.env.ARGUS_PAIR_ORIGIN ?? 'https://captcha-dev-jw.argus.pw';
const PREVIOUS_URLS = (process.env.ARGUS_RELEASE_PREVIOUS_URLS ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

function fail(message, detail = {}) {
  console.error(
    JSON.stringify({ ok: false, error: message, ...detail }, null, 2),
  );
  process.exit(1);
}

async function fetchBytes(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const body = Buffer.from(await res.arrayBuffer());
  return { url, status: res.status, body, headers: res.headers };
}

function sri384(bytes) {
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

async function assertFetch(url) {
  const { status } = await fetchBytes(url);
  if (status !== 200) fail('release_asset_unavailable', { url, status });
  return { url, status };
}

async function main() {
  const manifestRes = await fetch(`${STATIC_ORIGIN}/argus-manifest.json`, {
    cache: 'no-store',
    headers: { Origin: PAIR_ORIGIN },
  });
  if (!manifestRes.ok) {
    fail('manifest_unavailable', { status: manifestRes.status });
  }
  const manifest = await manifestRes.json();
  const releaseId = manifest?.payload?.releaseId;
  const loaderUrl = manifest?.payload?.loader?.url;
  const loaderIntegrity = manifest?.payload?.loader?.integrity;
  if (!releaseId || !loaderUrl || !loaderIntegrity) {
    fail('manifest_shape_invalid', { manifest });
  }
  if (/[+/=]/.test(releaseId)) {
    fail('release_id_not_path_safe', { releaseId });
  }
  if (!loaderUrl.includes(`/releases/${releaseId}/`)) {
    fail('loader_not_release_scoped', { releaseId, loaderUrl });
  }

  const loader = await fetchBytes(loaderUrl);
  if (loader.status !== 200) {
    fail('loader_unavailable', { loaderUrl, status: loader.status });
  }
  const actualLoaderIntegrity = sri384(loader.body);
  if (actualLoaderIntegrity !== loaderIntegrity) {
    fail('loader_sri_mismatch', {
      loaderUrl,
      expected: loaderIntegrity,
      actual: actualLoaderIntegrity,
    });
  }

  const releaseBase = loaderUrl.replace(/\/argus-loader\.iife\.js$/, '');
  const iframeUrl = `${releaseBase}/argus-integrity-iframe.iife.js`;
  const workerUrl = `${releaseBase}/argus-integrity-worker.iife.js`;
  const releaseAssets = await Promise.all([
    assertFetch(iframeUrl),
    assertFetch(workerUrl),
    ...PREVIOUS_URLS.map((url) => assertFetch(url)),
  ]);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('requestfailed', (req) => {
    errors.push(`request failed ${req.url()} ${req.failure()?.errorText}`);
  });
  await page.goto(PAIR_ORIGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.argus?.run, null, {
    timeout: 10_000,
  });
  const browserCheck = await page.evaluate(() => ({
    argusRunType: typeof window.argus?.run,
    bootstrapReady: Boolean(window.argusBootstrapReady),
  }));
  await browser.close();

  const fatalErrors = errors.filter(
    (error) =>
      error.includes('argus-bootstrap') ||
      error.includes('argus-manifest') ||
      error.includes('argus-loader') ||
      error.includes('argus-integrity'),
  );
  if (fatalErrors.length > 0) {
    fail('browser_loader_errors', { fatalErrors, errors });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        releaseId,
        loaderUrl,
        loaderIntegrity,
        releaseAssets,
        browserCheck,
      },
      null,
      2,
    ),
  );
}

await main();
