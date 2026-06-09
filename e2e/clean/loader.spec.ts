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

// Drive the DEPLOYED, isolated e2e SDK (static-integrity-e2e.argus.pw), which
// serves loader/iframe/worker so the real Worker submission path runs. The old
// localhost harness loaded a local build whose iframe fetched the worker
// cross-origin and only ever exercised the now-removed iframe fallback — so it
// never tested the worker path. Records still land in the dev-jw table (the e2e
// SDK submits to the dev-jw API), which integrity-store reads by default.
// Override the target with ARGUS_E2E_LOADER_URL.
const E2E_LOADER_URL =
  process.env.ARGUS_E2E_LOADER_URL ??
  'https://static-integrity-e2e.argus.pw/argus-loader.iife.js';
const HARNESS_URL = 'https://argus-e2e-harness.invalid/';
const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script src="${E2E_LOADER_URL}"></script></body></html>`;

test.describe('loader end-to-end', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(HARNESS_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: HARNESS_HTML }),
    );
    await page.goto(HARNESS_URL, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.evaluate(() => typeof (window as any).argus === 'object'))
      .toBeTruthy();
  });

  test('loader wraps integrity flow in srcdoc iframe, posts session id back, server stored the record', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const merchantSessionId = `pw-${Date.now()}`;

    // 2. Trigger the run and capture the result
    const cpi = process.env.ARGUS_TEST_CPI;
    const result = await page.evaluate(async ({ sid, c }) => {
      return await (window as any).argus.run({ sessionId: sid, timeoutMs: 20000, cpi: c });
    }, { sid: merchantSessionId, c: cpi }) as RunResult;

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

    // 7. Device-identity verification outcome is recorded. Bytecode signed
    //    xor(h2Token, KEY) with the persistent ECDSA pubkey; server verified.
    const ident = (record as Record<string, unknown>).identification as
      | { pubkey?: string; verified?: boolean; reason?: string | null }
      | undefined;
    expect(ident, 'identification section should be present').toBeTruthy();
    expect(ident!.verified, `identity verify failed: ${ident!.reason ?? 'n/a'}`).toBe(true);
    expect(ident!.pubkey).toMatch(/^[A-Za-z0-9+/=]{80,}$/);

    // 8. WebRTC sigint attestation — our own STUN server returned one or
    //    more encrypted XOR-MAPPED-ADDRESS blobs that the server decoded
    //    with the shared AES key. Outcomes depend on the runner's network:
    //      - single-homed (mobile, single NIC): `status: "ok"`, with a
    //        MAC-verified IPv4 extracted.
    //      - multi-NIC (dev boxes, VPN, dual-stack): `status: "multi_candidates"`
    //        — server refuses to silently pick one. No IP in that row.
    //    Both prove end-to-end wiring (client emits sigintCandidates,
    //    server decodes per policy, row gets webrtc_sigint attached).
    const analysis = (record as { analysis: Record<string, unknown> }).analysis;
    const webrtcSigint = analysis.webrtc_sigint as
      | {
          status?: string;
          candidate_count?: number;
          ip?: string;
          mac_valid?: boolean;
          fresh?: boolean;
        }
      | undefined;
    expect(webrtcSigint, 'analysis.webrtc_sigint should be present').toBeTruthy();
    expect(
      webrtcSigint!.candidate_count,
      'at least one sigintCandidate reached the server',
    ).toBeGreaterThanOrEqual(1);
    expect(
      webrtcSigint!.status,
      `webrtc_sigint status unexpected: ${JSON.stringify(webrtcSigint)}`,
    ).toMatch(/^(ok|multi_candidates)$/);

    // 9. IP-consistency analyzer ran and produced an integrity score.
    //    Two environment-dependent branches:
    const ipAnalysis = analysis.ip as {
      integrity?: number;
      ip?: string | null;
      ips?: { webrtc?: string | null };
    };
    expect(ipAnalysis, 'analysis.ip should be present').toBeTruthy();
    expect(typeof ipAnalysis.integrity, 'integrity score is a number').toBe(
      'number',
    );

    if (webrtcSigint!.status === 'ok') {
      // Single-candidate path: full MAC verification, IP is surfaced.
      expect(webrtcSigint!.mac_valid, 'STUN MAC should verify').toBe(true);
      expect(webrtcSigint!.fresh, 'STUN payload should be fresh').toBe(true);
      expect(webrtcSigint!.ip, 'decoded IP should be IPv4').toMatch(
        /^\d{1,3}(\.\d{1,3}){3}$/,
      );
      expect(
        ipAnalysis.integrity,
        `integrity score too low from a clean browser: ${ipAnalysis.integrity}`,
      ).toBeGreaterThanOrEqual(0.5);
      expect(
        ipAnalysis.ip,
        'representative IP surfaced at integrity ≥ 0.5',
      ).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      expect(ipAnalysis.ips?.webrtc).toBe(webrtcSigint!.ip);
    } else {
      // Multi-candidate path: server correctly refuses to pick a single
      // IP. Score collapses to the "no webrtc" tier (0.5) because we have
      // no MAC-verified evidence to compare against probes.
      expect(
        ipAnalysis.integrity,
        'multi-candidate: integrity should collapse to ≤ 0.5 (no verified webrtc)',
      ).toBeLessThanOrEqual(0.5);
    }
  });

  test('superseded run rejects first, resolves second', async ({ page }) => {
    const cpi = process.env.ARGUS_TEST_CPI;
    const outcome = await page.evaluate(async (c) => {
      const a = (window as any).argus.run({ sessionId: 'first', timeoutMs: 20000, cpi: c });
      // Start second run immediately — should supersede the first.
      const b = (window as any).argus.run({ sessionId: 'second', timeoutMs: 20000, cpi: c });
      const aResult = await a.then(
        (r: unknown) => ({ ok: true, r }),
        (e: Error) => ({ ok: false, error: e.message }),
      );
      const bResult = await b.then(
        (r: unknown) => ({ ok: true, r }),
        (e: Error) => ({ ok: false, error: e.message }),
      );
      return { aResult, bResult };
    }, cpi);

    expect(outcome.aResult.ok, `first run should reject: ${JSON.stringify(outcome.aResult)}`).toBe(false);
    expect((outcome.aResult as { error: string }).error).toContain('superseded');
    expect(outcome.bResult.ok, `second run should resolve: ${JSON.stringify(outcome.bResult)}`).toBe(true);
  });

  test('destroy() rejects in-flight run', async ({ page }) => {
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
