/**
 * Typed message protocol between the srcdoc iframe (main thread) and the
 * dedicated Worker that hosts the bytecode VM + bridge + crypto + POST.
 *
 * Direction:
 *   iframe → worker: 'run'   (one-shot kickoff with everything the VM needs)
 *   worker → iframe: 'ready' (once, after worker globals + bytecode are loaded)
 *   worker → iframe: 'result' or 'error' (terminal)
 *
 * Why no streaming slice-request protocol (for now): the simplest move keeps
 * `collectIntegrity()` running in the iframe and ships the full
 * `IntegrityResult` to the worker in one postMessage. The HMAC chain already
 * defends every device.* slice; the worker_attest slice (see Phase 3)
 * defends against substitution at the postMessage boundary by anchoring
 * navigator-related fields to the worker's own observations.
 *
 * Both sides import this module so the message shape stays in sync. The
 * file lives under src/worker-runtime/ — a sibling tree to src/vm/ — so its
 * intent (mutually-bundled-into-both-realms protocol) is structurally clear.
 */

import type { IntegrityResult } from '../integrity';
import type { SigintConfig } from '../utils/sigint';
import type { Attestation, AttestationRequest } from './../utils/attestation';

/**
 * Optional page-context bundle. Captured iframe-side (browser-bounded
 * fields the worker can't see) and forwarded to the worker so it lands
 * on `device.page` inside the encrypted fingerprint payload.
 *
 * Field sources:
 *   - `pageUrl` / `pageTitle`: merchant-supplied via window.argus.run()
 *     OR auto-captured from `window.top.location.href` when same-origin.
 *     The `pageSource` discriminator lets the server know which.
 *   - `referrer`: iframe-scope `document.referrer` — usually reveals the
 *     embedder when Referrer-Policy allows.
 *   - `isTop`: whether the SDK loader's frame is the top frame.
 *   - `ancestorOrigins`: cross-origin-safe ancestor chain. Chrome/Safari
 *     only (Firefox returns empty).
 *
 * All fields optional individually — the type itself is optional on
 * RunRequest. Old SDK bundles without page collection still pass.
 */
export interface PageContext {
  pageUrl?: string;
  pageTitle?: string;
  pageSource?: 'merchant' | 'auto' | 'unknown';
  referrer?: string;
  isTop?: boolean;
  ancestorOrigins?: string[];
}

/** Iframe → worker, sent exactly once after the worker posts 'ready'. */
export interface RunRequest {
  type: 'run';
  /** Pre-collected fingerprint (everything except worker_attest, which the
   *  worker fills in itself). Shipped as a structured-clone payload. */
  fingerprint: IntegrityResult;
  /** Baked-at-build-time API base, forwarded from the iframe's rollup-baked
   *  constant. Worker can't read replace()-baked constants from the iframe;
   *  pass them explicitly. */
  apiBase: string;
  /** Sigint probe endpoints. */
  sigintConfig: SigintConfig;
  /** Merchant CPI from script URL query params (loader → iframe → worker). */
  cpi: string | null;
  /** Argus `session_id` minted ONCE per scan by the iframe and shared
   *  across the worker submission and the in-iframe fallback submission,
   *  so a worker→fallback double-submit carries the same session_id (the
   *  `(cpi, session_id)` partition key). Keeps the server's single-use
   *  STUN claim idempotent instead of 409ing the fallback as a replay. */
  sessionId: string;
  /** Caller-supplied attestation request, if any. Signed in the worker
   *  with the persistent ECDSA device key (also held in IDB, which Worker
   *  scope has access to). */
  attestReq: AttestationRequest | null;
  /** Server-managed client-carried state read from `localStorage('cache')`
   *  by the iframe before kicking the run. The worker can't touch
   *  `localStorage` itself (WorkerGlobalScope doesn't expose it), so the
   *  iframe forwards the current value here. Empty string when absent /
   *  first visit. The worker emits any updated value back via
   *  `SetCacheMessage` for the iframe to persist. */
  cache: string;
  /** Optional page-context bundle (merchant-supplied + auto-captured
   *  frame state). When absent, the worker lands `device.page` as
   *  missing — server-side analysis falls back to HTTP Origin + Referer
   *  headers (already captured per row). */
  pageContext?: PageContext;
}

/** Worker → iframe, posted once at worker init complete. Lets the iframe
 *  know the channel is ready to receive the 'run' message. */
export interface ReadyMessage {
  type: 'ready';
}

/** Worker → iframe, terminal success. */
export interface ResultMessage {
  type: 'result';
  sessionId: string;
  /** Set when the POST failed (worker writes through to here from the
   *  bridge's onSubmissionError hook). */
  submissionError?: string;
  /** Signed attestation, if the caller requested one. Null when not
   *  requested. The `attestError` channel mirrors the iframe-side
   *  buildAttestation try/catch so a partial failure is surfaced. */
  attestation: Attestation | null;
  attestError: string | null;
}

/** Worker → iframe, terminal failure (bytecode crash, fatal init error). */
export interface ErrorMessage {
  type: 'error';
  detail: string;
}

/**
 * Worker → iframe, non-terminal: server returned a new server-managed
 * client-carried blob on the POST response. Iframe writes the value to
 * `localStorage('cache')` so the next visit re-sends it. May fire before
 * the terminal `result` since the bridge's POST_PAYLOAD handler emits
 * this side-effect right after parsing the response.
 */
export interface SetCacheMessage {
  type: 'set_cache';
  value: string;
}

export type WorkerOutbound =
  | ReadyMessage
  | ResultMessage
  | ErrorMessage
  | SetCacheMessage;
export type WorkerInbound = RunRequest;

/** Magic-string discriminator the worker checks before treating an inbound
 *  message as a 'run' request. Defends against drive-by `worker.postMessage`
 *  from page-realm code: an attacker who finds the Worker handle via
 *  enumeration would still need to construct a well-formed RunRequest with
 *  this exact discriminator, AND have a valid fingerprint. Trivial to bypass
 *  but raises the floor on accidental noise. */
export const RUN_DISCRIMINATOR = 'argus-run-v1' as const;
