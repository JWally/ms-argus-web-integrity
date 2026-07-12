import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { bindPatEndpoint, fetchPatProbe, getPatToken, diagString } from './pat';

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

describe('bindPatEndpoint', () => {
  it('binds PAT redemption to the scan CPI and session', () => {
    expect(
      bindPatEndpoint(
        'https://api.argus.pw/v1/pat-attestation',
        'argus_cpi_test_abc1234567',
        '11111111-2222-4333-8444-555555555555',
      ),
    ).toBe(
      'https://api.argus.pw/v1/pat-attestation?cpi=argus_cpi_test_abc1234567&sessionId=11111111-2222-4333-8444-555555555555',
    );
  });
});

describe('getPatToken (single scan)', () => {
  it('hits the network and does not cache the bound result', async () => {
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
    expect(sessionStorage.getItem('argus.pat.v1')).toBeNull();
  });

  it('ignores a legacy cached token and fetches a proof for this scan', async () => {
    const future = Math.floor(Date.now() / 1000) + 30;
    sessionStorage.setItem(
      'argus.pat.v1',
      JSON.stringify({ exp: future, token: 'cached.token' }),
    );
    const fetchSpy = vi.fn(
      () =>
        new Response(JSON.stringify({ token: 'fresh.token' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const r = await getPatToken('https://api/pat-attestation');
    expect(r.token).toBe('fresh.token');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
