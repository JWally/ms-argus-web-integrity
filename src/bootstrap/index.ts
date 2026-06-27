import { verifyManifest, type ArgusReleaseManifest } from './manifest';

declare const __ARGUS_MANIFEST_PUBLIC_KEY__: JsonWebKey | undefined;
declare const __ARGUS_MANIFEST_KEY_ID__: string | undefined;

const bootstrapScript =
  (document.currentScript as HTMLScriptElement | null) ?? null;
const bootstrapSrc = bootstrapScript?.src ?? '';

function bootstrapBase(): URL {
  if (!bootstrapSrc) throw new Error('argus_bootstrap_script_missing');
  return new URL(bootstrapSrc);
}

function manifestUrl(base: URL): string {
  return new URL('argus-manifest.json', base).toString();
}

function loadScript(url: string, integrity: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = url;
    script.integrity = integrity;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('argus_loader_unavailable')),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

async function install(): Promise<void> {
  const base = bootstrapBase();
  if (!__ARGUS_MANIFEST_PUBLIC_KEY__ || !__ARGUS_MANIFEST_KEY_ID__) {
    throw new Error('argus_manifest_key_missing');
  }

  const response = await fetch(manifestUrl(base), {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) throw new Error('argus_manifest_unavailable');

  const manifest = (await response.json()) as ArgusReleaseManifest;
  const payload = await verifyManifest(manifest, {
    publicKeyJwk: __ARGUS_MANIFEST_PUBLIC_KEY__,
    expectedKeyId: __ARGUS_MANIFEST_KEY_ID__,
    expectedOrigin: base.origin,
  });

  await loadScript(payload.loader.url, payload.loader.integrity);
}

const ready = install().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[argus-bootstrap] install failed:', message);
  throw error;
});

(
  window as unknown as { argusBootstrapReady?: Promise<void> }
).argusBootstrapReady = ready;
