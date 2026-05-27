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
  /** Caller-supplied attestation request, if any. Signed in the worker
   *  with the persistent ECDSA device key (also held in IDB, which Worker
   *  scope has access to). */
  attestReq: AttestationRequest | null;
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

export type WorkerOutbound = ReadyMessage | ResultMessage | ErrorMessage;
export type WorkerInbound = RunRequest;

/** Magic-string discriminator the worker checks before treating an inbound
 *  message as a 'run' request. Defends against drive-by `worker.postMessage`
 *  from page-realm code: an attacker who finds the Worker handle via
 *  enumeration would still need to construct a well-formed RunRequest with
 *  this exact discriminator, AND have a valid fingerprint. Trivial to bypass
 *  but raises the floor on accidental noise. */
export const RUN_DISCRIMINATOR = 'argus-run-v1' as const;
