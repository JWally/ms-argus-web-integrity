/**
 * Signed-assertion envelopes for the device-attestation public API.
 *
 * An attestation is the SDK signing a structured envelope with the device's
 * persistent ECDSA-P256 keypair (from get-crypto-id.ts). The envelope
 * format is fixed so verifiers can decode without consulting the SDK
 * version that produced it.
 *
 *   envelope = base64url(JSON({
 *     v: 1,
 *     purpose: string,      // namespace tag (e.g. "argus-pair-v1")
 *     payload: unknown,     // caller-supplied
 *     iat: number,          // unix seconds (issued-at)
 *     exp: number,          // unix seconds (expires-at)
 *     keyId: string,        // short hash of publicKey, for cross-assertion matching
 *     scanSessionId?: string, // exact integrity scan produced by this run
 *   }))
 *   signature = base64(ECDSA-P256-SHA-256(envelope))
 *   publicKey = base64(SPKI)
 *
 * Verification (server side):
 *   1. base64-decode envelope, parse JSON, check v === 1
 *   2. check now < exp + clock_skew
 *   3. check purpose matches expected namespace
 *   4. import publicKey as SPKI ECDSA-P256
 *   5. verify signature over the raw envelope bytes
 *
 * The signature is over the encoded envelope (not the JSON), so the server
 * verifies the exact bytes the client signed — no canonicalization needed.
 */

import { getPristineRefs } from './pristine-iframe';

const ENVELOPE_VERSION = 1;
const DEFAULT_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;
/** Reject payloads bigger than this after JSON encoding. Keeps envelopes
 * a comfortable size for headers/URL params and bounds CPU on the signer. */
export const MAX_PAYLOAD_BYTES = 8 * 1024;

export interface AttestationRequest {
  /**
   * Namespace tag — included in the signed envelope. Verifiers should reject
   * signatures whose purpose doesn't match the expected one, so callers in
   * different contexts can't accidentally interpret each other's signatures.
   *
   * Convention: reserve `argus-*` for Argus-operated flows; merchants can
   * use their own prefix (e.g. `merchant-acme-checkout-v1`).
   */
  purpose: string;
  /**
   * Arbitrary JSON-serializable payload. Signed verbatim — verifiers parse
   * it back out after signature checks.
   */
  payload: unknown;
  /**
   * Window of time the envelope is considered fresh. Clamped to
   * [1, MAX_TTL_SECONDS]. Default 60 seconds.
   */
  ttlSeconds?: number;
}

export interface Attestation {
  /** base64url-encoded envelope JSON. */
  envelope: string;
  /** base64-encoded ECDSA-P256-SHA-256 signature over the envelope bytes. */
  signature: string;
  /** base64-encoded SPKI public key. */
  publicKey: string;
  /** Short device-key fingerprint (first 16 hex chars of sha256(SPKI)). */
  keyId: string;
}

function b64urlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function bytesFromB64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes as Uint8Array<ArrayBuffer>;
}

/**
 * Short fingerprint of a base64-encoded SPKI public key. Used as `keyId` in
 * envelopes so a verifier can quickly correlate multiple assertions from the
 * same device without doing full signature math first.
 */
export async function computeKeyId(publicKeySpkiB64: string): Promise<string> {
  const pristine = getPristineRefs();
  const subtle = pristine.subtle ?? crypto.subtle;
  const hash = await subtle.digest('SHA-256', bytesFromB64(publicKeySpkiB64));
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/**
 * Build the to-be-signed envelope. Pure — no crypto, no I/O. Returns the
 * encoded envelope string (what gets signed and shipped) and the raw bytes
 * (what the signer needs to hash).
 */
export function buildEnvelope(
  req: AttestationRequest,
  keyId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  scanSessionId?: string,
): { envelope: string; envelopeBytes: Uint8Array } {
  if (typeof req.purpose !== 'string' || req.purpose.length === 0) {
    throw new Error('attestation: purpose required');
  }
  if (req.purpose.length > 128) {
    throw new Error('attestation: purpose too long (max 128 chars)');
  }

  const ttl = Math.max(
    1,
    Math.min(MAX_TTL_SECONDS, req.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  );

  const body = {
    v: ENVELOPE_VERSION,
    purpose: req.purpose,
    payload: req.payload,
    iat: nowSeconds,
    exp: nowSeconds + ttl,
    keyId,
    ...(scanSessionId ? { scanSessionId } : {}),
  };

  const pristine = getPristineRefs();
  let json: string;
  try {
    // Pristine JSON.stringify so a page-realm hook can't see the
    // to-be-signed envelope plaintext or substitute alternate JSON.
    json = pristine.stringify(body);
  } catch (e) {
    throw new Error(
      `attestation: payload not JSON-serializable (${String(e)})`,
    );
  }

  const bytes = pristine.textEncode(json);
  if (bytes.length > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `attestation: envelope too large (${bytes.length} > ${MAX_PAYLOAD_BYTES} bytes)`,
    );
  }

  return { envelope: b64urlFromBytes(bytes), envelopeBytes: bytes };
}
