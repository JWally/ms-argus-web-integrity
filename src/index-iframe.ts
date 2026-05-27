/**
 * Iframe-side entry for the integrity bundle.
 *
 * Auto-runs when loaded by argus-loader.js inside a srcdoc iframe. Reads
 * the runId and merchant session id from its own script URL, runs the
 * full collect + VM + ECDH-submit flow against the stage-baked API, and
 * postMessages a minimal result (argusSessionId only) back to the parent.
 *
 * NOTE: srcdoc iframes have `window.location = "about:srcdoc"`, so query
 * params ride on the script tag's src (the loader sets them there) and
 * are read via `document.currentScript.src`. Reading from
 * `window.location.search` would give empty strings.
 *
 * API endpoints are baked in at build time via rollup replace. They are
 * NOT configurable via query params or data-attrs — the merchant picks a
 * stage by embedding the corresponding loader URL; they can't redirect or
 * inspect the target.
 *
 * The fingerprint never leaves this iframe realm except as ECDH-encrypted
 * bytes over the wire. The result posted back to the parent is only the
 * opaque argusSessionId plus the merchant's own echoed-back session id.
 */

import { collectIntegrity, type IntegrityResult } from './integrity';
import { runArgusVm } from './vm/argus-vm';
import type { SigintConfig } from './utils/sigint';
import {
  buildEnvelope,
  computeKeyId,
  type Attestation,
  type AttestationRequest,
} from './utils/attestation';
import { getCryptoId, signWithCryptoId } from './utils/get-crypto-id';
import { getPristineRefs } from './utils/pristine-iframe';
import type { RunRequest, WorkerOutbound } from './worker-runtime/protocol';

// Baked in at build time via rollup replace. See rollup.config.mjs.
declare const __ARGUS_API_BASE__: string;
declare const __ARGUS_SIGINT_BASE_DOMAIN__: string;
declare const __ARGUS_SIGINT_STAGE_PREFIX__: string;
declare const __ARGUS_WORKER_URL__: string;

const API_BASE = __ARGUS_API_BASE__;
const WORKER_URL = __ARGUS_WORKER_URL__;
const SIGINT_CONFIG: SigintConfig = {
  baseDomain: __ARGUS_SIGINT_BASE_DOMAIN__,
  stagePrefix: __ARGUS_SIGINT_STAGE_PREFIX__,
};

/** Phase-1 grace window: how long to wait for the worker to either
 *  finish or return its phase-1 stub error before falling back to the
 *  legacy in-iframe VM path. Real Phase-2 worker submissions take
 *  ~2-5 seconds; the stub returns in <50 ms. 12 s tolerates a slow
 *  worker bundle fetch on cold-cache mobile networks. */
const WORKER_TIMEOUT_MS = 12_000;

/**
 * Spawn the dedicated VM worker and run the integrity flow inside it.
 * Returns a result-shaped object on success, or a rejected promise on
 * any failure (caller decides whether to fall back to the legacy path).
 *
 * The worker bundle is fetched from a same-origin URL and wrapped in a
 * Blob so the spawned Worker shares the iframe's origin — keeps the
 * `_fpid` cookie scope for POST_PAYLOAD's `credentials: 'include'` fetch.
 */
