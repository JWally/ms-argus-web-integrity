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
import type { SigintConfig } from './utils/sigint';
import { type Attestation, type AttestationRequest } from './utils/attestation';
import { getPristineRefs } from './utils/pristine-iframe';
import type { RunRequest, WorkerOutbound } from './worker-runtime/protocol';
import { fetchWorkerSource } from './worker-runtime/worker-source';

// Baked in at build time via rollup replace. See rollup.config.mjs.
declare const __ARGUS_API_BASE__: string;
declare const __ARGUS_SIGINT_BASE_DOMAIN__: string;
declare const __ARGUS_SIGINT_STAGE_PREFIX__: string;
declare const __ARGUS_WORKER_INTEGRITY__: string;

const API_BASE = __ARGUS_API_BASE__;
const WORKER_INTEGRITY = __ARGUS_WORKER_INTEGRITY__;
const SIGINT_CONFIG: SigintConfig = {
  baseDomain: __ARGUS_SIGINT_BASE_DOMAIN__,
  stagePrefix: __ARGUS_SIGINT_STAGE_PREFIX__,
};

/** How long to wait for the dedicated worker path to finish. Real worker
 *  submissions take ~2-5 seconds. 12s tolerates a slow worker bundle fetch
 *  on cold-cache mobile networks. There is intentionally no iframe VM
 *  fallback: worker failure fails the scan closed. */
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
  page: import('./worker-runtime/protocol').PageContext | null,
  sessionId: string,
): Promise<{
  sessionId: string;
  submissionError?: string;
  attestation: Attestation | null;
  attestError: string | null;
}> {
  // Track the Worker handle so we can terminate on timeout/error.
  let worker: Worker | null = null;

  try {
    if (FIRST_PARTY_WORKER_URL) {
      // First-party CSP mode: load a STATIC same-origin worker (no blob) so the
      // host can enforce `worker-src 'self'`. `new Worker(url)` has no SRI
      // byte-check like the fetch path, but the worker is same-origin and
      // Argus-deployed — CSP + the deploy's own integrity chain cover it.
      worker = new Worker(FIRST_PARTY_WORKER_URL);
    } else {
      // Default: CORS-fetch the worker source (SRI-validated) from the CDN and
      // blob it so the spawned Worker shares this document's origin. The blob
      // URL is revoked after spawn (source is already loaded by then).
      const src = await fetchWorkerSource(WORKER_URL, WORKER_INTEGRITY);
      const blobUrl = URL.createObjectURL(
        new Blob([src], { type: 'application/javascript' }),
      );
      worker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);
    }

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
          // Read the server-managed client-carried blob from localStorage
          // here in the iframe — Worker scope can't (no localStorage).
          // Empty string on absent / first visit / storage error.
          let cacheIn = '';
          try {
            cacheIn = localStorage.getItem('cache') ?? '';
          } catch {
            /* private mode / quota / SecurityError — first-visit shape */
          }
          const run: RunRequest = {
            type: 'run',
            fingerprint: sanitized,
            apiBase: API_BASE,
            sigintConfig: SIGINT_CONFIG,
            cpi,
            attestReq,
            cache: cacheIn,
            sessionId,
            ...(page ? { pageContext: page } : {}),
          };
          worker!.postMessage(run);
          return;
        }
        if (msg.type === 'set_cache') {
          // Server returned an updated cache blob; persist it iframe-side
          // so the next visit re-sends. Length is bounded server-side
          // (helpers/device-history encryptDeviceHistory returns ~448
          // chars for the common case); a malformed long string is
          // guarded by the bridge's 16384 cap before this point.
          if (typeof msg.value === 'string' && msg.value.length > 0) {
            try {
              localStorage.setItem('cache', msg.value);
            } catch {
              /* quota / SecurityError — server reissues on next visit */
            }
          }
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
const WORKER_URL = SCRIPT_SRC
  ? new URL('argus-integrity-worker.iife.js', SCRIPT_SRC).toString()
  : '';
const SCRIPT_PARAMS: URLSearchParams = (() => {
  try {
    return new URL(SCRIPT_SRC).searchParams;
  } catch {
    return new URLSearchParams('');
  }
})();

/**
 * First-party worker override (CSP hardening). When the host passes `workerUrl`
 * AND it's same-origin to this iframe's document, we load the worker statically
 * from it (no blob) so a strict `worker-src 'self'` CSP is enforceable. A
 * Worker's top-level script MUST be same-origin, so a cross-origin value is
 * ignored and we fall back to the default CORS-fetch → blob path. See the
 * `workerUrl` option in loader/index.ts.
 */
const FIRST_PARTY_WORKER_URL: string | null = (() => {
  const raw = SCRIPT_PARAMS.get('workerUrl');
  if (!raw) return null;
  try {
    return new URL(raw, location.href).origin === location.origin ? raw : null;
  } catch {
    return null;
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
  // Page context forwarded by the loader (merchant-supplied + auto-captured
  // frame state). All fields optional — old loaders without these params
  // result in undefined values, the worker just lands device.page empty.
  const pageContext: import('./worker-runtime/protocol').PageContext | null =
    (() => {
      const pageUrl = SCRIPT_PARAMS.get('pageUrl') ?? '';
      const pageTitle = SCRIPT_PARAMS.get('pageTitle') ?? '';
      const pageSourceRaw = SCRIPT_PARAMS.get('pageSource') ?? '';
      const pageSource: 'merchant' | 'auto' | 'unknown' | undefined =
        pageSourceRaw === 'merchant' ||
        pageSourceRaw === 'auto' ||
        pageSourceRaw === 'unknown'
          ? pageSourceRaw
          : undefined;
      const referrer = SCRIPT_PARAMS.get('referrer') ?? '';
      const isTopRaw = SCRIPT_PARAMS.get('isTop');
      const isTop =
        isTopRaw === '1' ? true : isTopRaw === '0' ? false : undefined;
      const ancestorOriginsRaw = SCRIPT_PARAMS.get('ancestorOrigins') ?? '';
      const ancestorOrigins = ancestorOriginsRaw
        ? ancestorOriginsRaw.split('\n')
        : [];
      if (
        !pageUrl &&
        !pageTitle &&
        !referrer &&
        isTop === undefined &&
        ancestorOrigins.length === 0
      ) {
        return null;
      }
      return {
        ...(pageUrl ? { pageUrl } : {}),
        ...(pageTitle ? { pageTitle } : {}),
        ...(pageSource ? { pageSource } : {}),
        ...(referrer ? { referrer } : {}),
        ...(isTop !== undefined ? { isTop } : {}),
        ...(ancestorOrigins.length > 0 ? { ancestorOrigins } : {}),
      };
    })();
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

    // Mint the argus session_id ONCE per scan, here in the iframe, and pass
    // it into the worker submission. Generated via iframe-pristine randomUUID
    // so a page-realm hook can't force collisions or covertly mark sessions
    // (same property bridge 0x10 relied on). Must be per-scan, not a stable
    // per-device id.
    const runSessionId = getPristineRefs().randomUUID();

    // Parse the optional attestation request once and pass it into the
    // worker. If parsing fails, surface that error alongside the result.
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

    // The dedicated worker is the ONLY submission path. `addInitScript`
    // (CDP Page.addScriptToEvaluateOnNewDocument) cannot reach worker
    // scope, so a page-realm prototype hook can't MITM the crypto /
    // serialization chokepoint there. There is intentionally NO iframe-side
    // fallback: an attacker who blocks Worker creation/fetch/start must not
    // be able to downgrade the scan into the page-poisonable iframe realm
    // (Class C downgrade — see META-PROTECTIONS.md Gap 2b). Worker failure →
    // no submission; the merchant treats a missing Argus result as not-clean.
    try {
      const w = await runViaWorker(
        fingerprint,
        cpi,
        attestReq,
        pageContext,
        runSessionId,
      );
      sessionIdResult = w.sessionId;
      submissionError = w.submissionError ?? null;
      attestation = w.attestation;
      attestError = w.attestError;
    } catch (e) {
      // No fallback by design. Record the failure so the empty-sessionId
      // branch below posts argusDone:false. drop-console strips this in prod.
      submissionError = `worker_unavailable: ${(e as Error).message}`;
      console.warn('[iframe] worker path failed, no fallback:', e);
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
