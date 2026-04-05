import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCryptoId,
  signWithCryptoId,
  resetCryptoIdMemo,
  clearStoredKeys,
  type CryptoKeys,
} from './get-crypto-id';

describe('get-crypto-id', () => {
  beforeEach(async () => {
    // Reset memoisation before each test
    resetCryptoIdMemo();
    // Clear any stored keys
    await clearStoredKeys().catch(() => {});
  });

  afterEach(() => {
    resetCryptoIdMemo();
  });

  describe('getCryptoId()', () => {
    it('returns a CryptoKeys object with required properties', async () => {
      const keys = await getCryptoId();

      expect(keys).toHaveProperty('id');
      expect(keys).toHaveProperty('publicKey');
      expect(keys).toHaveProperty('privateKey');
      expect(keys).toHaveProperty('date');
    });

    it('returns id set to "primary"', async () => {
      const keys = await getCryptoId();
      expect(keys.id).toBe('primary');
    });

    it('returns publicKey as a Base64 string', async () => {
      const keys = await getCryptoId();

      // Base64 characters
      expect(keys.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/);
      // SPKI-encoded P-256 public keys are typically 91 bytes = ~122 chars in base64
      expect(keys.publicKey.length).toBeGreaterThan(50);
    });

    it('returns privateKey as a CryptoKey object', async () => {
      const keys = await getCryptoId();

      expect(keys.privateKey).toBeInstanceOf(CryptoKey);
      expect(keys.privateKey.type).toBe('private');
      expect(keys.privateKey.algorithm).toMatchObject({
        name: 'ECDSA',
        namedCurve: 'P-256',
      });
    });

    it('returns privateKey that is non-extractable', async () => {
      const keys = await getCryptoId();

      expect(keys.privateKey.extractable).toBe(false);
    });

    it('returns privateKey with sign usage', async () => {
      const keys = await getCryptoId();

      expect(keys.privateKey.usages).toContain('sign');
    });

    it('returns date as ISO string', async () => {
      const keys = await getCryptoId();

      // ISO date format check
      expect(() => new Date(keys.date)).not.toThrow();
      expect(keys.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns memoised keys on subsequent calls', async () => {
      const keys1 = await getCryptoId();
      const keys2 = await getCryptoId();

      expect(keys1).toBe(keys2); // Same object reference
      expect(keys1.publicKey).toBe(keys2.publicKey);
    });

    it('handles concurrent calls without generating duplicate keys', async () => {
      // Call getCryptoId multiple times concurrently
      const [keys1, keys2, keys3] = await Promise.all([
        getCryptoId(),
        getCryptoId(),
        getCryptoId(),
      ]);

      // All should return the same keys
      expect(keys1.publicKey).toBe(keys2.publicKey);
      expect(keys2.publicKey).toBe(keys3.publicKey);
    });
  });

  describe('signWithCryptoId()', () => {
    it('signs string data and returns Base64 signature', async () => {
      const signature = await signWithCryptoId('test data');

      // Base64 characters
      expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
      // ECDSA P-256 signatures are typically 64-72 bytes
      expect(signature.length).toBeGreaterThan(50);
    });

    it('signs ArrayBuffer data and returns Base64 signature', async () => {
      const data = new TextEncoder().encode('test data');
      const signature = await signWithCryptoId(data.buffer);

      expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('produces different signatures for different data', async () => {
      const sig1 = await signWithCryptoId('data 1');
      const sig2 = await signWithCryptoId('data 2');

      expect(sig1).not.toBe(sig2);
    });

    it('uses the same key for multiple signatures', async () => {
      const keys = await getCryptoId();
      const sig1 = await signWithCryptoId('test');
      const keysAfter = await getCryptoId();

      expect(keys.publicKey).toBe(keysAfter.publicKey);
    });
  });

  describe('signature verification', () => {
    it('can verify signatures with the public key', async () => {
      const keys = await getCryptoId();
      const data = 'test message to sign';
      const signature = await signWithCryptoId(data);

      // Decode the Base64 signature
      const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

      // Import the public key for verification
      const pubKeyBytes = Uint8Array.from(atob(keys.publicKey), (c) =>
        c.charCodeAt(0),
      );
      const publicKey = await crypto.subtle.importKey(
        'spki',
        pubKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );

      // Verify the signature
      const dataBytes = new TextEncoder().encode(data);
      const isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        sigBytes,
        dataBytes,
      );

      expect(isValid).toBe(true);
    });

    it('rejects tampered signatures', async () => {
      const keys = await getCryptoId();
      const data = 'test message';
      const signature = await signWithCryptoId(data);

      // Tamper with the signature
      const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      sigBytes[0] ^= 0xff; // Flip bits in first byte

      // Import the public key
      const pubKeyBytes = Uint8Array.from(atob(keys.publicKey), (c) =>
        c.charCodeAt(0),
      );
      const publicKey = await crypto.subtle.importKey(
        'spki',
        pubKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );

      // Verify should fail
      const dataBytes = new TextEncoder().encode(data);
      const isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        sigBytes,
        dataBytes,
      );

      expect(isValid).toBe(false);
    });

    it('rejects signatures for wrong data', async () => {
      const keys = await getCryptoId();
      const signature = await signWithCryptoId('original message');

      // Decode signature
      const sigBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

      // Import public key
      const pubKeyBytes = Uint8Array.from(atob(keys.publicKey), (c) =>
        c.charCodeAt(0),
      );
      const publicKey = await crypto.subtle.importKey(
        'spki',
        pubKeyBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );

      // Verify with different data should fail
      const wrongData = new TextEncoder().encode('different message');
      const isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        sigBytes,
        wrongData,
      );

      expect(isValid).toBe(false);
    });
  });

  describe('resetCryptoIdMemo()', () => {
    it('clears memoised keys', async () => {
      const keys1 = await getCryptoId();
      resetCryptoIdMemo();

      // After reset, should potentially load from IndexedDB (same keys)
      // or generate new if IndexedDB failed
      const keys2 = await getCryptoId();

      // Objects should be different (not same reference)
      expect(keys1).not.toBe(keys2);
    });
  });

  describe('clearStoredKeys()', () => {
    it('clears keys from IndexedDB', async () => {
      // Generate and store keys
      const keys1 = await getCryptoId();
      const publicKey1 = keys1.publicKey;

      // Clear stored keys
      await clearStoredKeys();

      // Generate new keys
      const keys2 = await getCryptoId();
      const publicKey2 = keys2.publicKey;

      // Should be different keys (new generation)
      expect(publicKey1).not.toBe(publicKey2);
    });
  });

  describe('private key security', () => {
    it('private key cannot be exported', async () => {
      const keys = await getCryptoId();

      // Attempting to export should throw
      await expect(
        crypto.subtle.exportKey('pkcs8', keys.privateKey),
      ).rejects.toThrow();

      await expect(
        crypto.subtle.exportKey('jwk', keys.privateKey),
      ).rejects.toThrow();

      await expect(
        crypto.subtle.exportKey('raw', keys.privateKey),
      ).rejects.toThrow();
    });
  });

  describe('IndexedDB persistence', () => {
    it.skip('persists keys across memo resets (requires real browser IndexedDB)', async () => {
      // NOTE: This test is skipped because happy-dom's IndexedDB doesn't
      // properly persist CryptoKey objects. In a real browser, this works.
      // The bot test in argus-bots will verify this behavior end-to-end.

      // Generate keys (will be stored in IndexedDB)
      const keys1 = await getCryptoId();
      const publicKey1 = keys1.publicKey;

      // Reset memo (but not IndexedDB)
      resetCryptoIdMemo();

      // Should load same keys from IndexedDB
      const keys2 = await getCryptoId();
      const publicKey2 = keys2.publicKey;

      expect(publicKey1).toBe(publicKey2);
    });
  });

  describe('edge cases', () => {
    it('handles empty string signing', async () => {
      const signature = await signWithCryptoId('');
      expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('handles large data signing', async () => {
      const largeData = 'x'.repeat(100000);
      const signature = await signWithCryptoId(largeData);
      expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('handles unicode data signing', async () => {
      const unicodeData = 'Hello World!';
      const signature = await signWithCryptoId(unicodeData);
      expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });
});

describe('constants', () => {
  it('exports correct database name', async () => {
    const { DATABASE_NAME } = await import('./constants');
    expect(DATABASE_NAME).toBe('argus-db');
  });

  it('exports correct table name', async () => {
    const { TABLE_NAME_KEYS } = await import('./constants');
    expect(TABLE_NAME_KEYS).toBe('crypto-keys');
  });

  it('exports correct index value', async () => {
    const { INDEX_VALUE_KEY } = await import('./constants');
    expect(INDEX_VALUE_KEY).toBe('primary');
  });
});
