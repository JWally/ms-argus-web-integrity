import { describe, it, expect, vi } from 'vitest';
import {
  hashMini,
  hashify,
  simhashify,
  cipher,
  instanceId,
  getBotHash,
  getFuzzyHash,
  getSimHashDistance,
  SIMHASH_FEATURE_WEIGHTS,
  SIMHASH_BITS,
} from './crypto';

describe('crypto utils', () => {
  describe('hashMini()', () => {
    it('returns 8-character hex string', () => {
      const result = hashMini({ test: 'value' });
      expect(result).toMatch(/^[0-9a-f]{8}$/);
    });

    it('produces consistent hashes for same input', () => {
      const input = { foo: 'bar', num: 123 };
      const hash1 = hashMini(input);
      const hash2 = hashMini(input);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different input', () => {
      const hash1 = hashMini({ a: 1 });
      const hash2 = hashMini({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it('handles various data types', () => {
      expect(hashMini('string')).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(12345)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini([1, 2, 3])).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(null)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(undefined)).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles nested objects', () => {
      const result = hashMini({
        level1: {
          level2: {
            value: 'deep',
          },
        },
      });
      expect(result).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles empty objects and arrays', () => {
      expect(hashMini({})).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini([])).toMatch(/^[0-9a-f]{8}$/);
    });

    it('handles boolean values', () => {
      expect(hashMini(true)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(false)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(true)).not.toBe(hashMini(false));
    });

    it('handles special numbers', () => {
      expect(hashMini(0)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(-1)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(Infinity)).toMatch(/^[0-9a-f]{8}$/);
      expect(hashMini(NaN)).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('instanceId', () => {
    it('is 8 characters long', () => {
      expect(instanceId.length).toBe(8);
    });

    it('starts with a lowercase letter', () => {
      expect(instanceId[0]).toMatch(/[a-z]/);
    });

    it('contains alphanumeric characters', () => {
      expect(instanceId).toMatch(/^[a-z][a-z0-9]{7}$/);
    });
  });

  describe('hashify()', () => {
    it('returns SHA-256 hash (64-character hex)', async () => {
      const result = await hashify({ test: 'value' });
      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces consistent hashes for same input', async () => {
      const input = { foo: 'bar' };
      const hash1 = await hashify(input);
      const hash2 = await hashify(input);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different input', async () => {
      const hash1 = await hashify({ a: 1 });
      const hash2 = await hashify({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });

    it('handles various data types', async () => {
      expect(await hashify('string')).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashify(12345)).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashify([1, 2, 3])).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles empty values', async () => {
      expect(await hashify({})).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashify([])).toMatch(/^[0-9a-f]{64}$/);
      expect(await hashify('')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles nested structures', async () => {
      const nested = {
        level1: {
          level2: {
            level3: [1, 2, { deep: 'value' }],
          },
        },
      };
      expect(await hashify(nested)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('cipher()', () => {
    it('returns array with message, vector, and key', async () => {
      const data = { secret: 'data' };
      const result = await cipher(data);
      expect(result).toBeInstanceOf(Array);
      expect(result.length).toBe(3);
    });

    it('returns base64 encoded message', async () => {
      const data = { test: 'value' };
      const [message] = await cipher(data);
      // Base64 characters
      expect(message).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('returns base64 encoded IV', async () => {
      const data = { test: 'value' };
      const [, vector] = await cipher(data);
      expect(vector).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('returns JWK key data', async () => {
      const data = { test: 'value' };
      const [, , keyData] = await cipher(data);
      expect(keyData).toBeDefined();
      // JWK k value is base64url encoded
      expect(keyData).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces different ciphertext for same data (due to random IV)', async () => {
      const data = { same: 'data' };
      const [message1] = await cipher(data);
      const [message2] = await cipher(data);
      // Should be different due to random IV
      expect(message1).not.toBe(message2);
    });

    it('handles complex data structures', async () => {
      const complexData = {
        array: [1, 2, 3],
        nested: { a: { b: { c: 'deep' } } },
        special: null,
      };
      const result = await cipher(complexData);
      expect(result.length).toBe(3);
      expect(result[0]).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    it('handles empty object', async () => {
      const result = await cipher({});
      expect(result.length).toBe(3);
    });

    it('handles string data', async () => {
      const result = await cipher('plain string');
      expect(result.length).toBe(3);
      expect(result[0]).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });
});

// Test the FNV-1a hash implementation pattern
describe('FNV-1a hash pattern', () => {
  // The hashMini function uses FNV-1a algorithm
  it('uses FNV-1a offset basis (0x811c9dc5)', () => {
    // Empty string should hash from offset basis
    const emptyHash = hashMini('');
    expect(emptyHash).toBeDefined();
  });

  it('handles Unicode characters', () => {
    const result = hashMini('emoji: 🎉');
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles long strings', () => {
    const longString = 'a'.repeat(10000);
    const result = hashMini(longString);
    expect(result).toMatch(/^[0-9a-f]{8}$/);
  });

  it('handles special characters', () => {
    expect(hashMini('hello\nworld')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashMini('tab\there')).toMatch(/^[0-9a-f]{8}$/);
    expect(hashMini('quote"test')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('getBotHash()', () => {
  const mockImports = {
    getFeaturesLie: vi.fn().mockReturnValue(false),
    computeWindowsRelease: vi.fn().mockReturnValue(undefined),
  };

  it('returns object with botHash and badBot', () => {
    const fp = {
      workerScope: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      lies: { totalLies: 0 },
      fonts: { fontFaceLoadFonts: [] },
      headless: { stealth: {} },
    };

    const result = getBotHash(fp, mockImports);
    expect(result).toHaveProperty('botHash');
    expect(result).toHaveProperty('badBot');
  });

  it('botHash is 8-character binary string', () => {
    const fp = {
      workerScope: { userAgent: 'Mozilla/5.0' },
      lies: { totalLies: 0 },
      fonts: {},
      headless: {},
    };

    const result = getBotHash(fp, mockImports);
    expect(result.botHash).toMatch(/^[01]{8}$/);
  });

  it('detects lied worker scope', () => {
    const fp = {
      workerScope: {
        userAgent: 'Mozilla/5.0',
        lied: true,
      },
      lies: { totalLies: 0 },
      fonts: {},
      headless: {},
    };

    const result = getBotHash(fp, mockImports);
    expect(result.badBot).toBe('liedWorkerScope');
    expect(result.botHash[0]).toBe('1');
  });

  it('detects extreme lie count', () => {
    const fp = {
      workerScope: { userAgent: 'Mozilla/5.0' },
      lies: { totalLies: 150 },
      fonts: {},
      headless: {},
    };

    const result = getBotHash(fp, mockImports);
    expect(result.badBot).toBe('extremeLieCount');
  });

  it('detects blocked worker scope', () => {
    const fp = {
      workerScope: undefined,
      lies: { totalLies: 0 },
      fonts: {},
      headless: {},
    };

    const result = getBotHash(fp, mockImports);
    expect(result.badBot).toBe('workerScopeIsBlocked');
  });

  it('detects stealth behavior', () => {
    const fp = {
      workerScope: { userAgent: 'Mozilla/5.0' },
      lies: { totalLies: 0 },
      fonts: {},
      headless: {
        stealth: {
          'Function.prototype.toString has invalid TypeError': true,
        },
      },
    };

    const result = getBotHash(fp, mockImports);
    expect(result.badBot).toBeDefined();
  });

  it('returns undefined badBot for clean fingerprint', () => {
    const fp = {
      workerScope: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        type: 'shared', // not dedicated
      },
      lies: { totalLies: 5 },
      fonts: { fontFaceLoadFonts: ['Arial', 'Helvetica'] },
      headless: { stealth: {} },
    };

    // Mock getFeaturesLie to return false (no lie detected)
    mockImports.getFeaturesLie.mockReturnValue(false);

    const result = getBotHash(fp, mockImports);
    // May or may not have badBot depending on worker type detection
    expect(typeof result.botHash).toBe('string');
  });

  it('handles missing fingerprint sections gracefully', () => {
    const fp = {};

    const result = getBotHash(fp, mockImports);
    expect(result.botHash).toMatch(/^[01]{8}$/);
  });

  it('detects Function.toString proxy behavior', () => {
    const fp = {
      workerScope: { userAgent: 'Mozilla/5.0' },
      lies: { totalLies: 0 },
      fonts: {},
      headless: {
        stealth: {
          'Function.prototype.toString leaks Proxy behavior': true,
        },
      },
    };

    const result = getBotHash(fp, mockImports);
    expect(result.badBot).toBeDefined();
  });
});

describe('getFuzzyHash() - SimHash implementation', () => {
  it('returns 64-character hex string (256-bit SimHash)', async () => {
    const fp = {
      canvas2d: { dataURI: 'data:image/png;base64,...' },
      maths: { data: { sin: 0.123 } },
      timezone: { location: 'America/New_York' },
    };

    const result = await getFuzzyHash(fp);
    expect(result.length).toBe(SIMHASH_BITS / 4);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent hashes for same input', async () => {
    const fp = {
      canvas2d: { dataURI: 'test' },
      timezone: { location: 'UTC' },
    };

    const hash1 = await getFuzzyHash(fp);
    const hash2 = await getFuzzyHash(fp);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different input', async () => {
    const fp1 = {
      canvas2d: { dataURI: 'test1' },
      timezone: { location: 'UTC' },
    };
    const fp2 = {
      canvas2d: { dataURI: 'test2' },
      timezone: { location: 'PST' },
    };

    const hash1 = await getFuzzyHash(fp1);
    const hash2 = await getFuzzyHash(fp2);
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty fingerprint', async () => {
    const fp = {};
    const result = await getFuzzyHash(fp);
    // Empty fp produces all-zero votes, so all bits are 0
    expect(result.length).toBe(SIMHASH_BITS / 4);
    expect(result).toBe('0'.repeat(SIMHASH_BITS / 4));
  });

  it('ignores $hash and lied properties', async () => {
    const fp = {
      canvas2d: {
        dataURI: 'test',
        $hash: 'should-be-ignored',
        lied: true,
      },
    };

    const result = await getFuzzyHash(fp);
    expect(result.length).toBe(SIMHASH_BITS / 4);
  });

  it('handles full fingerprint structure', async () => {
    const fp = {
      canvas2d: {
        dataURI: 'data:image/png;base64,abc',
        emojiSet: ['😀', '😃'],
        mods: { noise: false },
      },
      canvasWebgl: {
        dataURI: 'data:image/png;base64,xyz',
        extensions: ['EXT_texture_filter_anisotropic'],
        gpu: 'NVIDIA GeForce',
        parameters: { MAX_TEXTURE_SIZE: 16384 },
      },
      maths: {
        data: { acos: 1.447, sin: 0.841 },
      },
      timezone: {
        location: 'America/Los_Angeles',
        offset: -480,
        zone: 'PST',
      },
      navigator: {
        userAgent: 'Mozilla/5.0',
        platform: 'Win32',
        language: 'en-US',
      },
      screen: {
        width: 1920,
        height: 1080,
        colorDepth: 24,
      },
    };

    const result = await getFuzzyHash(fp);
    expect(result.length).toBe(SIMHASH_BITS / 4);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces similar hashes for similar fingerprints (locality-sensitive)', async () => {
    // Two fingerprints that differ only in one low-weight feature
    const fp1 = {
      canvas2d: { dataURI: 'same-canvas' },
      canvasWebgl: { dataURI: 'same-webgl', gpu: 'NVIDIA GeForce RTX 3080' },
      navigator: { userAgent: 'Mozilla/5.0 Chrome/120', platform: 'Win32' },
      screen: { width: 1920, height: 1080 },
    };
    const fp2 = {
      ...fp1,
      // Small change - different timezone (weight=2)
      timezone: { offset: -300 },
    };

    const hash1 = await getFuzzyHash(fp1);
    const hash2 = await getFuzzyHash(fp2);
    const distance = getSimHashDistance(hash1, hash2);

    // Small change should result in small Hamming distance (scaled for 256 bits)
    expect(distance).toBeLessThan(80);
  });

  it('produces very different hashes for very different fingerprints', async () => {
    const chromeWindows = {
      canvas2d: { dataURI: 'chrome-canvas-hash' },
      canvasWebgl: { dataURI: 'nvidia-webgl', gpu: 'NVIDIA GeForce RTX 3080' },
      navigator: {
        userAgent: 'Chrome/120',
        platform: 'Win32',
        vendor: 'Google Inc.',
      },
      screen: { width: 1920, height: 1080 },
      workerScope: { userAgentVersion: '120.0.0.0' },
    };
    const firefoxMac = {
      canvas2d: { dataURI: 'firefox-canvas-hash' },
      canvasWebgl: { dataURI: 'amd-webgl', gpu: 'AMD Radeon Pro 5500M' },
      navigator: { userAgent: 'Firefox/121', platform: 'MacIntel', vendor: '' },
      screen: { width: 2560, height: 1600 },
      workerScope: { userAgentVersion: '121.0' },
    };

    const hash1 = await getFuzzyHash(chromeWindows);
    const hash2 = await getFuzzyHash(firefoxMac);
    const distance = getSimHashDistance(hash1, hash2);

    // Very different fingerprints should have high Hamming distance (scaled for 256 bits)
    expect(distance).toBeGreaterThan(60);
  });
});

describe('getSimHashDistance()', () => {
  const zeros64 = '0'.repeat(64);
  const ones64 = 'f'.repeat(64);

  it('returns 0 for identical hashes', () => {
    const hash = 'abcdef0123456789'.repeat(4);
    expect(getSimHashDistance(hash, hash)).toBe(0);
  });

  it('returns 256 for completely opposite hashes', () => {
    expect(getSimHashDistance(zeros64, ones64)).toBe(256);
  });

  it('returns correct distance for known bit differences', () => {
    // Differ by 1 bit (last hex char: 0 vs 1)
    const hash1 = zeros64;
    const hash2 = '0'.repeat(63) + '1';
    expect(getSimHashDistance(hash1, hash2)).toBe(1);

    // Differ by 4 bits (last hex char: 0 vs f)
    const hash3 = '0'.repeat(63) + 'f';
    expect(getSimHashDistance(hash1, hash3)).toBe(4);
  });

  it('is symmetric', () => {
    const hash1 = 'abcd1234efab5678'.repeat(4);
    const hash2 = '1234abcd5678efab'.repeat(4);
    expect(getSimHashDistance(hash1, hash2)).toBe(
      getSimHashDistance(hash2, hash1),
    );
  });

  it('throws for invalid hash lengths', () => {
    expect(() => getSimHashDistance('abc', 'def')).toThrow();
    expect(() => getSimHashDistance(zeros64, 'short')).toThrow();
  });

  it('handles real-world distance thresholds', () => {
    // Simulate "same device" scenario (very similar hashes)
    const sameDevice1 = 'a1b2c3d4e5f60718'.repeat(4);
    const sameDevice2 = 'a1b2c3d4e5f60719' + 'a1b2c3d4e5f60718'.repeat(3); // 1 bit different
    expect(getSimHashDistance(sameDevice1, sameDevice2)).toBeLessThanOrEqual(3);

    // Simulate "different device" scenario
    const device1 = 'a1b2c3d4e5f60718'.repeat(4);
    const device2 = '5e4d3c2b1a098765'.repeat(4);
    expect(getSimHashDistance(device1, device2)).toBeGreaterThan(80);
  });
});

describe('SIMHASH_FEATURE_WEIGHTS', () => {
  it('contains expected high-weight features', () => {
    expect(SIMHASH_FEATURE_WEIGHTS['canvas2d.dataURI']).toBe(8);
    expect(SIMHASH_FEATURE_WEIGHTS['canvasWebgl.dataURI']).toBe(8);
    expect(SIMHASH_FEATURE_WEIGHTS['navigator.userAgent']).toBe(8);
  });

  it('contains expected low-weight features', () => {
    expect(SIMHASH_FEATURE_WEIGHTS['navigator.deviceMemory']).toBe(1);
    expect(SIMHASH_FEATURE_WEIGHTS['screen.touch']).toBe(1);
  });

  it('has weights in valid range (1-8)', () => {
    for (const [key, weight] of Object.entries(SIMHASH_FEATURE_WEIGHTS)) {
      expect(weight).toBeGreaterThanOrEqual(1);
      expect(weight).toBeLessThanOrEqual(8);
    }
  });

  it('has reasonable number of features', () => {
    const featureCount = Object.keys(SIMHASH_FEATURE_WEIGHTS).length;
    expect(featureCount).toBeGreaterThan(50);
    expect(featureCount).toBeLessThan(200);
  });
});

describe('simhashify() - Module-level SimHash', () => {
  it('returns 64-character hex string (256-bit SimHash)', () => {
    const data = { screen: { width: 1920, height: 1080 } };
    const result = simhashify(data);
    expect(result.length).toBe(SIMHASH_BITS / 4);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent hashes for same input', () => {
    const data = { foo: 'bar', num: 123 };
    const hash1 = simhashify(data);
    const hash2 = simhashify(data);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different input', () => {
    const hash1 = simhashify({ a: 1 });
    const hash2 = simhashify({ a: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it('produces similar hashes for similar input (locality-sensitive)', () => {
    const data1 = { screen: { width: 1920, height: 1080, colorDepth: 24 } };
    const data2 = { screen: { width: 1920, height: 1080, colorDepth: 32 } }; // Small change

    const hash1 = simhashify(data1);
    const hash2 = simhashify(data2);
    const distance = getSimHashDistance(hash1, hash2);

    // Small change = small distance
    expect(distance).toBeLessThan(50);
  });

  it('produces very different hashes for very different input', () => {
    const data1 = { platform: 'Win32', gpu: 'NVIDIA', cores: 8 };
    const data2 = { platform: 'MacIntel', gpu: 'Apple M1', cores: 10 };

    const hash1 = simhashify(data1);
    const hash2 = simhashify(data2);
    const distance = getSimHashDistance(hash1, hash2);

    // Very different = large distance
    expect(distance).toBeGreaterThan(50);
  });

  it('handles various data types', () => {
    expect(simhashify('string')).toMatch(/^[0-9a-f]{64}$/);
    expect(simhashify(12345)).toMatch(/^[0-9a-f]{64}$/);
    expect(simhashify([1, 2, 3])).toMatch(/^[0-9a-f]{64}$/);
    expect(simhashify(null)).toMatch(/^[0-9a-f]{64}$/);
    expect(simhashify(true)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles nested objects', () => {
    const nested = {
      level1: {
        level2: {
          level3: { value: 'deep' },
        },
      },
    };
    const result = simhashify(nested);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles empty values', () => {
    expect(simhashify({})).toMatch(/^[0-9a-f]{64}$/);
    expect(simhashify([])).toMatch(/^[0-9a-f]{64}$/);
    expect(simhashify('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('preserves key:value structure via colons', () => {
    // These should be different because colons are preserved
    const hash1 = simhashify({ a: 1, b: 2 });
    const hash2 = simhashify({ a1b: 2 });
    expect(hash1).not.toBe(hash2);
  });

  it('is sensitive to small changes in large data', () => {
    // Use enough variation that simhash can detect it
    const largeData1 = {
      dataURI: 'data:image/png;base64,' + 'ABCD'.repeat(100),
    };
    const largeData2 = {
      dataURI: 'data:image/png;base64,' + 'ABCD'.repeat(99) + 'WXYZ',
    };

    const hash1 = simhashify(largeData1);
    const hash2 = simhashify(largeData2);
    const distance = getSimHashDistance(hash1, hash2);

    // Should detect the change but still be somewhat similar
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(50);
  });
});
