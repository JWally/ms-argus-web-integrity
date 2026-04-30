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
const SCRIPT_SRC = (document.currentScript as HTMLScriptElement | null)?.src ?? '';
const SCRIPT_PARAMS: URLSearchParams = (() => {
  try {
    return new URL(SCRIPT_SRC).searchParams;
  } catch {
    return new URLSearchParams('');
  }
})();

function postBack(msg: Record<string, unknown>): void {
  // srcdoc iframes share origin with parent. Loader validates replies by
  // matching the runId UUID, not by origin.
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
    throw new Error('argus-iframe: missing runId (script src missing query params?)');
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

    // Post ONLY the opaque argusSessionId + merchant's echoed session id.
    // The raw fingerprint never escapes this realm.
    postBack({
      argusDone: true,
      runId,
      result: {
        argusSessionId: vm.sessionId,
        sessionId,
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
