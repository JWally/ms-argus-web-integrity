import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchPatProbe, getPatToken, diagString } from './pat';

beforeEach(() => {
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPatProbe', () => {
  it('captures token + 200 ok on a redemption response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ token: 'signed.blob' }), {
            status: 200,
          }),
      ),
    );
    const r = await fetchPatProbe('https://api/pat-attestation');
    expect(r).toEqual({
      token: 'signed.blob',
      status: 200,
      ok: true,
      hasToken: true,
    });
  });

  it('captures status 401 with the challenge body (no redemption)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(
            JSON.stringify({ challenge: 'abc', tokenKey: 'def', maxAge: 60 }),
            { status: 401 },
          ),
      ),
    );
    const r = await fetchPatProbe('https://api/pat-attestation');
    expect(r).toEqual({
      token: '',
      status: 401,
      ok: false,
      hasToken: false,
    });
  });

  it('captures err when fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('NetworkError'))),
    );
    const r = await fetchPatProbe('https://api/pat-attestation');
    expect(r).toMatchObject({
      token: '',
      status: 0,
      ok: false,
      hasToken: false,
      err: 'NetworkError',
    });
  });

  it('captures status with empty body when JSON parse fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('<html>error</html>', { status: 502 })),
    );
    const r = await fetchPatProbe('https://api/pat-attestation');
    expect(r.token).toBe('');
    expect(r.status).toBe(502);
    expect(r.hasToken).toBe(false);
  });
});

describe('diagString', () => {
  it('omits err and token when there is none', () => {
    const s = diagString({
      token: 'x',
      status: 200,
      ok: true,
      hasToken: true,
    });
    const obj = JSON.parse(s);
    expect(obj).toEqual({ status: 200, ok: true, hasToken: true });
  });

  it('includes err when present', () => {
    const s = diagString({
      token: '',
      status: 0,
      ok: false,
      hasToken: false,
      err: 'TimeoutError',
    });
    expect(JSON.parse(s)).toEqual({
      status: 0,
      ok: false,
      hasToken: false,
      err: 'TimeoutError',
    });
  });
});

describe('getPatToken (cache-aware)', () => {
  it('hits the network when cache is empty and writes the result', async () => {
    const future = Math.floor(Date.now() / 1000) + 45;
    const fetchSpy = vi.fn(
      () =>
        new Response(JSON.stringify({ token: 'fresh.token', exp: future }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const r = await getPatToken('https://api/pat-attestation');
    expect(r.token).toBe('fresh.token');
    expect(r.exp).toBe(future);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const cached = JSON.parse(sessionStorage.getItem('argus.pat.v1') ?? '');
    expect(cached.token).toBe('fresh.token');
    expect(cached.exp).toBe(future);
  });

  it('reuses the cached token when exp is still in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 30;
    sessionStorage.setItem(
      'argus.pat.v1',
      JSON.stringify({ exp: future, token: 'cached.token' }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await getPatToken('https://api/pat-attestation');
    expect(r.token).toBe('cached.token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops the cached token when expired and fetches fresh', async () => {
    const past = Math.floor(Date.now() / 1000) - 5;
    sessionStorage.setItem(
      'argus.pat.v1',
      JSON.stringify({ exp: past, token: 'stale.token' }),
    );
    const future = Math.floor(Date.now() / 1000) + 45;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(
            JSON.stringify({ token: 'replacement.token', exp: future }),
          ),
      ),
    );
    const r = await getPatToken('https://api/pat-attestation');
    expect(r.token).toBe('replacement.token');
    const cached = JSON.parse(sessionStorage.getItem('argus.pat.v1') ?? '');
    expect(cached.token).toBe('replacement.token');
  });

  it('does not write the cache on a 401 (no token in response)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ challenge: 'abc' }), { status: 401 }),
      ),
    );
    const r = await getPatToken('https://api/pat-attestation');
    expect(r.token).toBe('');
    expect(sessionStorage.getItem('argus.pat.v1')).toBeNull();
  });
});
