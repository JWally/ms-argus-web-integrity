import { describe, expect, it } from 'vitest';
import { encryptProxyPayload, scramblePayload } from './transport';

function bytesToBase64(value: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe('proxy_v1 transport', () => {
  it('uses the reversible v3 Fibonacci scramble', () => {
    const json = JSON.stringify({ product: 'proxy_v1', value: 'héllo' });
    const token = '0123456789abcdef';
    const scrambled = scramblePayload(json, token);
    expect(scrambled).not.toBe(json);
    expect(scramblePayload(scrambled, token)).toBe(json);
  });

  it('encrypts the reduced payload for the server ECDH key', async () => {
    const server = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair;
    const serverPublicKey = bytesToBase64(
      await crypto.subtle.exportKey('raw', server.publicKey),
    );
    const payloadJson = JSON.stringify({
      product: 'proxy_v1',
      network: { proxy: true },
    });

    const result = await encryptProxyPayload({
      payloadJson,
      sessionToken: '0123456789abcdef',
      serverPublicKey,
    });

    expect(result.encrypted.byteLength).toBeGreaterThan(payloadJson.length);
    expect(atob(result.clientPublicKey)).toHaveLength(65);
  });
});
