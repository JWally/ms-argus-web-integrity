import { describe, expect, it, vi } from 'vitest';

import { fetchWorkerSource } from './worker-source';

describe('fetchWorkerSource', () => {
  it('fetches the worker bundle with browser-enforced SRI', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => 'worker bytes',
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWorkerSource(
        'https://static-integrity-dev-jw.argus.pw/argus-integrity-worker.iife.js',
        'sha384-testdigest',
      ),
    ).resolves.toBe('worker bytes');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://static-integrity-dev-jw.argus.pw/argus-integrity-worker.iife.js',
      {
        credentials: 'omit',
        integrity: 'sha384-testdigest',
      },
    );

    vi.unstubAllGlobals();
  });

  it('fails closed when the baked worker integrity is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchWorkerSource(
        'https://static-integrity-dev-jw.argus.pw/argus-integrity-worker.iife.js',
        '',
      ),
    ).rejects.toThrow('worker_integrity_missing');

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('surfaces failed worker fetches as worker_fetch_<status>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => '',
      })),
    );

    await expect(
      fetchWorkerSource(
        'https://static-integrity-dev-jw.argus.pw/argus-integrity-worker.iife.js',
        'sha384-testdigest',
      ),
    ).rejects.toThrow('worker_fetch_403');

    vi.unstubAllGlobals();
  });
});
