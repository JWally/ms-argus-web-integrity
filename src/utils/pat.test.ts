import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPatProbe, diagString } from './pat';

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
