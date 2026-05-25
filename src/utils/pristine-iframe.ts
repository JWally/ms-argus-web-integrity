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
   * Pristine `crypto.getRandomValues` bound to the iframe's Crypto
   * instance. Page-realm hooks on `Crypto.prototype.getRandomValues`
   * don't propagate to nested iframes' prototypes, so this reference
   * stays honest even when an attacker has installed an addInitScript
   * Proxy on the top-level RNG (CASTLE-TO-ARGUS §3.3 inline-use-site
   * gap). Use at the bridge IV-generation site.
   *
   * Falls back to top-level `crypto.getRandomValues` if iframe lift
   * failed — `lifted: false` signals the session ran unhardened.
   */
  getRandomValues: <T extends ArrayBufferView | null>(buf: T) => T;
  /**
   * Pristine `crypto.randomUUID` bound to the iframe's Crypto instance.
   * Same defense as `getRandomValues`. Used by `GET_PAYLOAD_UUID` to
   * mint the session-bound payload UUID; if hooked at top level, an
   * attacker can force UUID collisions or mark sessions covertly.
   *
   * Falls back to top-level `crypto.randomUUID` if iframe lift failed,
   * or to a UUID derived from the iframe-pristine RNG when the iframe's
   * `randomUUID` itself is unavailable (older browsers).
   */
  randomUUID: () => string;
  /**
   * Source text snapshots of the iframe-realm `getRandomValues` and
   * `randomUUID` (UNBOUND — captured before `.bind()`). Used by the
   * cross-realm identity check in the status slice: compare
   * `Function.prototype.toString.call(crypto.getRandomValues)` against
   * this snapshot to catch `Object.defineProperty`-style page-realm
   * hooks. Null when capture failed (lift fallback path).
   */
  getRandomValuesNativeSource: string | null;
  randomUUIDNativeSource: string | null;
  /**
   * True if all references were successfully lifted from the iframe.
   * False if any fell back to top-level globals — indicates the
   * session is running unhardened (very early page lifecycle,
   * sandboxed environment, or attacker-induced iframe-creation failure
   * intended to neutralize the pristine-routed hardening).
   *
   * Shipped on the wire as `device.status.pristine.lifted` (see
   * `src/status/index.ts` and the `pristine` field on StatusFingerprint
   * in `src/status/types.ts`). Server-side scoring uses it as a soft
   * tampering signal, combined with the `getRandomValuesNativeSource`
   * / `randomUUIDNativeSource` snapshots above for tamper-evidence
   * cross-checking.
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
  let getRandomValues:
    | (<T extends ArrayBufferView | null>(buf: T) => T)
    | null = null;
  let randomUUID: (() => string) | null = null;
  let getRandomValuesNativeSource: string | null = null;
  let randomUUIDNativeSource: string | null = null;

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
        try {
          // Pristine getRandomValues bound to the iframe's Crypto
          // instance. A page-realm Proxy on Crypto.prototype.getRandomValues
          // doesn't propagate to the iframe — this reference is
          // structurally independent of top-level hooks. Bind so
          // reassigning the bare ref can't redirect. Snapshot the
          // UNBOUND source text first for the cross-realm identity
          // check in the status slice.
          const unboundRng = w2.crypto.getRandomValues;
          // Use iframe-realm Function.prototype.toString — if the
          // attacker patched top-level Function.prototype.toString
          // we don't want to read the lying value.
          const iframeFnToString = (
            win as unknown as { Function: FunctionConstructor }
          ).Function.prototype.toString;
          getRandomValuesNativeSource = (iframeFnToString as () => string).call(
            unboundRng,
          );
          getRandomValues = unboundRng.bind(w2.crypto) as <
            T extends ArrayBufferView | null,
          >(
            buf: T,
          ) => T;
        } catch {
          /* getRandomValues unavailable */
        }
        try {
          // randomUUID may be absent on older browsers. Capture if
          // available; the fallback further down derives a UUID from
          // the iframe-pristine RNG if so.
          if (typeof w2.crypto.randomUUID === 'function') {
            const unboundUuid = w2.crypto.randomUUID;
            const iframeFnToString = (
              win as unknown as { Function: FunctionConstructor }
            ).Function.prototype.toString;
            randomUUIDNativeSource = (iframeFnToString as () => string).call(
              unboundUuid,
            );
            randomUUID = unboundUuid.bind(w2.crypto);
          }
        } catch {
          /* randomUUID unavailable */
        }
      }
    }
  } catch {
    /* iframe creation failed; fall through to top-level fallbacks */
  }

  const lifted = !!(
    subtle &&
    stringify &&
    parse &&
    textEncode &&
    perfNow &&
    getRandomValues
  );

  // randomUUID fallback chain:
  // 1. iframe-pristine randomUUID (best)
  // 2. iframe-pristine getRandomValues + manual RFC 4122 v4 assembly
  //    (still defends against page-realm hooks)
  // 3. top-level crypto.randomUUID (unhardened — page hook reaches us)
  const fallbackRandomUUIDFromRng = (
    rng: <T extends ArrayBufferView | null>(buf: T) => T,
  ): (() => string) => {
    return () => {
      const b = new Uint8Array(16);
      rng(b);
      b[6] = (b[6] & 0x0f) | 0x40; // version 4
      b[8] = (b[8] & 0x3f) | 0x80; // variant 10
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
      return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
    };
  };

  const finalGetRandomValues =
    getRandomValues ??
    ((<T extends ArrayBufferView | null>(buf: T): T =>
      crypto.getRandomValues(buf as ArrayBufferView) as unknown as T) as <
      T extends ArrayBufferView | null,
    >(
      buf: T,
    ) => T);

  const finalRandomUUID =
    randomUUID ??
    (getRandomValues
      ? fallbackRandomUUIDFromRng(getRandomValues)
      : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID.bind(crypto)
        : fallbackRandomUUIDFromRng(finalGetRandomValues));

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
    getRandomValues: finalGetRandomValues,
    randomUUID: finalRandomUUID,
    getRandomValuesNativeSource,
    randomUUIDNativeSource,
    lifted,
  };
}
