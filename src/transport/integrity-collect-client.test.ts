import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitIntegrityPayload } from './integrity-collect-client';

const baseInput = {
  endpoint: 'https://api.example.test/v1/integrity-collect',
  encrypted: Uint8Array.from([1, 2, 3]),
  clientPublicKey: 'client-public-key',
  sessionToken: 'session-token',
  cpi: 'argus_cpi_test_contract12345',
};

function fetchResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {},
): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        statusText: init.statusText,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('integrity collect submission client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('submits the encrypted envelope and returns the server session id', async () => {
    const onCacheUpdate = vi.fn();
    const fetchImpl = fetchResponse({
      session_id: 'server-session',
      cache: 'next-cache',
    });

    const sessionId = await submitIntegrityPayload({
      ...baseInput,
      fetchImpl,
      onCacheUpdate,
    });

    expect(sessionId).toBe('server-session');
    expect(fetchImpl).toHaveBeenCalledWith(
      baseInput.endpoint,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'X-Argus-V': '3' }),
      }),
    );
    expect(onCacheUpdate).toHaveBeenCalledWith('next-cache');
  });

  it('classifies a non-success response without parsing its body', async () => {
    const onSubmissionError = vi.fn();
    const fetchImpl = fetchResponse(
      { session_id: 'must-not-be-read' },
      { status: 429, statusText: 'Too Many Requests' },
    );

    const sessionId = await submitIntegrityPayload({
      ...baseInput,
      fetchImpl,
      onSubmissionError,
    });

    expect(sessionId).toBe('');
    expect(onSubmissionError).toHaveBeenCalledWith(
      'http_429_Too Many Requests',
    );
  });

  it('uses the global fetch adapter and the HTTP fallback status text', async () => {
    const onSubmissionError = vi.fn();
    const fetchImpl = fetchResponse({}, { status: 503, statusText: '' });
    vi.stubGlobal('fetch', fetchImpl);

    await expect(
      submitIntegrityPayload({ ...baseInput, onSubmissionError }),
    ).resolves.toBe('');

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(onSubmissionError).toHaveBeenCalledWith('http_503_error');
  });

  it('reports a successful response without a session id', async () => {
    const onSubmissionError = vi.fn();

    const sessionId = await submitIntegrityPayload({
      ...baseInput,
      fetchImpl: fetchResponse({ cache: 'next-cache' }),
      onSubmissionError,
    });

    expect(sessionId).toBe('');
    expect(onSubmissionError).toHaveBeenCalledWith('no_session_id_in_response');
  });

  it('classifies thrown fetch and malformed JSON failures', async () => {
    const thrownError = vi.fn();
    const malformedError = vi.fn();
    const throwingFetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const malformedFetch = vi.fn(
      async () =>
        new Response('{', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    await expect(
      submitIntegrityPayload({
        ...baseInput,
        fetchImpl: throwingFetch,
        onSubmissionError: thrownError,
      }),
    ).resolves.toBe('');
    await expect(
      submitIntegrityPayload({
        ...baseInput,
        fetchImpl: malformedFetch,
        onSubmissionError: malformedError,
      }),
    ).resolves.toBe('');

    expect(thrownError).toHaveBeenCalledWith('fetch_threw: network down');
    expect(malformedError).toHaveBeenCalledWith(
      expect.stringMatching(/^fetch_threw:/),
    );
  });

  it('normalizes a thrown value without a message and isolates error callbacks', async () => {
    const onSubmissionError = vi.fn(() => {
      throw new Error('diagnostic consumer failed');
    });
    const fetchImpl = vi.fn(async () => {
      throw null;
    }) as unknown as typeof fetch;

    await expect(
      submitIntegrityPayload({ ...baseInput, fetchImpl, onSubmissionError }),
    ).resolves.toBe('');

    expect(onSubmissionError).toHaveBeenCalledWith('fetch_threw: unknown');
  });

  it('isolates cache callback failures and rejects malformed cache values', async () => {
    const throwingCache = vi.fn(() => {
      throw new Error('consumer failed');
    });
    const oversizedCache = vi.fn();

    await expect(
      submitIntegrityPayload({
        ...baseInput,
        fetchImpl: fetchResponse({ session_id: 'one', cache: 'valid' }),
        onCacheUpdate: throwingCache,
      }),
    ).resolves.toBe('one');
    await expect(
      submitIntegrityPayload({
        ...baseInput,
        fetchImpl: fetchResponse({
          session_id: 'two',
          cache: 'x'.repeat(16_384),
        }),
        onCacheUpdate: oversizedCache,
      }),
    ).resolves.toBe('two');

    expect(throwingCache).toHaveBeenCalledWith('valid');
    expect(oversizedCache).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 42, ''])(
    'ignores a malformed cache value: %s',
    async (cache) => {
      const onCacheUpdate = vi.fn();

      await expect(
        submitIntegrityPayload({
          ...baseInput,
          fetchImpl: fetchResponse({ session_id: 'session', cache }),
          onCacheUpdate,
        }),
      ).resolves.toBe('session');

      expect(onCacheUpdate).not.toHaveBeenCalled();
    },
  );
});
