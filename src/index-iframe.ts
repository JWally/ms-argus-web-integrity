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

import { collectIntegrity } from './integrity';
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

// Baked in at build time via rollup replace. See rollup.config.mjs.
declare const __ARGUS_API_BASE__: string;
declare const __ARGUS_SIGINT_BASE_DOMAIN__: string;
declare const __ARGUS_SIGINT_STAGE_PREFIX__: string;

const API_BASE = __ARGUS_API_BASE__;
const SIGINT_CONFIG: SigintConfig = {
  baseDomain: __ARGUS_SIGINT_BASE_DOMAIN__,
  stagePrefix: __ARGUS_SIGINT_STAGE_PREFIX__,
};

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
    const vm = await runArgusVm(fingerprint, API_BASE, SIGINT_CONFIG, cpi);

    // An empty vm.sessionId means submission failed somewhere in the VM
    // path — ECDH POST returned non-2xx or threw, prefetch failed,
    // handshake missing, etc. The bridge swallows these errors and
    // returns '' for the session id; the VM passes that through. We
    // surface it here as an explicit failure rather than posting back
    // `argusDone: true` with an empty id (which would look like success
    // to the loader and blow up downstream on DDB lookup).
    if (!vm.sessionId) {
      // vm.submissionError is set by the bridge when the POST failed
      // (e.g. "http_402_Payment_Required" on KYC-gated proxies,
      // "fetch_threw: ..." on CORS/network errors). Falls through to a
      // generic string when the empty sessionId came from earlier in
      // the VM (prefetch failure, handshake missing, etc.).
      postBack({
        argusDone: false,
        runId,
        error: vm.submissionError ?? 'submission_failed',
      });
      return;
    }

    // Build the optional attestation. If the caller didn't request one
    // (attestPurpose absent), `attestation` stays null and the message
    // shape matches the legacy result exactly.
    let attestation: Attestation | null = null;
    let attestError: string | null = null;
    try {
      const attestReq = readAttestRequest();
      if (attestReq) {
        attestation = await buildAttestation(attestReq);
      }
    } catch (e) {
      attestError = (e as Error).message;
    }

    // Post ONLY the opaque argusSessionId + merchant's echoed session id,
    // plus the attestation (if requested). The raw fingerprint never
    // escapes this realm.
    postBack({
      argusDone: true,
      runId,
      result: {
        argusSessionId: vm.sessionId,
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
