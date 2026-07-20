export const INTEGRITY_TRANSPORT_VERSION = '3' as const;

export interface IntegrityCollectRequestInput {
  endpoint: string;
  encrypted: Uint8Array;
  clientPublicKey: string;
  sessionToken: string;
  cpi: string | null;
}

export interface IntegrityCollectFetchInit extends RequestInit {
  method: 'POST';
  credentials: 'include';
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface IntegrityCollectRequest {
  url: string;
  init: IntegrityCollectFetchInit;
}

/**
 * Build the browser side of the API-owned integrity transport contract.
 *
 * Encryption and VM-native serialization happen before this boundary. Keeping
 * this function pure makes the wire envelope independently testable without
 * moving plaintext back into a page-realm serialization chokepoint.
 */
export function buildIntegrityCollectRequest(
  input: IntegrityCollectRequestInput,
): IntegrityCollectRequest {
  if (!input.endpoint || !input.clientPublicKey || !input.sessionToken) {
    throw new Error(
      'Integrity transport endpoint and binding headers are required',
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Argus-Origin': input.clientPublicKey,
    'X-Argus-Session': input.sessionToken,
    'X-Argus-V': INTEGRITY_TRANSPORT_VERSION,
  };
  if (input.cpi) headers['X-Argus-Cpi'] = input.cpi;

  return {
    url: input.endpoint,
    init: {
      method: 'POST',
      credentials: 'include',
      headers,
      // Uint8Array#buffer can include bytes outside a subarray view. Copy the
      // view so fetch receives exactly the authenticated ciphertext envelope.
      body: input.encrypted.slice().buffer,
    },
  };
}
