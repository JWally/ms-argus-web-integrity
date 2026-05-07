import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPatToken } from './pat';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPatToken', () => {
  it('returns the token from a 200 redemption response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(
            JSON.stringify({ token: 'nonce.expiry.hmac', expiryMs: 1 }),
          ),
      ),
    );
    const out = await fetchPatToken('https://api/pat-attestation');
    expect(out).toBe('nonce.expiry.hmac');
  });

  it('returns empty string on non-2xx (e.g. 401 challenge — iOS did not redeem)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Response(JSON.stringify({ challenge: 'abc' }), { status: 401 }),
      ),
    );
    expect(await fetchPatToken('https://api/pat-attestation')).toBe('');
  });

  it('returns empty string on a body without a token field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response(JSON.stringify({ unrelated: true }))),
    );
    expect(await fetchPatToken('https://api/pat-attestation')).toBe('');
  });

  it('returns empty string when fetch rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    expect(await fetchPatToken('https://api/pat-attestation')).toBe('');
  });

  it('returns empty string when the response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Response('<html>not json</html>')),
    );
    expect(await fetchPatToken('https://api/pat-attestation')).toBe('');
  });
});
