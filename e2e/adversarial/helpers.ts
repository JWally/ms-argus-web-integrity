import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { expect } from '@playwright/test';
import type {
  Browser as PlaywrightBrowser,
  Page as PlaywrightPage,
} from 'playwright';
import type { Page as PuppeteerPage } from 'puppeteer';
import { fetchIntegrityRecord } from '../utils/integrity-store';

export const BASE_URL = 'http://localhost:9100';

/**
 * Some stealth engines (Camoufox, nodriver, CloakBrowser) ship only as
 * Python packages and live in sibling repos' virtualenvs, so we can't
 * import them into this TS/Playwright suite. Instead a tiny per-tool
 * Python runner drives the loader page and prints the argus session id;
 * these helpers locate the interpreter and shell out to the runner.
 */
export function findVenvPython(candidates: string[]): string | null {
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/**
 * Run a Python browser-runner script and return the argus session id it
 * printed. The runner MUST emit a single line `ARGUS_SESSION_ID=<uuid>`.
 * LOADER_URL + ARGUS_TEST_CPI are passed through the environment.
 */
export function runPythonBrowserRunner(
  pythonBin: string,
  scriptPath: string,
  extraEnv: Record<string, string> = {},
): string {
  const out = execFileSync(pythonBin, [scriptPath], {
    env: {
      ...process.env,
      // Autorun page bakes cpi/sid into the URL and exposes the result via
      // the DOM, so Python drivers only need DOM reads — no main-world eval.
      LOADER_URL: autorunUrl(),
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const m = out.match(/ARGUS_SESSION_ID=([0-9a-f-]{36})/i);
  if (!m) {
    throw new Error(`python runner emitted no session id. stdout:\n${out}`);
  }
  return m[1];
}

/**
 * Result returned by runIntegrityPuppeteer — mirrors what
 * window.argus.run() gives the merchant page: just the session id and
 * duration. No fingerprint data leaks to the parent realm; tests that
 * want to assert on fingerprint structure fetch the stored record from
 * DynamoDB via fetchIntegrityRecord.
 */
export interface LoaderRunResult {
  /** Merchant-supplied correlation id (what we passed in) */
  sessionId: string;
  /** Argus-generated UUID, the key into DDB + S3 archives */
  argusSessionId: string;
  /** Run duration in ms */
  durationMs: number;
}

/**
 * Drive a Puppeteer page through the loader path — the production
 * integration. Bot runs in parent realm; argus-loader.js creates a
 * srcdoc iframe; the integrity bundle executes in the iframe realm;
 * postMessage returns the argusSessionId to the page.
 *
 * Previously this hit /test-integrity.html (library path, parent
 * realm). Now hits /test-loader.html which uses window.argus.run().
 *
 * Assertions on fingerprint fields move to the returned argusSessionId
 * → fetchIntegrityRecord(id).device.* lookup.
 */
export async function runIntegrityPuppeteer(
  page: PuppeteerPage,
  opts: { sessionId?: string; timeoutMs?: number } = {},
): Promise<LoaderRunResult> {
  await page.goto(`${BASE_URL}/test-loader.html`, {
    waitUntil: 'networkidle0',
  });

  // Wait for the loader to register window.argus
  await page.waitForFunction(
    () => typeof (window as unknown as { argus?: unknown }).argus === 'object',
    { timeout: 5_000 },
  );

  const merchantSessionId = opts.sessionId ?? `bot-${Date.now()}`;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const cpi = process.env.ARGUS_TEST_CPI;
  const result = await page.evaluate(
    async ({ sid, to, c }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const argus = (window as any).argus;
      return (await argus.run({ sessionId: sid, timeoutMs: to, cpi: c })) as {
        sessionId: string;
        argusSessionId: string;
        durationMs: number;
      };
    },
    { sid: merchantSessionId, to: timeoutMs, c: cpi },
  );

  return result;
}

/** Build the DOM-mediated autorun URL (see test-loader-autorun.html). */
export function autorunUrl(opts: { sessionId?: string; timeoutMs?: number } = {}): string {
  const sid = opts.sessionId ?? `bot-${Date.now()}`;
  const cpi = process.env.ARGUS_TEST_CPI ?? '';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return (
    `${BASE_URL}/test-loader-autorun.html` +
    `?cpi=${encodeURIComponent(cpi)}&sid=${encodeURIComponent(sid)}&timeoutMs=${timeoutMs}`
  );
}

/**
 * Drive a Playwright (or Patchright — same API) page through the loader
 * via the DOM-mediated autorun page. We deliberately do NOT call
 * window.argus from page.evaluate: Patchright runs evaluate in an
 * ISOLATED world (its anti-Runtime.enable stealth), where the main-world
 * `window.argus` global is invisible. The autorun page runs argus in the
 * main world itself and writes the result into #argus-out; we read it via
 * the DOM, which is shared across JS worlds.
 */
export async function runIntegrityPlaywright(
  page: PlaywrightPage,
  opts: { sessionId?: string; timeoutMs?: number } = {},
): Promise<LoaderRunResult> {
  await page.goto(autorunUrl(opts), { waitUntil: 'load' });
  await page.waitForSelector('#argus-out[data-done="1"]', { timeout: 45_000 });
  const text = (await page.textContent('#argus-out')) ?? '{}';
  const r = JSON.parse(text) as {
    ok?: boolean;
    argusSessionId?: string;
    sessionId?: string;
    error?: string;
  };
  if (!r.ok || !r.argusSessionId) {
    throw new Error(`autorun failed: ${r.error ?? 'no session id'}`);
  }
  return {
    sessionId: r.sessionId ?? opts.sessionId ?? '',
    argusSessionId: r.argusSessionId,
    durationMs: 0,
  };
}

/**
 * Discover the proxy exit IP by hitting api.ipify.org through an
 * already-configured proxy browser. Used by tests that need to inject
 * the proxy IP into WebRTC candidates to avoid the real-IP leak.
 *
 * Opens a dedicated page (closed after discovery) to avoid polluting
 * the main test page with network activity.
 */
export async function discoverExitIp(browser: PlaywrightBrowser): Promise<string> {
  const ipPage = await browser.newPage();
  try {
    await ipPage.goto('https://api.ipify.org?format=json', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    const body = await ipPage.textContent('body');
    const parsed = JSON.parse(body ?? '{}') as { ip?: string };
    if (!parsed.ip) throw new Error('discoverExitIp: no ip in response');
    return parsed.ip;
  } finally {
    await ipPage.close();
  }
}

/**
 * Install a WebRTC ICE candidate spoofer on a Playwright page via
 * addInitScript. Runs before any page JS, applies to every frame
 * including the loader's srcdoc iframe.
 *
 * Behavior:
 *   1. Drop IPv6 candidates entirely — closes the IPv6-ASN-leak that
 *      exposes the real home prefix even when IPv4 is patched.
 *   2. Replace IPv4 addresses in remaining candidates with `fakeIp`.
 *
 * Note: this does NOT defeat Function.prototype.toString-based
 * detection of patched RTCPeerConnection methods. The wrapper is still
 * present at the prototype level and shows up as a non-native function
 * to the lies scanner. Use only to test "does my network-layer
 * detection survive when WebRTC is spoofed" — this should produce
 * detection via other signals (ASN, RTT shape, worker-scope) even when
 * WebRTC appears consistent.
 */
export async function installWebrtcIpSpoof(
  page: PlaywrightPage,
  fakeIp: string,
): Promise<void> {
  await page.addInitScript((ip: string) => {
    const OrigRTC = window.RTCPeerConnection;

    const isIpv6 = (candidateStr: string): boolean => {
      const parts = candidateStr.split(/\s+/);
      const addr = parts[4] || '';
      return addr.includes(':');
    };

    const wrapHandler = (
      handler: ((ev: RTCPeerConnectionIceEvent) => void) | EventListener,
      self: RTCPeerConnection,
    ) => {
      return (evt: RTCPeerConnectionIceEvent) => {
        if (!evt.candidate?.candidate) {
          return (
            handler as (e: RTCPeerConnectionIceEvent) => void
          ).call(self, evt);
        }
        if (isIpv6(evt.candidate.candidate)) return;
        const spoofed = evt.candidate.candidate.replace(
          /(\d+\.\d+\.\d+\.\d+)/g,
          ip,
        );
        const newCandidate = new RTCIceCandidate({
          candidate: spoofed,
          sdpMid: evt.candidate.sdpMid,
          sdpMLineIndex: evt.candidate.sdpMLineIndex,
        });
        const fakeEvt = new Event(
          'icecandidate',
        ) as RTCPeerConnectionIceEvent & { candidate: RTCIceCandidate };
        (fakeEvt as unknown as { candidate: RTCIceCandidate }).candidate =
          newCandidate;
        (handler as (e: RTCPeerConnectionIceEvent) => void).call(self, fakeEvt);
      };
    };

    const Patched = class extends OrigRTC {
      constructor(config?: RTCConfiguration) {
        super(config);
      }

      set onicecandidate(
        handler: ((ev: RTCPeerConnectionIceEvent) => void) | null,
      ) {
        if (!handler) {
          super.onicecandidate = null;
          return;
        }
        super.onicecandidate = wrapHandler(handler, this);
      }

      get onicecandidate() {
        return super.onicecandidate;
      }

      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (type !== 'icecandidate' || typeof listener !== 'function') {
          return super.addEventListener(type, listener, options);
        }
        return super.addEventListener(
          type,
          wrapHandler(listener, this),
          options,
        );
      }
    };

    Object.defineProperty(Patched, 'name', { value: 'RTCPeerConnection' });
    (window as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      Patched;
    (
      window as unknown as { webkitRTCPeerConnection: unknown }
    ).webkitRTCPeerConnection = Patched;
  }, fakeIp);
}

/**
 * Fetch the stored integrity record from DynamoDB by argusSessionId.
 *
 * Convenience wrapper that asserts the record exists — tests that call
 * this want the record, not a null branch.
 *
 * Fields live under:
 *   record.device.*           — full fingerprint (navigator, screen,
 *                                headless, lies, workerScope, webrtc,
 *                                timezone, cssMedia, engine, etc.)
 *   record.analysis.*         — server analyzer outputs (worker,
 *                                timezone, ip, ja4_ua, network)
 *   record.session_id         — the argusSessionId (top-level dedupe key)
 *   record.vm_signals         — [] since we stripped them
 *   record.tampered           — false since we stripped vm:*
 */
export async function fetchAdversarialRecord(
  argusSessionId: string,
): Promise<Record<string, unknown>> {
  const record = await fetchIntegrityRecord(argusSessionId);
  expect(
    record,
    `no integrity record stored for ${argusSessionId}`,
  ).toBeTruthy();
  return record as Record<string, unknown>;
}
