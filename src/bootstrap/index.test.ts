import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArgusReleaseManifest } from './manifest';

const publicKeyJwk: JsonWebKey = {
  key_ops: ['verify'],
  ext: true,
  kty: 'EC',
  x: 'IYkp3ntcKTMMB5-J1yVZkGyIRo8CydDDRzY8vT5XX5M',
  y: '8dXgkrrMt5vU901_GSEGJkAO3Gdy5EBMkHI9XzeYuqg',
  crv: 'P-256',
};

function installFakeScript(src: string): HTMLScriptElement {
  const el = document.createElement('script');
  el.setAttribute('src', src);
  Object.defineProperty(document, 'currentScript', {
    value: el,
    configurable: true,
  });
  return el;
}

describe('argus bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    delete (window as unknown as { argusBootstrapReady?: unknown })
      .argusBootstrapReady;
    vi.stubGlobal('__ARGUS_MANIFEST_PUBLIC_KEY__', publicKeyJwk);
    vi.stubGlobal('__ARGUS_MANIFEST_KEY_ID__', 'argus-dev-jw-manifest-v1');
  });

  it('fetches the signed manifest and injects the pinned loader', async () => {
    installFakeScript(
      'https://static-integrity-dev-jw.argus.pw/argus-bootstrap.v1.iife.js',
    );
    vi.doMock('./manifest', () => ({
      verifyManifest: vi.fn(async (manifest: ArgusReleaseManifest) => ({
        ...manifest.payload,
      })),
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          payload: {
            v: 1,
            keyId: 'argus-dev-jw-manifest-v1',
            releaseId: 'release-test',
            environment: 'dev-jw',
            allowedOrigins: ['https://static-integrity-dev-jw.argus.pw'],
            notBefore: '2026-06-27T00:00:00.000Z',
            expiresAt: '2026-06-28T00:00:00.000Z',
            loader: {
              url: 'https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js',
              integrity: 'sha384-loaderhash',
            },
          },
          signature: 'signature',
        }),
      })),
    );

    let appended: HTMLScriptElement | null = null;
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      if (node instanceof HTMLScriptElement) {
        appended = node;
        queueMicrotask(() => node.dispatchEvent(new Event('load')));
        return node;
      }
      return HTMLElement.prototype.appendChild.call(document.head, node);
    }) as typeof document.head.appendChild);

    await import('./index');
    await (window as unknown as { argusBootstrapReady: Promise<void> })
      .argusBootstrapReady;

    expect(fetch).toHaveBeenCalledWith(
      'https://static-integrity-dev-jw.argus.pw/argus-manifest.json',
      { cache: 'no-store', credentials: 'omit' },
    );
    expect(appended?.src).toBe(
      'https://static-integrity-dev-jw.argus.pw/argus-loader.iife.js',
    );
    expect(appended?.integrity).toBe('sha384-loaderhash');
    expect(appended?.crossOrigin).toBe('anonymous');
  });

  it('fails closed when manifest verification rejects', async () => {
    installFakeScript(
      'https://static-integrity-dev-jw.argus.pw/argus-bootstrap.v1.iife.js',
    );
    vi.doMock('./manifest', () => ({
      verifyManifest: vi.fn(async () => {
        throw new Error('manifest_signature_invalid');
      }),
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ payload: {}, signature: 'bad' }),
      })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('./index');

    await expect(
      (window as unknown as { argusBootstrapReady: Promise<void> })
        .argusBootstrapReady,
    ).rejects.toThrow('manifest_signature_invalid');
    expect(document.head.querySelectorAll('script').length).toBe(0);
  });
});
