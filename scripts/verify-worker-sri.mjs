import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = normalize(
  join(fileURLToPath(new URL('.', import.meta.url)), '..'),
);
const publicDir = join(root, 'public');
const distDir = join(root, 'dist');
const iframePath = join(distDir, 'argus-integrity-iframe.iife.js');
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
  const path = safeJoin(
    base,
    url.pathname === '/' ? '/test-loader.html' : url.pathname,
  );
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

async function runArgus(page, port, sessionId) {
  await page.goto(`http://127.0.0.1:${port}/test-loader.html`);
  return await page.evaluate(async (sid) => {
    try {
      const run = await window.__runArgus({
        sessionId: sid,
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
  }, sessionId);
}

async function verifyTamperedWorker(browser, port) {
  const workerBytes = readFileSync(workerPath, 'utf8');
  let integrityPosts = 0;
  let workerRequests = 0;
  const page = await browser.newPage();

  try {
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
    await page.route(
      'https://api-dev-jw.argus.pw/v1/integrity-collect',
      async (route) => {
        integrityPosts += 1;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: 'unexpected-post' }),
        });
      },
    );

    const result = await runArgus(page, port, 'worker-sri-rewrite-smoke');

    if (workerRequests !== 1) {
      throw new Error(`expected 1 worker request, saw ${workerRequests}`);
    }
    if (result.ok) {
      throw new Error(
        `tampered worker unexpectedly succeeded: ${JSON.stringify(result.run)}`,
      );
    }
    if (!String(result.error).includes('worker_unavailable')) {
      throw new Error(
        `expected worker_unavailable failure, got: ${result.error}`,
      );
    }
    if (integrityPosts !== 0) {
      throw new Error(
        `tampered worker reached integrity API ${integrityPosts} time(s)`,
      );
    }

    return {
      workerRequests,
      integrityPosts,
      error: resultError(result),
    };
  } finally {
    await page.close();
  }
}

async function verifyTamperedIframe(browser, port) {
  const iframeBytes = readFileSync(iframePath, 'utf8');
  let iframeRequests = 0;
  let workerRequests = 0;
  let integrityPosts = 0;
  const page = await browser.newPage();

  try {
    await page.route(
      '**/dist/argus-integrity-iframe.iife.js*',
      async (route) => {
        iframeRequests += 1;
        await route.fulfill({
          status: 200,
          headers: {
            'access-control-allow-origin': '*',
            'content-type': 'application/javascript; charset=utf-8',
          },
          body: `${iframeBytes}\n// tampered by verify-worker-sri\n`,
        });
      },
    );
    await page.route(workerUrl, async (route) => {
      workerRequests += 1;
      await route.fulfill({ status: 500, body: 'unexpected worker request' });
    });
    await page.route(
      'https://api-dev-jw.argus.pw/v1/integrity-collect',
      async (route) => {
        integrityPosts += 1;
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: 'unexpected-post' }),
        });
      },
    );

    const result = await runArgus(page, port, 'iframe-sri-rewrite-smoke');

    if (iframeRequests !== 1) {
      throw new Error(`expected 1 iframe request, saw ${iframeRequests}`);
    }
    if (result.ok) {
      throw new Error(
        `tampered iframe unexpectedly succeeded: ${JSON.stringify(result.run)}`,
      );
    }
    if (!String(result.error).includes('inner script load failed')) {
      throw new Error(
        `expected inner script load failure, got: ${result.error}`,
      );
    }
    if (workerRequests !== 0) {
      throw new Error(
        `tampered iframe reached worker ${workerRequests} time(s)`,
      );
    }
    if (integrityPosts !== 0) {
      throw new Error(
        `tampered iframe reached integrity API ${integrityPosts} time(s)`,
      );
    }

    return {
      iframeRequests,
      workerRequests,
      integrityPosts,
      error: resultError(result),
    };
  } finally {
    await page.close();
  }
}

function resultError(result) {
  return result.ok ? null : result.error;
}

async function main() {
  const server = createServer(serveStatic);
  const port = await listen(server);
  const browser = await chromium.launch({ headless: true });

  try {
    const worker = await verifyTamperedWorker(browser, port);
    const iframe = await verifyTamperedIframe(browser, port);
    console.log(
      JSON.stringify(
        {
          ok: true,
          worker,
          iframe,
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