async function runViaWorker(
  fingerprint: IntegrityResult,
  cpi: string | null,
  attestReq: AttestationRequest | null,
): Promise<{
  sessionId: string;
  submissionError?: string;
  attestation: Attestation | null;
  attestError: string | null;
}> {
  // Fetch the worker source. Served by the same CDN as this bundle,
  // so the same CORS allowlist that the SDK already relies on applies.
  const src = await fetch(WORKER_URL, { credentials: 'omit' }).then((r) => {
    if (!r.ok) throw new Error(`worker_fetch_${r.status}`);
    return r.text();
  });
  const blob = new Blob([src], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  // Track the Worker handle so we can terminate on timeout/error and
  // revoke the blob URL after the spawn (the worker has already loaded
  // its source by the time the URL is revoked).
  let worker: Worker | null = null;

  try {
    worker = new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('worker_timeout'));
      }, WORKER_TIMEOUT_MS);

      worker!.addEventListener('message', (ev: MessageEvent) => {
        const msg = ev.data as WorkerOutbound;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ready') {
          // JSON-coerce before postMessage. The fingerprint embeds
          // host objects (NavigatorUAData, Promise-wrapped slices,
          // etc.) that aren't structured-clone-safe; the structured-
          // clone algorithm throws DataCloneError on them. JSON.stringify
          // → parse round-trip strips them to plain values, which is
          // exactly what the bytecode walker (and the server's
          // canonical stringify in helpers/device-mac.ts) already
          // operates on — so this doesn't change what the MAC absorbs.
          const sanitized = JSON.parse(JSON.stringify(fingerprint));
          const run: RunRequest = {
            type: 'run',
            fingerprint: sanitized,
            apiBase: API_BASE,
            sigintConfig: SIGINT_CONFIG,
            cpi,
            attestReq,
          };
          worker!.postMessage(run);
          return;
        }
        if (msg.type === 'result') {
          clearTimeout(timeout);
          resolve({
            sessionId: msg.sessionId,
            ...(msg.submissionError
              ? { submissionError: msg.submissionError }
              : {}),
            attestation: msg.attestation,
            attestError: msg.attestError,
          });
          return;
        }
        if (msg.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(msg.detail));
          return;
        }
      });

      worker!.addEventListener('error', (ev: ErrorEvent) => {
        clearTimeout(timeout);
        reject(new Error(`worker_error: ${ev.message || 'unknown'}`));
      });
    });
  } finally {
    try {
      worker?.terminate();
    } catch {
      /* terminate is best-effort */
    }
  }
}

// Captured synchronously at IIFE load — document.currentScript is only
// valid during the script's parse/execute phase, not inside async callbacks.
const SCRIPT_SRC =
  (document.currentScript as HTMLScriptElement | null)?.src ?? '';
const SCRIPT_PARAMS: URLSearchParams = (() => {
  try {
    return new URL(SCRIPT_SRC).searchParams;
  } catch {
    return new URLSearchParams('');
  }
})();

/**
 * Decode the attestation request from script-tag query params, if any. The
 * loader passes:
 *
 *   attestPurpose   = caller-supplied purpose string
 *   attestPayload   = base64url(JSON(caller-supplied payload))
 *   attestTtl       = optional ttl in seconds (default applied downstream)
 *
 * If `attestPurpose` is absent, no attestation is requested. Returns null in
 * that case so the iframe behaves exactly as before for un-tagged runs.
 */
function readAttestRequest(): AttestationRequest | null {
  const purpose = SCRIPT_PARAMS.get('attestPurpose');
  if (!purpose) return null;
  const payloadB64 = SCRIPT_PARAMS.get('attestPayload') ?? '';
  const ttlRaw = SCRIPT_PARAMS.get('attestTtl');
  let payload: unknown = null;
  if (payloadB64) {
    try {
      const padded =
        payloadB64.replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (payloadB64.length % 4)) % 4);
      // Pristine JSON.parse so a page-realm hook can't see the
      // attest payload or substitute alternate values before it
      // gets fed into the to-be-signed envelope.
      payload = getPristineRefs().parse(atob(padded));
    } catch {
      throw new Error('argus-iframe: attestPayload not valid base64url-JSON');
    }
  }
  const ttlSeconds = ttlRaw ? parseInt(ttlRaw, 10) : undefined;
  return { purpose, payload, ttlSeconds };
}

async function buildAttestation(req: AttestationRequest): Promise<Attestation> {
  const keys = await getCryptoId();
  const keyId = await computeKeyId(keys.publicKey);
  const { envelope } = buildEnvelope(req, keyId);
  const signature = await signWithCryptoId(envelope);
  return { envelope, signature, publicKey: keys.publicKey, keyId };
}

function postBack(msg: Record<string, unknown>): void {
  // Replies travel over a MessagePort the loader pre-armed in the srcdoc
  // HTML and transferred in at iframe-load time. Routing through the
  // private port (instead of `window.parent.postMessage`) means a forger
  // in the parent realm cannot inject a reply without holding port1,
  // which lives only in the loader's closure.
  //
  // The srcdoc-installed `__argusPostBack` buffers calls until the port
  // arrives, so it is safe to call from any point in main().
  type ArgusWindow = Window & {
    __argusPostBack?: (m: Record<string, unknown>) => void;
  };
  const send = (window as ArgusWindow).__argusPostBack;
  if (typeof send === 'function') {
    try {
      send(msg);
      return;
    } catch {
      /* fall through to legacy path */
    }
  }
  // Legacy fallback: only reachable if running under an older loader
  // that did not install __argusPostBack. Kept so a partial-rollout
  // (new iframe bundle / old loader) still surfaces a result instead of
  // hanging until timeout.
  try {
    window.parent.postMessage(msg, '*');
  } catch {
    /* parent unreachable — nothing we can do */
  }
}

