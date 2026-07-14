/**
 * Worker entry — hosts the bytecode VM + bridge + crypto pipeline.
 *
 * Runs inside a dedicated Web Worker spawned by the srcdoc iframe via
 * `new Worker(URL.createObjectURL(blob))`. The blob wraps this IIFE
 * bundle so the worker is same-origin to the iframe (preserves the
 * `_fpid` cookie scope used by POST_PAYLOAD's fetch).
 *
 * Page-realm prototype patches (Playwright addInitScript on
 * `SubtleCrypto`, `TextEncoder`, etc.) cannot reach into this realm.
 * The pristine-iframe pattern from `src/utils/pristine-iframe.ts` was
 * a substitute for proper realm isolation; the Worker is the real
 * thing. The pristine module's own fallback path (when `document` is
 * absent) resolves to `self.*` refs, so `bridge.ts` and `argus-vm.ts`
 * compose into the worker realm without source-level changes.
 *
 * Lifecycle:
 *   1. Worker boots.
 *   2. Worker posts `{type:'ready'}` to the iframe.
 *   3. Iframe sends `{type:'run', fingerprint, apiBase, sigintConfig, cpi, attestReq}`.
 *   4. Worker self-attests its navigator + timing observations (Phase 3
 *      — defers per implementation; currently a stub).
 *   5. Worker runs prefetch + VM (bytecode → bridge → ECDH+AES-GCM → POST).
 *   6. Worker posts `{type:'result', sessionId, attestation, ...}` and
 *      the iframe terminates it.
 */

/// <reference lib="webworker" />
import { runArgusVm, prefetchArgusVm } from './vm/argus-vm';
import {
  buildEnvelope,
  computeKeyId,
  type Attestation,
  type AttestationRequest,
} from './utils/attestation';
import { getCryptoId, signWithCryptoId } from './utils/get-crypto-id';
import type { RunRequest, WorkerOutbound } from './worker-runtime/protocol';

declare const self: DedicatedWorkerGlobalScope;

function post(msg: WorkerOutbound): void {
  self.postMessage(msg);
}

async function buildAttestation(
  req: AttestationRequest,
  scanSessionId: string,
): Promise<Attestation> {
  const keys = await getCryptoId();
  const keyId = await computeKeyId(keys.publicKey);
  const { envelope } = buildEnvelope(req, keyId, undefined, scanSessionId);
  const signature = await signWithCryptoId(envelope);
  return { envelope, signature, publicKey: keys.publicKey, keyId };
}

/**
 * Worker self-attestation. Reads navigator + performance + crypto
 * source-text from `self.*` (the worker's own globals — outside
 * Playwright addInitScript reach). Injected into the fingerprint as
 * device.worker_attest BEFORE the bytecode walks the MAC chain, so
 * any iframe-side substitution of device.navigator is detectable
 * post-hoc on the server by comparing device.navigator.userAgent
 * against device.worker_attest.ua.
 *
 * Designed to be small + JSON-cloneable: just the navigator scalars
 * an attacker would most plausibly want to lie about, plus a worker-
 * private timestamp and the toString of crypto.getRandomValues for
 * tamper-evidence of the worker's own RNG.
 */
function collectWorkerAttest(): Record<string, unknown> {
  const nav = self.navigator as Navigator & {
    deviceMemory?: number;
    languages?: readonly string[];
  };
  let rngSource: string | null = null;
  try {
    rngSource = Function.prototype.toString.call(self.crypto.getRandomValues);
  } catch {
    /* leave null */
  }
  return {
    ua: nav.userAgent ?? '',
    hc: nav.hardwareConcurrency ?? null,
    dm: nav.deviceMemory ?? null,
    lang: nav.language ?? '',
    langs: Array.isArray(nav.languages) ? [...nav.languages] : [],
    platform: nav.platform ?? '',
    perf_origin: Math.round(self.performance.timeOrigin),
    rng_src: rngSource,
  };
}

async function handleRun(req: RunRequest): Promise<void> {
  try {
    // Inject worker self-attestation into the fingerprint BEFORE the
    // bytecode walks it. The slice handler for SLICE_WORKER_ATTEST
    // (bridge.ts) reads fp.worker_attest; macAbsorb absorbs it as
    // slice id 0x66. Server replays in the same order in
    // helpers/device-mac.ts SLICE_ORDER.
    (req.fingerprint as { worker_attest?: unknown }).worker_attest =
      collectWorkerAttest();

    // Inject the iframe-collected page context onto `fingerprint.meta.page`
    // so it rides through the bytecode's GET_META (0x11) read into the
    // encrypted payload's `meta.page`. The bytecode walks `device.*` via
    // fixed slice handlers — adding a brand-new device sub-object would
    // require a new SLICE_ id + bytecode recompile + macAbsorb update on
    // both client and server. Riding on meta is the lower-risk route and
    // lands at row.meta.page on the server with no schema changes.
    // Absent when no merchant supplied page and no auto-capture succeeded.
    if (req.pageContext) {
      const meta = (req.fingerprint as { meta?: Record<string, unknown> }).meta;
      if (meta && typeof meta === 'object') {
        (meta as Record<string, unknown>).page = req.pageContext;
      }
    }

    // Kick the h2-probe + bytecode prefetch as soon as we have the
    // sigintConfig. runArgusVm consumes the prefetched slot via the
    // module-level _prefetchSlot — same pattern the iframe-hosted
    // version used.
    prefetchArgusVm(req.sigintConfig);

    const vm = await runArgusVm(
      req.fingerprint,
      req.apiBase,
      req.sigintConfig,
      req.cpi,
      req.cache,
      (newCache) => {
        // Forward the server-issued cache blob to the iframe for
        // persistence — WorkerGlobalScope can't access localStorage.
        // Fire-and-forget; iframe writes synchronously on receipt.
        post({ type: 'set_cache', value: newCache });
      },
      req.sessionId,
    );

    if (!vm.sessionId) {
      post({
        type: 'error',
        detail: vm.submissionError ?? 'submission_failed',
      });
      return;
    }

    // Build the attestation in the worker — keeps the ECDSA sign op out
    // of iframe-realm reach (parallel to the encrypt move). The
    // persistent device-identity keypair lives in IndexedDB, which is
    // available in workers and is per-origin (same as in the iframe),
    // so the key the worker reads is the same key the iframe would
    // have read.
    let attestation: Attestation | null = null;
    let attestError: string | null = null;
    if (req.attestReq) {
      try {
        attestation = await buildAttestation(req.attestReq, vm.sessionId);
      } catch (e) {
        attestError = (e as Error).message ?? 'unknown';
      }
    }

    post({
      type: 'result',
      sessionId: vm.sessionId,
      ...(vm.submissionError ? { submissionError: vm.submissionError } : {}),
      attestation,
      attestError,
    });
  } catch (e) {
    post({ type: 'error', detail: (e as Error)?.message ?? 'unknown' });
  }
}

// Single-shot message handler. A second 'run' on the same instance
// is a no-op — the iframe terminates the worker after the first
// result so this only fires for defensive reasons.
let handled = false;
self.addEventListener('message', (ev: MessageEvent) => {
  const data = ev.data as RunRequest | undefined;
  if (!data || data.type !== 'run') return;
  if (handled) return;
  handled = true;
  void handleRun(data);
});

// Signal we're alive and the message listener is attached. Iframe
// waits for this before sending the 'run' request so a fast iframe
// can't race past the worker's listener attach.
post({ type: 'ready' });
