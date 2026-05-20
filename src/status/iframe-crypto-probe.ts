/**
 * Iframe-Crypto Liveness Probe
 *
 * Stand-alone diagnostic: construct a double-nested hidden iframe (the
 * same shape `vm/bridge.ts` uses for its pristine `crypto.subtle`
 * reference), then time how long `subtle.generateKey({ECDH, P-256})`
 * takes inside it.
 *
 * Why this is an independent signal:
 *
 *   - Real browsers (Chrome, real Firefox, real Safari) resolve the
 *     keygen call in <100ms. We've never observed >300ms on real-user
 *     hardware.
 *
 *   - Automation runtimes whose iframe lifecycle is governed by an
 *     auxiliary process (Playwright Firefox via Marionette; Camoufox)
 *     orphan the nested iframe's WebCrypto thread. The Promise that
 *     `subtle.generateKey` returns never resolves. The 1-second
 *     timeout fires and `responsive: false` lands in the payload.
 *
 *   - Unlike the inline bridge fallback (which races the same call
 *     during the main pipeline), this probe is a pure measurement —
 *     no fallback, no behavior change. It's only used to set the
 *     payload field that the server analyzer can score on.
 *
 *   - Critically, this signal is **measured, not network-derived**.
 *     A network-timing rule could be fooled by slow clients or jitter;
 *     this one captures the runtime characteristic that distinguishes
 *     Marionette-augmented browsers from real ones, independent of
 *     RTT or scheduling noise.
 *
 * False-positive surface: any real-user environment where iframe
 * lifecycle is also affected (sandbox=allow-scripts iframes, certain
 * privacy modes that suspend background contexts). Watch real-user
 * telemetry post-deploy and tune the threshold if needed.
 *
 * @returns liveness snapshot for inclusion in the status fingerprint.
 */

// 2s matches the bridge's own iframe-crypto race (vm/bridge.ts) — keeps the
// probe and the in-flight workaround on the same tolerance so a session
// that just barely makes it through the bridge isn't simultaneously flagged
// by the probe.
const TIMEOUT_MS = 2000;
const HIDDEN_CSS =
  'display:none;width:0;height:0;border:none;position:absolute;left:-10000px';

export interface IframeCryptoProbe {
  /** True iff `subtle.generateKey` completed inside the nested iframe within TIMEOUT_MS. */
  responsive: boolean;
  /** Wall-clock ms the keygen took (rounded). null on timeout or any error. */
  elapsed_ms: number | null;
  /** True iff the nested iframe context was constructable at all. */
  iframe_created: boolean;
}

export async function probeIframeCrypto(): Promise<IframeCryptoProbe> {
  let iframeSubtle: SubtleCrypto | null = null;
  let host: HTMLDivElement | null = null;

  try {
    host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    iframe.style.cssText = HIDDEN_CSS;
    shadow.appendChild(iframe);
    document.body.appendChild(host);
    const win = iframe.contentWindow;
    if (win) {
      const doc1 = win.document;
      const iframe2 = doc1.createElement('iframe');
      iframe2.style.cssText = HIDDEN_CSS;
      doc1.body.appendChild(iframe2);
      const win2 = iframe2.contentWindow;
      if (win2) {
        try {
          iframeSubtle = (win2 as unknown as { crypto: Crypto }).crypto.subtle;
        } catch {
          iframeSubtle = null;
        }
      }
    }
  } catch {
    iframeSubtle = null;
  }

  const cleanup = (): void => {
    try {
      host?.remove();
    } catch {
      /* ignore */
    }
  };

  if (!iframeSubtle) {
    cleanup();
    return { responsive: false, elapsed_ms: null, iframe_created: false };
  }

  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      iframeSubtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
        'deriveBits',
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('iframe_crypto_timeout')),
          TIMEOUT_MS,
        );
      }),
    ]);
    const elapsed = performance.now() - start;
    return {
      responsive: true,
      elapsed_ms: Math.round(elapsed * 100) / 100,
      iframe_created: true,
    };
  } catch {
    return { responsive: false, elapsed_ms: null, iframe_created: true };
  } finally {
    if (timer) clearTimeout(timer);
    cleanup();
  }
}