async function main(): Promise<void> {
  // Refuse top-level execution. This bundle is only meaningful inside the
  // loader's srcdoc iframe. Loading it as a regular <script> on the
  // merchant page would run collection in the polluted parent realm — the
  // exact situation the loader exists to avoid.
  if (window.parent === window) {
    throw new Error('argus-iframe: must run inside a child iframe');
  }

  const runId = SCRIPT_PARAMS.get('runId') ?? '';
  const sessionId = SCRIPT_PARAMS.get('sessionId');
  // Public client-id forwarded by the loader. Sent as `x-argus-cpi` on the
  // ECDH POST so the server can partition the integrity record under
  // (cpi, session_id). Optional during the migration to dual-key auth.
  const cpi = SCRIPT_PARAMS.get('cpi');
  if (!runId) {
    throw new Error(
      'argus-iframe: missing runId (script src missing query params?)',
    );
  }

  // API base is required — baked at build time. If the replace plugin
  // failed or produced an empty string, refuse to run rather than silently
  // collecting into the void. This catches misconfigured builds loudly.
  if (!API_BASE) {
    throw new Error('argus-iframe: API_BASE not baked in at build time');
  }

  try {
    const fingerprint = await collectIntegrity();

    // Parse the optional attestation request once — both the worker and
    // the legacy in-iframe fallback need it.
    let attestReq: AttestationRequest | null = null;
    let parseAttestError: string | null = null;
    try {
      attestReq = readAttestRequest();
    } catch (e) {
      parseAttestError = (e as Error).message;
    }

    let sessionIdResult = '';
    let submissionError: string | null = null;
    let attestation: Attestation | null = null;
    let attestError: string | null = parseAttestError;

    // PHASE 1: try the worker path first. The worker currently returns
    // a `worker_phase1_stub` error (it's a stub until Phase 2 swaps in
    // the real VM host). On ANY worker failure — stub error, fetch
    // failure, timeout, error event — fall back to the legacy in-iframe
    // runArgusVm so the SDK keeps working through the migration. Once
    // Phase 2 lands and we've validated worker submissions, this
    // fallback gets removed.
    let useFallback = false;
    try {
      const w = await runViaWorker(fingerprint, cpi, attestReq);
      sessionIdResult = w.sessionId;
      submissionError = w.submissionError ?? null;
      attestation = w.attestation;
      // Worker's attestError takes precedence over our parse-time one
      // (the worker actually attempted the build).
      attestError = w.attestError;
    } catch (e) {
      useFallback = true;
      // Log silently — drop-console terser strips these in prod. The
      // metric for fallback frequency would have to come from server
      // side (e.g., counting submissions with absent worker_attest).
      console.warn('[iframe] worker path failed, falling back:', e);
    }

    if (useFallback) {
      const vm = await runArgusVm(fingerprint, API_BASE, SIGINT_CONFIG, cpi);
      sessionIdResult = vm.sessionId;
      submissionError = vm.submissionError ?? null;
      // Build attestation here — Phase 2 will move this into the worker.
      if (attestReq && !parseAttestError) {
        try {
          attestation = await buildAttestation(attestReq);
        } catch (e) {
          attestError = (e as Error).message;
        }
      }
    }

    if (!sessionIdResult) {
      postBack({
        argusDone: false,
        runId,
        error: submissionError ?? 'submission_failed',
      });
      return;
    }

    // Post ONLY the opaque argusSessionId + merchant's echoed session id,
    // plus the attestation (if requested). The raw fingerprint never
    // escapes this realm.
    postBack({
      argusDone: true,
      runId,
      result: {
        argusSessionId: sessionIdResult,
        sessionId,
        attestation,
        attestError,
      },
    });
  } catch (err) {
    postBack({
      argusDone: false,
      runId,
      error: (err as Error)?.message ?? 'unknown',
    });
  }
}

main().catch((err) => {
  // Failed before we could enter the inner try/catch. Best-effort reply —
  // loader will time out if runId is missing/wrong.
  const runId = SCRIPT_PARAMS.get('runId') ?? '';
  postBack({
    argusDone: false,
    runId,
    error: (err as Error)?.message ?? 'unknown',
  });
});
