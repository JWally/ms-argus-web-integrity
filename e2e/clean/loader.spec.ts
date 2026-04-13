/**
 * Loader smoke test — POC coverage.
 *
 * Drives /test-loader.html through the loader's programmatic entry point
 * and verifies the full pipeline:
 *   1. window.argus registers
 *   2. argus.run() creates exactly one iframe[data-argus-loader]
 *   3. Inner bundle runs, VM submits to the baked-in API, gets a session id
 *   4. Iframe is removed after resolve
 *   5. The submission landed in DynamoDB (read directly, not via the
 *      merchant-facing GET /v1/integrity-session endpoint — see note)
 *
 * Note on storage assertion: this test reads DynamoDB directly rather
 * than via the public API. The merchant-facing endpoint will be tightened
 * in the future to return only a small set of merchant-safe fields
 * (score / decision / a few flags), so coupling the test to its current
 * "return everything" shape would create a footgun: when we ship the
 * response-shaping work, the test would either silently lose coverage or
 * silently break. DDB is the source of truth and is more stable.
 *
 * Requires AWS credentials available to the test runner (default credential
 * chain). Locally: standard AWS_PROFILE / ~/.aws/credentials. CI: same
 * mechanism that lets CDK deploy the stack.
 */

import { test, expect } from '@playwright/test';
import { fetchIntegrityRecord } from '../utils/integrity-store';

interface RunResult {
  sessionId: string | null;
  argusSessionId: string;
  durationMs: number;
}

test.describe('loader end-to-end', () => {
  test('loader wraps integrity flow in srcdoc iframe, posts session id back, server stored the record', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/test-loader.html');

    // 1. Loader registered
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).argus === 'object'))
      .toBeTruthy();

    const merchantSessionId = `pw-${Date.now()}`;

    // 2. Trigger the run and capture the result
    const result = await page.evaluate(async (sid) => {
      return await (window as any).__runArgus({ sessionId: sid, timeoutMs: 20000 });
    }, merchantSessionId) as RunResult;

    // 3. Result shape
    expect(result.sessionId).toBe(merchantSessionId);
    expect(result.argusSessionId, 'server returned session id').toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.durationMs).toBeLessThan(20000);

    // 4. Iframe cleaned up
    const iframeCount = await page.evaluate(
      () =>
        document.querySelectorAll('iframe[data-argus-loader]').length,
    );
    expect(iframeCount, 'iframe removed after resolve').toBe(0);

    // 5. No console errors from the loader path
    const loaderErrors = consoleErrors.filter((e) =>
      e.includes('argus-loader'),
    );
    expect(loaderErrors, `loader errors: ${loaderErrors.join(' | ')}`).toEqual([]);

    // 6. Server stored it — DDB direct lookup. Bound to storage shape, not
    //    the merchant-facing API response shape (which will tighten later).
    const record = await fetchIntegrityRecord(result.argusSessionId);
    expect(record, `no integrity record found for ${result.argusSessionId}`).toBeTruthy();
    expect(record!.session_id).toBe(result.argusSessionId);
    expect(typeof record!.created_at).toBe('number');
    // Device payload was decrypted server-side and stored
    expect(record!.device, 'device payload should be present').toBeTruthy();
    // Server ran its analyzers
    expect(record!.analysis, 'analysis block should be present').toBeTruthy();
  });

  test('superseded run rejects first, resolves second', async ({ page }) => {
    await page.goto('/test-loader.html');
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).argus === 'object'))
      .toBeTruthy();

    const outcome = await page.evaluate(async () => {
      const a = (window as any).argus.run({ sessionId: 'first', timeoutMs: 20000 });
      // Start second run immediately — should supersede the first.
      const b = (window as any).argus.run({ sessionId: 'second', timeoutMs: 20000 });
      const aResult = await a.then(
        (r: unknown) => ({ ok: true, r }),
        (e: Error) => ({ ok: false, error: e.message }),
      );
      const bResult = await b.then(
        (r: unknown) => ({ ok: true, r }),
        (e: Error) => ({ ok: false, error: e.message }),
      );
      return { aResult, bResult };
    });

    expect(outcome.aResult.ok, `first run should reject: ${JSON.stringify(outcome.aResult)}`).toBe(false);
    expect((outcome.aResult as { error: string }).error).toContain('superseded');
    expect(outcome.bResult.ok, `second run should resolve: ${JSON.stringify(outcome.bResult)}`).toBe(true);
  });

  test('destroy() rejects in-flight run', async ({ page }) => {
    await page.goto('/test-loader.html');
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).argus === 'object'))
      .toBeTruthy();

    const err = await page.evaluate(async () => {
      const p = (window as any).argus.run({ sessionId: 'will-be-killed', timeoutMs: 20000 });
      (window as any).argus.destroy();
      try {
        await p;
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });

    expect(err).toContain('destroyed');
  });
});
