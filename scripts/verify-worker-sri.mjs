import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const publicDir = join(root, 'public');
const distDir = join(root, 'dist');
const workerPath = join(distDir, 'argus-integrity-worker.iife.js');
const workerUrl =
  'https://static-integrity-dev-jw.argus.pw/argus-integrity-worker.iife.js';

function contentType(pathname) {
  switch (extname(pathname)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function safeJoin(base, pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  return join(base, normalized);
}

function serveStatic(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const base = url.pathname.startsWith('/dist/') ? root : publicDir;
  const path = safeJoin(base, url.pathname === '/' ? '/test-loader.html' : url.pathname);
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'content-type': contentType(path) });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

async function listen(server) {
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') reject(new Error('listen_failed'));
      else resolve(addr.port);
    });
  });
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const workerBytes = readFileSync(workerPath, 'utf8');
  const server = createServer(serveStatic);
  const port = await listen(server);
  const browser = await chromium.launch({ headless: true });
  let integrityPosts = 0;
  let workerRequests = 0;

  try {
    const page = await browser.newPage();
    await page.route(workerUrl, async (route) => {
      workerRequests += 1;
      await route.fulfill({
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'application/javascript; charset=utf-8',
        },
        body: `${workerBytes}\n// tampered by verify-worker-sri\n`,
      });
    });
    await page.route('https://api-dev-jw.argus.pw/v1/integrity-collect', async (route) => {
      integrityPosts += 1;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: 'unexpected-post' }),
      });
    });

    await page.goto(`http://127.0.0.1:${port}/test-loader.html`);
    const result = await page.evaluate(async () => {
      try {
        const run = await window.__runArgus({
          sessionId: 'worker-sri-rewrite-smoke',
          timeoutMs: 10000,
          cpi: 'argus_cpi_test_workerSriSmoke',
        });
        return { ok: true, run };
      } catch (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : String(err),
        };
      }
    });

    if (workerRequests !== 1) {
      throw new Error(`expected 1 worker request, saw ${workerRequests}`);
    }
    if (result.ok) {
      throw new Error(`tampered worker unexpectedly succeeded: ${JSON.stringify(result.run)}`);
    }
    if (!String(result.error).includes('worker_unavailable')) {
      throw new Error(`expected worker_unavailable failure, got: ${result.error}`);
    }
    if (integrityPosts !== 0) {
      throw new Error(`tampered worker reached integrity API ${integrityPosts} time(s)`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          workerRequests,
          integrityPosts,
          error: result.error,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await close(server);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
