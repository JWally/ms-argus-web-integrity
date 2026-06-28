#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, inline] = arg.slice(2).split('=');
  const value = inline ?? process.argv[i + 1];
  args.set(key, value);
  if (inline === undefined) i++;
}

const runs = Number(args.get('runs') ?? 20);
const warmup = Number(args.get('warmup') ?? 3);
const port = Number(args.get('port') ?? 9173);
const outDir = resolve(String(args.get('out-dir') ?? 'bench-results'));
const bundlePath = resolve('dist/argus-bench.iife.js');

if (!existsSync(bundlePath)) {
  console.error('dist/argus-bench.iife.js is missing; run npm run bench:web');
  process.exit(1);
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
]);

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function summarize(values) {
  const clean = values.filter((n) => Number.isFinite(n));
  if (clean.length === 0) return null;
  const sum = clean.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...clean),
    p50: percentile(clean, 50),
    p95: percentile(clean, 95),
    max: Math.max(...clean),
    mean: sum / clean.length,
  };
}

function round(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function tableRow(name, summary) {
  if (!summary) return `| ${name} | n/a | n/a | n/a | n/a | n/a |`;
  return `| ${name} | ${round(summary.min)} | ${round(summary.p50)} | ${round(summary.p95)} | ${round(summary.max)} | ${round(summary.mean)} |`;
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>Argus web benchmark</title>
<script src="/dist/argus-bench.iife.js"></script>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/' || url.pathname === '/bench.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (!url.pathname.startsWith('/dist/')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const file = join(process.cwd(), url.pathname.slice(1));
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME.get(extname(file)) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error?.message ?? error));
  }
});

await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));

const browser = await chromium.launch();
const page = await browser.newPage();
const samples = [];
const headlessSamples = [];

try {
  await page.goto(`http://127.0.0.1:${port}/bench.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => Boolean(window.ArgusBench?.runBenchCollect));

  for (let i = 0; i < warmup + runs; i++) {
    const sample = await page.evaluate(async () => {
      const result = await window.ArgusBench.runBenchCollect();
      const profileTotalMs = Object.values(result.profile).reduce(
        (sum, n) => sum + (Number.isFinite(n) ? n : 0),
        0,
      );
      return {
        wallMs: result.wallMs,
        metaDurationMs: result.result?.meta?.durationMs ?? null,
        profileTotalMs,
        payloadBytes: result.payloadBytes,
        profile: result.profile,
      };
    });
    if (i >= warmup) samples.push(sample);
  }

  for (let i = 0; i < warmup + runs; i++) {
    const sample = await page.evaluate(async () => {
      return await window.ArgusBench.runHeadlessBench();
    });
    if (i >= warmup) headlessSamples.push(sample);
  }
} finally {
  await browser.close();
  server.close();
}

const profileKeys = [
  ...new Set(samples.flatMap((sample) => Object.keys(sample.profile))),
].sort();
const headlessProfileKeys = [
  ...new Set(headlessSamples.flatMap((sample) => Object.keys(sample.profile))),
].sort();

if (profileKeys.length === 0) {
  console.error(
    'No profile data was emitted. Rebuild with BUILD=bench rollup --config rollup.config.mjs, or use npm run bench:web.',
  );
  process.exit(1);
}

const summary = {
  runs,
  warmup,
  browser: 'chromium',
  mode: 'standalone collectIntegrity; no API submission',
  wallMs: summarize(samples.map((s) => s.wallMs)),
  metaDurationMs: summarize(samples.map((s) => s.metaDurationMs)),
  profileTotalMs: summarize(samples.map((s) => s.profileTotalMs)),
  payloadBytes: summarize(samples.map((s) => s.payloadBytes)),
  profile: Object.fromEntries(
    profileKeys.map((key) => [
      key,
      summarize(samples.map((sample) => Number(sample.profile[key] ?? NaN))),
    ]),
  ),
  samples,
  headlessBreakdown: Object.fromEntries(
    headlessProfileKeys.map((key) => [
      key,
      summarize(
        headlessSamples.map((sample) => Number(sample.profile[key] ?? NaN)),
      ),
    ]),
  ),
  headlessWallMs: summarize(headlessSamples.map((s) => s.wallMs)),
  headlessSamples,
};

await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, 'web-profile.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);

console.log(`# Argus Web Benchmark`);
console.log('');
console.log(`Mode: ${summary.mode}`);
console.log(`Runs: ${runs} measured, ${warmup} warmup`);
console.log('');
console.log('| Metric | min | p50 | p95 | max | mean |');
console.log('|---|---:|---:|---:|---:|---:|');
console.log(tableRow('wallMs', summary.wallMs));
console.log(tableRow('metaDurationMs', summary.metaDurationMs));
console.log(tableRow('profileTotalMs', summary.profileTotalMs));
console.log(tableRow('payloadBytes', summary.payloadBytes));
console.log('');
console.log('| Slice | min ms | p50 ms | p95 ms | max ms | mean ms |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const [name, stats] of Object.entries(summary.profile).sort(
  (a, b) => (b[1]?.p95 ?? 0) - (a[1]?.p95 ?? 0),
)) {
  console.log(tableRow(name, stats));
}
console.log('');
console.log('## Headless Breakdown');
console.log('');
console.log('| Probe | min ms | p50 ms | p95 ms | max ms | mean ms |');
console.log('|---|---:|---:|---:|---:|---:|');
console.log(tableRow('headlessWallMs', summary.headlessWallMs));
for (const [name, stats] of Object.entries(summary.headlessBreakdown).sort(
  (a, b) => (b[1]?.p95 ?? 0) - (a[1]?.p95 ?? 0),
)) {
  console.log(tableRow(name, stats));
}
console.log('');
console.log(`Wrote ${join(outDir, 'web-profile.json')}`);
