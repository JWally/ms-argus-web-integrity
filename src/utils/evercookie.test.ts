import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getEvercookieId,
  getEvercookieIdSync,
  refreshEvercookieId,
  clearEvercookieId,
  getEvercookieDiagnostics,
  forceRespawn,
  type EvercookieData,
  type StorageMechanism,
} from './evercookie';

describe('evercookie', () => {
  beforeEach(async () => {
    // Clear all evercookie data before each test
    await clearEvercookieId().catch(() => {});
  });

  afterEach(async () => {
    await clearEvercookieId().catch(() => {});
  });

  describe('getEvercookieId()', () => {
    it('returns an EvercookieData object with required properties', async () => {
      const data = await getEvercookieId();

      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('created');
      expect(data).toHaveProperty('lastSeen');
    });

    it('returns id as a valid UUID', async () => {
      const data = await getEvercookieId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('returns created as an ISO date string', async () => {
      const data = await getEvercookieId();

      expect(() => new Date(data.created)).not.toThrow();
      expect(data.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns lastSeen as an ISO date string', async () => {
      const data = await getEvercookieId();

      expect(() => new Date(data.lastSeen)).not.toThrow();
      expect(data.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('returns memoised data on subsequent calls', async () => {
      const data1 = await getEvercookieId();
      const data2 = await getEvercookieId();

      expect(data1).toBe(data2); // Same object reference
      expect(data1.id).toBe(data2.id);
    });

    it('handles concurrent calls without generating duplicate IDs', async () => {
      const [data1, data2, data3] = await Promise.all([
        getEvercookieId(),
        getEvercookieId(),
        getEvercookieId(),
      ]);

      // All should return the same ID
      expect(data1.id).toBe(data2.id);
      expect(data2.id).toBe(data3.id);
    });

    it('recovers ID from storage after clearing memo', async () => {
      // Generate and store ID
      const data1 = await getEvercookieId();
      const originalId = data1.id;

      // Clear the memo (simulates new page load)
      await refreshEvercookieId();

      // Should recover the same ID
      const data2 = await getEvercookieId();
      expect(data2.id).toBe(originalId);
    });
  });

  describe('getEvercookieIdSync()', () => {
    it('returns undefined before getEvercookieId() is called', () => {
      const data = getEvercookieIdSync();
      expect(data).toBeUndefined();
    });

    it('returns data after getEvercookieId() is called', async () => {
      await getEvercookieId();
      const data = getEvercookieIdSync();

      expect(data).toBeDefined();
      expect(data?.id).toMatch(/^[0-9a-f-]+$/i);
    });
  });

  describe('refreshEvercookieId()', () => {
    it('clears memo and re-reads from storage', async () => {
      const data1 = await getEvercookieId();
      const data2 = await refreshEvercookieId();

      // Should be the same ID (recovered from storage)
      expect(data1.id).toBe(data2.id);
      // But different object references
      expect(data1).not.toBe(data2);
    });

    it('updates lastSeen timestamp', async () => {
      const data1 = await getEvercookieId();

      // Wait a small amount to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      const data2 = await refreshEvercookieId();

      expect(data2.lastSeen).not.toBe(data1.lastSeen);
      expect(new Date(data2.lastSeen).getTime()).toBeGreaterThan(
        new Date(data1.lastSeen).getTime(),
      );
    });
  });

  describe('clearEvercookieId()', () => {
    it('clears all stored data', async () => {
      // Generate and store ID
      const data1 = await getEvercookieId();
      const originalId = data1.id;

      // Clear everything
      await clearEvercookieId();

      // Generate new ID
      const data2 = await getEvercookieId();

      // Should be a different ID
      expect(data2.id).not.toBe(originalId);
    });

    it('clears sync accessor', async () => {
      await getEvercookieId();
      expect(getEvercookieIdSync()).toBeDefined();

      await clearEvercookieId();
      expect(getEvercookieIdSync()).toBeUndefined();
    });
  });

  describe('getEvercookieDiagnostics()', () => {
    it('returns diagnostics for all storage mechanisms', async () => {
      const diagnostics = await getEvercookieDiagnostics();

      expect(diagnostics).toHaveProperty('indexedDB');
      expect(diagnostics).toHaveProperty('localStorage');
      expect(diagnostics).toHaveProperty('sessionStorage');
      expect(diagnostics).toHaveProperty('cookie');
      expect(diagnostics).toHaveProperty('cacheAPI');
      expect(diagnostics).toHaveProperty('broadcastChannel');
      expect(diagnostics).toHaveProperty('generated');
    });

    it('shows hasData=false before storing', async () => {
      // Clear everything first to ensure clean state
      await clearEvercookieId();

      const diagnostics = await getEvercookieDiagnostics();

      // Check key stores that we can control
      // Note: Some stores may have leftover data in test env
      expect(diagnostics.generated.hasData).toBe(false);
    });

    it('shows hasData=true after storing', async () => {
      await getEvercookieId();
      const diagnostics = await getEvercookieDiagnostics();

      // At least some mechanisms should have data
      const hasAnyData = Object.entries(diagnostics)
        .filter(([key]) => key !== 'generated')
        .some(([_, value]) => value.hasData);

      expect(hasAnyData).toBe(true);
    });
  });

  describe('forceRespawn()', () => {
    it('returns count of successful writes', async () => {
      await getEvercookieId();
      const count = await forceRespawn();

      // Should have written to at least some stores
      expect(count).toBeGreaterThan(0);
    });

    it('writes to multiple stores', async () => {
      await getEvercookieId();
      const count = await forceRespawn();

      // In a browser environment, we expect at least:
      // localStorage, sessionStorage, cookie (IndexedDB and cacheAPI might not work in test env)
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('multi-storage respawning', () => {
    it('recovers ID when localStorage is cleared but others remain', async () => {
      // Store ID everywhere
      const data1 = await getEvercookieId();
      const originalId = data1.id;

      // Clear only localStorage
      try {
        localStorage.removeItem('device-id');
      } catch {}

      // Clear memo and recover
      const data2 = await refreshEvercookieId();

      // Should recover from another store
      expect(data2.id).toBe(originalId);
    });

    it('recovers ID when sessionStorage is cleared but others remain', async () => {
      // Store ID everywhere
      const data1 = await getEvercookieId();
      const originalId = data1.id;

      // Clear only sessionStorage
      try {
        sessionStorage.removeItem('device-id');
      } catch {}

      // Clear memo and recover
      const data2 = await refreshEvercookieId();

      // Should recover from another store
      expect(data2.id).toBe(originalId);
    });

    it('recovers ID when cookie is cleared but others remain', async () => {
      // Store ID everywhere
      const data1 = await getEvercookieId();
      const originalId = data1.id;

      // Clear only cookie
      try {
        document.cookie =
          'device-id=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
      } catch {}

      // Clear memo and recover
      const data2 = await refreshEvercookieId();

      // Should recover from another store
      expect(data2.id).toBe(originalId);
    });
  });

  describe('data integrity', () => {
    it('preserves created timestamp across recovery', async () => {
      const data1 = await getEvercookieId();
      const originalCreated = data1.created;

      // Wait and refresh
      await new Promise((resolve) => setTimeout(resolve, 10));
      const data2 = await refreshEvercookieId();

      // created should stay the same
      expect(data2.created).toBe(originalCreated);
    });

    it('tracks recovery source in recoveredFrom', async () => {
      // Clear first to ensure clean state
      await clearEvercookieId();

      // First call generates new ID
      const data1 = await getEvercookieId();
      // First generation should not have recoveredFrom
      expect(data1.recoveredFrom).toBeUndefined();

      // Second call recovers from storage
      const data2 = await refreshEvercookieId();

      // Should indicate which store it came from (or undefined if generated fresh)
      // In test env, IndexedDB might not persist properly, so recovery source varies
      // Note: faviconCache is NOT a recovery source (only stores 32 bits, used for write-only sync)
      const validSources: (StorageMechanism | undefined)[] = [
        undefined,
        'indexedDB',
        'cacheAPI',
        'localStorage',
        'sessionStorage',
        'cookie',
        'broadcastChannel',
      ];
      expect(validSources).toContain(data2.recoveredFrom);
    });
  });

  describe('UUID generation', () => {
    it('generates unique IDs', async () => {
      const ids = new Set<string>();

      for (let i = 0; i < 10; i++) {
        await clearEvercookieId().catch(() => {});
        const data = await getEvercookieId();
        ids.add(data.id);
      }

      // All IDs should be unique
      expect(ids.size).toBe(10);
    });

    it('generates valid UUID v4 format', async () => {
      await clearEvercookieId().catch(() => {});
      const data = await getEvercookieId();

      // UUID v4 specific checks
      const parts = data.id.split('-');
      expect(parts).toHaveLength(5);
      expect(parts[0]).toHaveLength(8);
      expect(parts[1]).toHaveLength(4);
      expect(parts[2]).toHaveLength(4);
      expect(parts[3]).toHaveLength(4);
      expect(parts[4]).toHaveLength(12);

      // Version 4 indicator
      expect(parts[2][0]).toBe('4');

      // Variant indicator (8, 9, a, or b)
      expect(['8', '9', 'a', 'b']).toContain(parts[3][0].toLowerCase());
    });
  });
});

describe('evercookie constants', () => {
  it('exports correct evercookie database store', async () => {
    const { EVERCOOKIE_DB_STORE } = await import('./constants');
    expect(EVERCOOKIE_DB_STORE).toBe('evercookie-store');
  });

  it('exports correct evercookie key', async () => {
    const { EVERCOOKIE_KEY } = await import('./constants');
    expect(EVERCOOKIE_KEY).toBe('device-id');
  });

  it('exports correct evercookie cache name', async () => {
    const { EVERCOOKIE_CACHE_NAME } = await import('./constants');
    expect(EVERCOOKIE_CACHE_NAME).toBe('argus-evercookie-cache');
  });

  it('exports correct broadcast channel name', async () => {
    const { BROADCAST_CHANNEL_NAME } = await import('./constants');
    expect(BROADCAST_CHANNEL_NAME).toBe('argus-evercookie-sync');
  });
});
