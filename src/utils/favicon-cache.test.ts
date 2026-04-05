import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFaviconCacheId,
  getFaviconCacheIdSync,
  refreshFaviconCacheId,
  clearFaviconCacheId,
  setFaviconCacheId,
  getFaviconCacheDiagnostics,
  type FaviconCacheData,
} from './favicon-cache';

describe('favicon-cache', () => {
  beforeEach(async () => {
    await clearFaviconCacheId().catch(() => {});
  });

  afterEach(async () => {
    await clearFaviconCacheId().catch(() => {});
  });

  describe('getFaviconCacheId()', () => {
    it('returns a FaviconCacheData object with required properties', async () => {
      const data = await getFaviconCacheId();

      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('bits');
      expect(data).toHaveProperty('created');
      expect(data).toHaveProperty('lastSeen');
      expect(data).toHaveProperty('method');
    });

    it('returns id as an 8-character hex string', async () => {
      const data = await getFaviconCacheId();

      expect(data.id).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns bits as a 32-character binary string', async () => {
      const data = await getFaviconCacheId();

      expect(data.bits).toMatch(/^[01]{32}$/);
    });

    it('returns consistent id and bits', async () => {
      const data = await getFaviconCacheId();

      // Convert hex to number to binary
      const idAsNumber = parseInt(data.id, 16);
      const idAsBinary = idAsNumber.toString(2).padStart(32, '0');

      expect(idAsBinary).toBe(data.bits);
    });

    it('returns created as ISO date string', async () => {
      const data = await getFaviconCacheId();

      expect(() => new Date(data.created)).not.toThrow();
      expect(data.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns lastSeen as ISO date string', async () => {
      const data = await getFaviconCacheId();

      expect(() => new Date(data.lastSeen)).not.toThrow();
      expect(data.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns method as cacheAPI or generated', async () => {
      const data = await getFaviconCacheId();

      expect(['cacheAPI', 'timing', 'generated']).toContain(data.method);
    });

    it('returns memoised data on subsequent calls', async () => {
      const data1 = await getFaviconCacheId();
      const data2 = await getFaviconCacheId();

      expect(data1).toBe(data2); // Same object reference
      expect(data1.id).toBe(data2.id);
    });

    it('handles concurrent calls without generating duplicate IDs', async () => {
      const [data1, data2, data3] = await Promise.all([
        getFaviconCacheId(),
        getFaviconCacheId(),
        getFaviconCacheId(),
      ]);

      expect(data1.id).toBe(data2.id);
      expect(data2.id).toBe(data3.id);
    });

    it('recovers ID from storage after clearing memo', async () => {
      const data1 = await getFaviconCacheId();
      const originalId = data1.id;

      // Clear memo but not storage
      const data2 = await refreshFaviconCacheId();

      expect(data2.id).toBe(originalId);
    });
  });

  describe('getFaviconCacheIdSync()', () => {
    it('returns undefined before getFaviconCacheId() is called', () => {
      const data = getFaviconCacheIdSync();
      expect(data).toBeUndefined();
    });

    it('returns data after getFaviconCacheId() is called', async () => {
      await getFaviconCacheId();
      const data = getFaviconCacheIdSync();

      expect(data).toBeDefined();
      expect(data?.id).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe('refreshFaviconCacheId()', () => {
    it('clears memo and re-reads from storage', async () => {
      const data1 = await getFaviconCacheId();
      const data2 = await refreshFaviconCacheId();

      // Should be the same ID (recovered from storage)
      expect(data1.id).toBe(data2.id);
      // But different object references
      expect(data1).not.toBe(data2);
    });

    it('updates lastSeen timestamp', async () => {
      const data1 = await getFaviconCacheId();

      await new Promise((resolve) => setTimeout(resolve, 10));

      const data2 = await refreshFaviconCacheId();

      expect(data2.lastSeen).not.toBe(data1.lastSeen);
      expect(new Date(data2.lastSeen).getTime()).toBeGreaterThan(
        new Date(data1.lastSeen).getTime(),
      );
    });
  });

  describe('clearFaviconCacheId()', () => {
    it('clears all stored data', async () => {
      const data1 = await getFaviconCacheId();
      const originalId = data1.id;

      await clearFaviconCacheId();

      const data2 = await getFaviconCacheId();

      expect(data2.id).not.toBe(originalId);
    });

    it('clears sync accessor', async () => {
      await getFaviconCacheId();
      expect(getFaviconCacheIdSync()).toBeDefined();

      await clearFaviconCacheId();
      expect(getFaviconCacheIdSync()).toBeUndefined();
    });
  });

  describe('setFaviconCacheId()', () => {
    it('sets a specific hex ID', async () => {
      const targetId = 'deadbeef';
      const data = await setFaviconCacheId(targetId);

      expect(data.id).toBe(targetId);
    });

    it('generates correct bits for the ID', async () => {
      const targetId = 'deadbeef';
      const data = await setFaviconCacheId(targetId);

      const expectedBits = parseInt(targetId, 16).toString(2).padStart(32, '0');
      expect(data.bits).toBe(expectedBits);
    });

    it('persists the ID to storage', async () => {
      const targetId = 'cafebabe';
      await setFaviconCacheId(targetId);

      const data = await refreshFaviconCacheId();
      expect(data.id).toBe(targetId);
    });

    it('throws on invalid hex ID', async () => {
      await expect(setFaviconCacheId('not-hex')).rejects.toThrow(
        'Invalid hex ID',
      );
    });

    it('handles lowercase hex', async () => {
      const data = await setFaviconCacheId('abcdef01');
      expect(data.id).toBe('abcdef01');
    });

    it('handles uppercase hex by normalizing', async () => {
      const data = await setFaviconCacheId('ABCDEF01');
      // Should normalize to lowercase
      expect(data.id).toBe('abcdef01');
    });
  });

  describe('getFaviconCacheDiagnostics()', () => {
    it('returns diagnostic information', async () => {
      const diagnostics = await getFaviconCacheDiagnostics();

      expect(diagnostics).toHaveProperty('cacheAPIAvailable');
      expect(diagnostics).toHaveProperty('cacheAPIHasData');
      expect(diagnostics).toHaveProperty('metadataAvailable');
      expect(diagnostics).toHaveProperty('bitCount');
      expect(diagnostics).toHaveProperty('setBits');
    });

    it('shows no data before storing', async () => {
      const diagnostics = await getFaviconCacheDiagnostics();

      expect(diagnostics.cacheAPIHasData).toBe(false);
      expect(diagnostics.setBits).toHaveLength(0);
    });

    it('shows data after storing', async () => {
      await getFaviconCacheId();
      const diagnostics = await getFaviconCacheDiagnostics();

      // In test environment (happy-dom), Cache API may not be available
      // In real browser, this should be true
      if (diagnostics.cacheAPIAvailable) {
        expect(diagnostics.cacheAPIHasData).toBe(true);
        expect(diagnostics.setBits.length).toBeGreaterThan(0);
      } else {
        // Cache API not available in test env
        expect(diagnostics.cacheAPIHasData).toBe(false);
      }
    });

    it('reports correct bit count', async () => {
      const diagnostics = await getFaviconCacheDiagnostics();
      expect(diagnostics.bitCount).toBe(32);
    });

    it('shows which bits are set', async () => {
      // Set a known ID with specific bits
      await setFaviconCacheId('80000001'); // Binary: 1000...0001

      const diagnostics = await getFaviconCacheDiagnostics();

      // In test environment (happy-dom), Cache API may not be available
      if (diagnostics.cacheAPIAvailable) {
        // Bit 0 (LSB) and bit 31 (MSB) should be set
        expect(diagnostics.setBits).toContain(0);
        expect(diagnostics.setBits).toContain(31);
      } else {
        // Cache API not available, setBits will be empty
        expect(diagnostics.setBits).toHaveLength(0);
      }
    });
  });

  describe('binary encoding', () => {
    it('correctly encodes ID as bits', async () => {
      // Test with known value
      await setFaviconCacheId('00000001'); // Should have bit 0 set

      const data = await getFaviconCacheId();
      expect(data.bits.endsWith('1')).toBe(true);
      expect(data.bits.slice(0, -1)).toBe('0'.repeat(31));
    });

    it('correctly encodes max value', async () => {
      await setFaviconCacheId('ffffffff');

      const data = await getFaviconCacheId();
      expect(data.bits).toBe('1'.repeat(32));
    });

    it('correctly encodes zero', async () => {
      // Note: Zero is treated as "no data", so this tests the edge case
      await setFaviconCacheId('00000000');

      // After refresh, zero should be regenerated as new ID
      await clearFaviconCacheId();
      const data = await getFaviconCacheId();

      // Should have generated a new non-zero ID
      expect(data.bits).not.toBe('0'.repeat(32));
    });
  });

  describe('ID generation', () => {
    it('generates unique IDs', async () => {
      const ids = new Set<string>();

      for (let i = 0; i < 10; i++) {
        await clearFaviconCacheId().catch(() => {});
        const data = await getFaviconCacheId();
        ids.add(data.id);
      }

      expect(ids.size).toBe(10);
    });

    it('generates IDs with good bit distribution', async () => {
      // Generate several IDs and check bit distribution
      const allBits: number[] = [];

      for (let i = 0; i < 5; i++) {
        await clearFaviconCacheId().catch(() => {});
        const data = await getFaviconCacheId();

        for (let j = 0; j < data.bits.length; j++) {
          if (data.bits[j] === '1') {
            allBits.push(j);
          }
        }
      }

      // Should have bits set across the range, not just in one area
      const minBit = Math.min(...allBits);
      const maxBit = Math.max(...allBits);
      expect(maxBit - minBit).toBeGreaterThan(10);
    });
  });

  describe('persistence recovery', () => {
    it('recovers from cache after memo clear', async () => {
      const data1 = await getFaviconCacheId();

      // Clear only the memo
      const data2 = await refreshFaviconCacheId();

      expect(data2.id).toBe(data1.id);
      expect(data2.method).toBe('cacheAPI');
    });

    it('preserves created timestamp across recovery', async () => {
      const data1 = await getFaviconCacheId();
      const originalCreated = data1.created;

      await new Promise((resolve) => setTimeout(resolve, 10));
      const data2 = await refreshFaviconCacheId();

      expect(data2.created).toBe(originalCreated);
    });
  });
});

describe('favicon-cache integration with evercookie', () => {
  it('can sync ID with evercookie', async () => {
    // This test demonstrates how favicon cache can sync with evercookie
    const { getEvercookieId } = await import('./evercookie');

    // Get evercookie ID
    const evercookieData = await getEvercookieId();
    const evercookieIdShort = evercookieData.id.slice(0, 8);

    // Set favicon cache to match (first 8 chars of UUID)
    const faviconData = await setFaviconCacheId(evercookieIdShort);

    expect(faviconData.id).toBe(evercookieIdShort);
  });
});
