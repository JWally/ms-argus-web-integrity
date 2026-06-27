import { describe, expect, it } from 'vitest';

import {
  type ArgusReleaseManifestPayload,
  canonicalManifestPayload,
  verifyManifest,
} from './manifest';

const publicKeyJwk: JsonWebKey = {
  key_ops: ['verify'],
  ext: true,
  kty: 'EC',
  x: 'IYkp3ntcKTMMB5-J1yVZkGyIRo8CydDDRzY8vT5XX5M',
  y: '8dXgkrrMt5vU901_GSEGJkAO3Gdy5EBMkHI9XzeYuqg',
  crv: 'P-256',
};

const privateKeyJwk: JsonWebKey = {
  key_ops: ['sign'],
  ext: true,
  kty: 'EC',
  x: 'IYkp3ntcKTMMB5-J1yVZkGyIRo8CydDDRzY8vT5XX5M',
  y: '8dXgkrrMt5vU901_GSEGJkAO3Gdy5EBMkHI9XzeYuqg',
  crv: 'P-256',
  d: 'siqLb8KAkzIipRcQaB0CeRxrplomLWKVutIlMMsq_ds',
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function signPayload(payload: ArgusReleaseManifestPayload) {
  const key = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(canonicalManifestPayload(payload)),
  );
  return {
    payload,
    signature: bytesToBase64Url(new Uint8Array(signature)),
  };
}

function payload(overrides: Partial<ArgusReleaseManifestPayload> = {}) {
  return {
    v: 1,
    keyId: 'argus-dev-jw-manifest-v1',
    releaseId: 'release-test',
    environment: 'dev-jw',
    allowedOrigins: ['https://static-integrity-dev-jw.argus.pw'],
    notBefore: '2026-06-27T00:00:00.000Z',
    expiresAt: '2026-06-28T00:00:00.000Z',
    loader: {
      url: 'https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js',
      integrity: 'sha384-loaderhash',
    },
    ...overrides,
  } satisfies ArgusReleaseManifestPayload;
}

describe('Argus release manifest verification', () => {
  it('accepts a signed, scoped, unexpired manifest', async () => {
    const manifest = await signPayload(payload());

    await expect(
      verifyManifest(manifest, {
        publicKeyJwk,
        expectedKeyId: 'argus-dev-jw-manifest-v1',
        expectedOrigin: 'https://static-integrity-dev-jw.argus.pw',
        now: new Date('2026-06-27T12:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ releaseId: 'release-test' });
  });

  it('rejects tampered payloads even when the envelope shape is valid', async () => {
    const manifest = await signPayload(payload());
    manifest.payload.loader.integrity = 'sha384-attacker';

    await expect(
      verifyManifest(manifest, {
        publicKeyJwk,
        expectedKeyId: 'argus-dev-jw-manifest-v1',
        expectedOrigin: 'https://static-integrity-dev-jw.argus.pw',
        now: new Date('2026-06-27T12:00:00.000Z'),
      }),
    ).rejects.toThrow('manifest_signature_invalid');
  });

  it('rejects manifests scoped to a different merchant origin', async () => {
    const manifest = await signPayload(
      payload({ allowedOrigins: ['https://evil.example'] }),
    );

    await expect(
      verifyManifest(manifest, {
        publicKeyJwk,
        expectedKeyId: 'argus-dev-jw-manifest-v1',
        expectedOrigin: 'https://static-integrity-dev-jw.argus.pw',
        now: new Date('2026-06-27T12:00:00.000Z'),
      }),
    ).rejects.toThrow('manifest_origin_not_allowed');
  });

  it('rejects stale signed manifests', async () => {
    const manifest = await signPayload(payload());

    await expect(
      verifyManifest(manifest, {
        publicKeyJwk,
        expectedKeyId: 'argus-dev-jw-manifest-v1',
        expectedOrigin: 'https://static-integrity-dev-jw.argus.pw',
        now: new Date('2026-06-29T12:00:00.000Z'),
      }),
    ).rejects.toThrow('manifest_expired');
  });
});
