/**
 * Pristine JS-API references lifted from a nested hidden iframe.
 *
 * Hardens the SDK against the §3.11 chokepoint MITM attack
 * (see CASTLE-TO-ARGUS.md §3.14): an attacker who hooks a global JS
 * primitive — `JSON.stringify`, `TextEncoder.prototype.encode`,
 * `JSON.parse`, `crypto.subtle.*`, `performance.now` — can read
 * plaintext flowing toward the wire or substitute a clean baseline
 * before encryption.
 *
 * The nested iframe is constructed at module init, its
 * `contentWindow` exposes a fresh JS realm with prototypes that
 * page-level wraps don't reach. References captured here are
 * bound to the iframe's owners so reassignment of the bare
 * top-level globals can't neutralize them.
 *
 * If iframe creation fails (very early in document lifecycle,
 * `document.body` not yet available, sandboxed environment with
 * iframes disabled), the singleton falls back to top-level
 * globals — the SDK still works, just without the hardening for
 * this session. A `lifted` flag exposes which mode is active so
 * server-side analyzers can score sessions that ran unprotected.
 *
 * Lifetime: the iframe is left attached for the lifetime of the
 * page. Earlier removal (setTimeout 0) was tried in an older
 * revision and broke the crypto context mid-flight when async
 * sigint fetches yielded the event loop — see comment in
 * `vm/bridge.ts` at the original inline implementation.
 */

const HIDDEN_CSS =
  'position:absolute;width:0;height:0;border:0;overflow:hidden;clip:rect(0,0,0,0)';

export interface PristineRefs {
  /** Pristine `crypto.subtle`, or null if iframe lift failed. */
  subtle: SubtleCrypto | null;
  /** Pristine `JSON.stringify` (falls back to top-level on failure). */
  stringify: typeof JSON.stringify;
  /** Pristine `JSON.parse` (falls back to top-level on failure). */
  parse: typeof JSON.parse;
  /**
   * Pristine `TextEncoder.prototype.encode` bound to a pristine instance.
   * Falls back to a wrapper around top-level TextEncoder on failure.
   */
  textEncode: (input: string) => Uint8Array<ArrayBuffer>;
  /** Pristine `performance.now` (falls back to top-level or `Date.now`). */
  perfNow: () => number;
  /**
   * True if all references were successfully lifted from the iframe.
   * False if any fell back to top-level globals — indicates the
   * session is running unhardened (very early page lifecycle,
   * sandboxed environment, etc.).
   */
  lifted: boolean;
}

let cached: PristineRefs | null = null;

/**
 * Get the pristine references, lifting from a fresh iframe on first
 * call. Subsequent calls return the cached singleton.
 *
 * Safe to call repeatedly. Idempotent. Returns the same object every
 * time so consumers can compare-by-identity.
 */
export function getPristineRefs(): PristineRefs {
  if (cached) return cached;
  cached = liftRefs();
  return cached;
}

/** Reset the cached singleton (test-only). */
export function resetPristineRefsForTesting(): void {
  cached = null;
}

function liftRefs(): PristineRefs {
  let subtle: SubtleCrypto | null = null;
  let stringify: typeof JSON.stringify | null = null;
  let parse: typeof JSON.parse | null = null;
  let textEncode: ((input: string) => Uint8Array<ArrayBuffer>) | null = null;
  let perfNow: (() => number) | null = null;

  try {
    if (typeof document === 'undefined' || !document.body) {
      throw new Error('document.body not available');
    }
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    iframe.style.cssText = HIDDEN_CSS;
    shadow.appendChild(iframe);
    document.body.appendChild(host);
    const win = iframe.contentWindow;
    if (win) {
      // Nested iframe — defense-in-depth against attackers who patch
      // HTMLIFrameElement.prototype.contentWindow at the top level
      // (which only catches direct-children iframes; the inner
      // iframe is reached via the outer iframe's document context,
      // not the top-level one).
      const doc1 = win.document;
      const iframe2 = doc1.createElement('iframe');
      iframe2.style.cssText = HIDDEN_CSS;
      doc1.body.appendChild(iframe2);
      const win2 = iframe2.contentWindow;
      if (win2) {
        const w2 = win2 as unknown as {
          crypto: Crypto;
          performance: Performance;
          JSON: typeof JSON;
          TextEncoder: typeof TextEncoder;
        };
        try {
          subtle = w2.crypto.subtle;
        } catch {
          /* crypto unavailable */
        }
        try {
          perfNow = w2.performance.now.bind(w2.performance);
        } catch {
          /* performance unavailable */
        }
        try {
          stringify = w2.JSON.stringify.bind(w2.JSON);
        } catch {
          /* JSON.stringify unavailable */
        }
        try {
          parse = w2.JSON.parse.bind(w2.JSON);
        } catch {
          /* JSON.parse unavailable */
        }
        try {
          // Capture the iframe's TextEncoder constructor and pre-build
          // an instance. .encode is bound so reassignment of the
          // bare reference can't redirect us. Wrapped in a closure
          // that takes a string and returns Uint8Array — keeps the
          // caller signature trivial.
          const enc = new w2.TextEncoder();
          const boundEncode = enc.encode.bind(enc);
          textEncode = (s: string) => boundEncode(s) as Uint8Array<ArrayBuffer>;
        } catch {
          /* TextEncoder unavailable */
        }
      }
    }
  } catch {
    /* iframe creation failed; fall through to top-level fallbacks */
  }

  const lifted = !!(subtle && stringify && parse && textEncode && perfNow);

  return {
    subtle,
    stringify: stringify ?? JSON.stringify,
    parse: parse ?? JSON.parse,
    textEncode:
      textEncode ??
      ((s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>),
    perfNow:
      perfNow ??
      (typeof performance !== 'undefined'
        ? performance.now.bind(performance)
        : Date.now.bind(Date)),
    lifted,
  };
}
