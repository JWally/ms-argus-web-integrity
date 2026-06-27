export interface ArgusReleaseManifestPayload {
  v: 1;
  keyId: string;
  releaseId: string;
  environment: string;
  allowedOrigins: string[];
  notBefore: string;
  expiresAt: string;
  loader: {
    url: string;
    integrity: string;
  };
}

export interface ArgusReleaseManifest {
  payload: ArgusReleaseManifestPayload;
  signature: string;
}

export interface VerifyManifestOptions {
  publicKeyJwk: JsonWebKey;
  expectedKeyId: string;
  expectedOrigin: string;
  now?: Date;
}

const encoder = new TextEncoder();

export function canonicalManifestPayload(
  payload: ArgusReleaseManifestPayload,
): string {
  return JSON.stringify(payload);
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  return allowedOrigins.includes(origin) || allowedOrigins.includes('*');
}

function sameHttpsOrigin(url: string, expectedOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.origin === expectedOrigin;
  } catch {
    return false;
  }
}

export async function verifyManifest(
  manifest: ArgusReleaseManifest,
  options: VerifyManifestOptions,
): Promise<ArgusReleaseManifestPayload> {
  const { payload, signature } = manifest;
  const now = options.now ?? new Date();

  if (payload.v !== 1) throw new Error('manifest_version_unsupported');
  if (payload.keyId !== options.expectedKeyId) {
    throw new Error('manifest_key_mismatch');
  }
  if (!isAllowedOrigin(options.expectedOrigin, payload.allowedOrigins)) {
    throw new Error('manifest_origin_not_allowed');
  }
  if (new Date(payload.notBefore).getTime() > now.getTime()) {
    throw new Error('manifest_not_yet_valid');
  }
  if (new Date(payload.expiresAt).getTime() <= now.getTime()) {
    throw new Error('manifest_expired');
  }
  if (!payload.loader.integrity.startsWith('sha384-')) {
    throw new Error('manifest_loader_integrity_invalid');
  }
  if (!sameHttpsOrigin(payload.loader.url, options.expectedOrigin)) {
    throw new Error('manifest_loader_origin_invalid');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    options.publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    asArrayBuffer(base64UrlToBytes(signature)),
    encoder.encode(canonicalManifestPayload(payload)),
  );
  if (!ok) throw new Error('manifest_signature_invalid');

  return payload;
}
