/**
 * Tests for three-store client UUID persistence.
 *
 * happy-dom provides localStorage and document.cookie but NOT indexedDB,
 * so we mock the IDB opener. The mock is backed by a Map that simulates
 * an object store well enough for get + put, which is all the utility
 * uses. Each test resets the map + memoisation + localStorage + cookie
 * to keep cases independent.
 */

 

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory IDB substitute. Shared across the mock factory and each test so
// we can read/write what the utility did.
const idbStorage = new Map<string, string>();
let idbAvailable = true;

function makeFakeRequest<T>(value: T | undefined): any {
  const req: any = { onsuccess: null, onerror: null, result: value };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

function makeFakeDb(): any {
  return {
    transaction: () => ({
      objectStore: () => ({
        get: (key: string) =>
          makeFakeRequest(
            idbStorage.has(key) ? { id: key, value: idbStorage.get(key) } : undefined,
          ),
        put: (record: { id: string; value: string }) => {
          idbStorage.set(record.id, record.value);
          return makeFakeRequest<void>(undefined);
        },
      }),
    }),
    close: () => {},
  };
}

vi.mock('./get-crypto-id', async () => {
  const actual = await vi.importActual<typeof import('./get-crypto-id')>('./get-crypto-id');
  return {
    ...actual,
    TABLE_NAME_CLIENT_UUID: 'client-uuid',
    openIntegrityDb: vi.fn(() =>
      idbAvailable ? Promise.resolve(makeFakeDb()) : Promise.reject(new Error('no idb')),
    ),
  };
});

import {
  getClientUuid,
  resetClientUuidMemo,
} from './get-client-uuid';

const COOKIE_NAME = '_argus_cuid';
const LS_KEY = 'argus_cuid';

// Tiny helper to read the cookie by name.
function getCookie(): string | undefined {
  for (const c of document.cookie.split(';')) {
    const eq = c.indexOf('=');
    if (eq < 0) continue;
    if (c.slice(0, eq).trim() === COOKIE_NAME) {
      return decodeURIComponent(c.slice(eq + 1));
    }
  }
  return undefined;
}

function clearCookie(): void {
  document.cookie = `${COOKIE_NAME}=; path=/; Max-Age=0`;
}

beforeEach(() => {
  idbStorage.clear();
  idbAvailable = true;
  localStorage.clear();
  clearCookie();
  resetClientUuidMemo();
});

afterEach(() => {
  resetClientUuidMemo();
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('getClientUuid — cold start', () => {
  it('generates a v4 UUID when no store has one', async () => {
    const result = await getClientUuid();
    expect(result.id).toMatch(UUID_V4);
    expect(result.conflicts).toEqual([]);
  });

  it('writes the generated UUID to all three stores', async () => {
    const { id } = await getClientUuid();
    // localStorage is synchronous; cookie too.
    expect(localStorage.getItem(LS_KEY)).toBe(id);
    expect(getCookie()).toBe(id);
    // IDB write is fire-and-forget; flush microtasks then check.
    await new Promise((r) => setTimeout(r, 10));
    expect(idbStorage.get('primary')).toBe(id);
  });
});

describe('getClientUuid — respawn across stores', () => {
  it('adopts the IDB value when others are missing', async () => {
    idbStorage.set('primary', 'from-idb-value');
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('from-idb-value');
    expect(conflicts).toEqual([]);
    expect(localStorage.getItem(LS_KEY)).toBe('from-idb-value');
    expect(getCookie()).toBe('from-idb-value');
  });

  it('adopts the localStorage value when IDB is empty and cookie is missing', async () => {
    localStorage.setItem(LS_KEY, 'from-local-value');
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('from-local-value');
    expect(conflicts).toEqual([]);
    expect(getCookie()).toBe('from-local-value');
    await new Promise((r) => setTimeout(r, 10));
    expect(idbStorage.get('primary')).toBe('from-local-value');
  });

  it('adopts the cookie value when IDB and localStorage are empty', async () => {
    document.cookie = `${COOKIE_NAME}=from-cookie-value; path=/`;
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('from-cookie-value');
    expect(conflicts).toEqual([]);
    expect(localStorage.getItem(LS_KEY)).toBe('from-cookie-value');
    await new Promise((r) => setTimeout(r, 10));
    expect(idbStorage.get('primary')).toBe('from-cookie-value');
  });
});

describe('getClientUuid — conflict precedence', () => {
  it('prefers IDB over localStorage and records the conflict', async () => {
    idbStorage.set('primary', 'idb-wins');
    localStorage.setItem(LS_KEY, 'local-loses');
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('idb-wins');
    expect(conflicts).toEqual(['localStorage']);
    expect(localStorage.getItem(LS_KEY)).toBe('idb-wins'); // overwritten
  });

  it('prefers localStorage over cookie when IDB is empty', async () => {
    localStorage.setItem(LS_KEY, 'local-wins');
    document.cookie = `${COOKIE_NAME}=cookie-loses; path=/`;
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('local-wins');
    expect(conflicts).toEqual(['cookie']);
    expect(getCookie()).toBe('local-wins');
  });

  it('records all dissenters when three stores disagree', async () => {
    idbStorage.set('primary', 'idb-val');
    localStorage.setItem(LS_KEY, 'local-val');
    document.cookie = `${COOKIE_NAME}=cookie-val; path=/`;
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('idb-val');
    expect(conflicts).toContain('localStorage');
    expect(conflicts).toContain('cookie');
    expect(conflicts).toHaveLength(2);
  });

  it('records no conflict when all three stores agree', async () => {
    idbStorage.set('primary', 'agreed');
    localStorage.setItem(LS_KEY, 'agreed');
    document.cookie = `${COOKIE_NAME}=agreed; path=/`;
    const { conflicts } = await getClientUuid();
    expect(conflicts).toEqual([]);
  });
});

describe('getClientUuid — IDB unavailable (Firefox private mode)', () => {
  it('falls back to localStorage/cookie cleanly', async () => {
    idbAvailable = false;
    const { id, conflicts } = await getClientUuid();
    expect(id).toMatch(UUID_V4);
    expect(conflicts).toEqual([]);
    expect(localStorage.getItem(LS_KEY)).toBe(id);
    expect(getCookie()).toBe(id);
  });

  it('still respawns across available stores when IDB is down', async () => {
    idbAvailable = false;
    document.cookie = `${COOKIE_NAME}=cookie-only; path=/`;
    const { id, conflicts } = await getClientUuid();
    expect(id).toBe('cookie-only');
    expect(conflicts).toEqual([]);
    expect(localStorage.getItem(LS_KEY)).toBe('cookie-only');
  });
});

describe('getClientUuid — memoisation', () => {
  it('returns the same bundle on repeated calls', async () => {
    const a = await getClientUuid();
    const b = await getClientUuid();
    expect(a).toBe(b);
    expect(a.id).toBe(b.id);
  });

  it('does not re-read stores after memoisation (even if they change)', async () => {
    const first = await getClientUuid();
    // Tamper with every store.
    idbStorage.set('primary', 'tampered-idb');
    localStorage.setItem(LS_KEY, 'tampered-local');
    document.cookie = `${COOKIE_NAME}=tampered-cookie; path=/`;
    const second = await getClientUuid();
    expect(second.id).toBe(first.id);
    expect(second.conflicts).toEqual([]);
  });
});

describe('getClientUuid — cookie behaviour', () => {
  it('URL-encodes cookie values containing special characters', async () => {
    // Simulate a legacy store holding a non-standard value with special chars.
    localStorage.setItem(LS_KEY, 'has spaces & symbols');
    const { id } = await getClientUuid();
    expect(id).toBe('has spaces & symbols');
    // Cookie should be URL-encoded on disk…
    expect(document.cookie).toContain(
      `${COOKIE_NAME}=${encodeURIComponent('has spaces & symbols')}`,
    );
    // …and getCookie() decodes back to the original.
    expect(getCookie()).toBe('has spaces & symbols');
  });
});
