/**
 * Argus-Web API bridge — captures pristine native refs at construction time.
 *
 * Ported from ms-argus-bio/src/vm/bridge.ts with these changes:
 *   - Removed bio-specific GET_STROKE_DATA / GET_FEATURES APIs
 *   - Replaced IMMOLATE with a tamper-flag setter (no biometrics to poison)
 *   - GET_PAYLOAD_JSON / GET_SERVER_PUB_KEY adapted for fingerprint context
 *   - Added FETCH_TLS_FP / FETCH_TCP_PROBE / FETCH_H2_PROBE for sigint probes
 *   - Added POST_PAYLOAD to submit encrypted octet-stream to /v1/collect
 *   - HKDF info string changed to "argus-web-v1" (distinct from bio's "argus-bio-v1")
 *   - API IDs reordered: detection 0x01-0x12, crypto context 0x13-0x15,
 *     ECDH async 0x30-0x32, sigint fetch 0x40-0x43
 */

import { deflateRaw } from 'pako';
import type { SigintConfig } from '../utils/sigint';
import {
  fetchTlsFingerprint,
  fetchTcpProbe,
  fetchH2Probe,
} from '../utils/sigint';
import getBestWorkerScope from '../worker';
import getWebRTCData from '../webrtc';
import type { CSSMediaFingerprint } from '../cssmedia/types';

export interface ApiHandler {
  get?: () => unknown;
  call?: (thisArg: unknown, args: unknown[]) => unknown;
}

export class ApiBridge {
  private readonly handlers = new Map<number, ApiHandler>();

  register(apiId: number, handler: ApiHandler): void {
    this.handlers.set(apiId, handler);
  }

  get(apiId: number): unknown {
    const handler = this.handlers.get(apiId);
    if (!handler?.get) throw new Error(`API ${apiId}: no getter`);
    return handler.get();
  }

  call(apiId: number, _thisArg: unknown, args: unknown[]): unknown {
    const handler = this.handlers.get(apiId);
    if (!handler?.call) throw new Error(`API ${apiId}: no call handler`);
    return handler.call(_thisArg, args);
  }

  has(apiId: number): boolean {
    return this.handlers.has(apiId);
  }
}

/** Bridge API IDs for argus-web */
export const BridgeApi = {
  // ── Detection APIs ─────────────────────────────────────────────
  NAV_WEBDRIVER: 0x01,
  WIN_GET_OWN_PROP_NAMES: 0x02,
  DOC_GET_OWN_PROP_NAMES: 0x03,
  FN_TO_STRING: 0x04,
  NATIVE_REGEX_TEST: 0x05,
  PLUGINS_LENGTH: 0x06,
  CHROME_EXISTS: 0x07,
  NAV_WEBDRIVER_OWN: 0x08,
  PHANTOM_WEBDRIVER: 0x09,
  SCREEN_NO_TASKBAR: 0x0a,
  IFRAME_TO_STRING: 0x0b,
  GET_OWN_PROP_DESCRIPTOR: 0x0c,
  // Pointer event toString checks — general bot signals
  PTR_GET_COALESCED_STR: 0x0d,
  PTR_GET_PREDICTED_STR: 0x0e,
  PERF_NOW_STR: 0x0f,
  XREALM_COALESCED_STR: 0x10,
  XREALM_PREDICTED_STR: 0x11,
  XREALM_PERF_NOW_STR: 0x12,

  // ── Crypto context APIs ────────────────────────────────────────
  GET_PAYLOAD_JSON: 0x13, // fingerprint + sigint tokens + bot signals + vmHash
  GET_SERVER_PUB_KEY: 0x14,
  IMMOLATE: 0x15, // sets tamper=true in payload; server uses as signal
  GET_STABLE_HASH: 0x16, // fingerprint.hashes.stable — tied into vmHash

  // ── Timezone cross-validation APIs ────────────────────────────
  TZ_OFFSET: 0x17,   // Date.prototype.getTimezoneOffset() via pristine ref
  TZ_COMPUTED: 0x18, // parse-based offset (independent of getTimezoneOffset)
  TZ_LOCATION: 0x19, // Intl.DateTimeFormat resolved IANA timezone
  TZ_ZONE: 0x1a,     // timezone name from Date.toString() parentheses

  // ── Worker scope cross-validation ─────────────────────────────
  WS_COLLECT: 0x1b,  // async: spawns workers, returns full getBestWorkerScope() result

  // ── WebRTC integrity ───────────────────────────────────────────
  WEBRTC_COLLECT: 0x1c, // async: runs getWebRTCData(), returns WebRTCFingerprint | null

  // ── CSS Media cross-validation ─────────────────────────────────
  CSS_MEDIA_COLLECT: 0x1d, // sync: runs getCSSMedia(), returns flat normalized object | null

  // ── Session token for inner XOR scramble ──────────────────────
  GET_SESSION_TOKEN: 0x1e, // returns ctx.sessionToken (sent as X-Argus-Session header)

  // ── Async ECDH APIs (called via API_CALL_ASYNC) ────────────────
  ECDH_GENERATE_KEY: 0x30,
  ECDH_EXPORT_RAW: 0x31,
  ECDH_DERIVE_ENCRYPT: 0x32,

  // ── Sigint + submission fetch APIs (async) ─────────────────────
  FETCH_TLS_FP: 0x40,
  FETCH_TCP_PROBE: 0x41,
  FETCH_H2_PROBE: 0x42,
  POST_PAYLOAD: 0x43, // POST octet-stream → returns session_id
} as const;

export interface ArgusVmContext {
  /** Full fingerprint data to include in the encrypted payload */
  getPayload: () => Record<string, unknown>;
  /** Stable fingerprint hash — included in vmHash computation to tie hash to payload */
  getStableHash: () => string;
  /** Raw P-256 server public key (88-char base64) — from h2-probe */
  getServerPubKey: () => string;
  /** Called when tamper signals are detected — sets tampered=true in payload */
  onImmolate: (signals: string[]) => void;
  /** Sigint probe endpoints (optional — probes skipped if absent) */
  sigintConfig?: SigintConfig;
  /** POST target, e.g. "https://api.argus.pw/v1/collect" */
  apiEndpoint: string;
  /** Opaque session correlation token — forwarded as X-Argus-Session */
  sessionToken: string;
  /** Pre-started h2-probe token promise — reused to avoid a duplicate fetch */
  h2Promise?: Promise<string>;
  /**
   * Already-collected CSS media fingerprint — passed in rather than re-running getCSSMedia(),
   * which uses PHANTOM_DARKNESS (a shared singleton) and would clobber DOM state on a second call.
   */
  cssMedia?: CSSMediaFingerprint | null;
}

const HIDDEN_CSS =
  'position:absolute;width:0;height:0;border:0;overflow:hidden;clip:rect(0,0,0,0)';
const HKDF_INFO = new TextEncoder().encode('argus-web-v1');

/** Convert Uint8Array to base64 (chunked to avoid stack overflow) */
function uint8ToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

/** Convert base64 to Uint8Array */
function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Create the argus-web bridge, capturing pristine references BEFORE bot patching.
 * Must be called as early as possible in the page lifecycle.
 */
export function createArgusVmBridge(ctx: ArgusVmContext): ApiBridge {
  const bridge = new ApiBridge();

  // Capture pristine references at construction time
  const pristineToString = Function.prototype.toString;
  const pristineGetOwnPropertyNames = Object.getOwnPropertyNames;
  const pristineGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const nativeCodeRe = /\[native code]/;
  const pristineRegExpTest = RegExp.prototype.test;
  const pristineDateGetTZOffset = Date.prototype.getTimezoneOffset;

  // Capture timezone data using pristine references at construction time.
  // Bots that patch Date.getTimezoneOffset after bridge construction won't
  // affect these values.
  const tzOffset = (() => {
    try { return pristineDateGetTZOffset.call(new Date()); } catch { return 0; }
  })();
  const tzComputed = (() => {
    try {
      const [year, month, day] = JSON.stringify(new Date()).slice(1, 11).split('-');
      const now = +new Date(`${month}/${day}/${year}`);
      const utc = +new Date(`${year}-${month}-${day}`);
      return ~~((now - utc) / 60000);
    } catch { return 0; }
  })();
  const tzLocation = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { return ''; }
  })();
  const tzZone = (() => {
    try { return ('' + new Date()).replace(/.*\(|\).*/g, ''); } catch { return ''; }
  })();

  // Capture toString of key APIs before any bot patching
  let coalescedStr = '';
  let predictedStr = '';
  let perfNowStr = '';

  let coalescedFn: any = null;

  let predictedFn: any = null;

  let perfNowFn: any = null;
  try {
    coalescedFn = PointerEvent.prototype.getCoalescedEvents;
    coalescedStr = pristineToString.call(coalescedFn);
  } catch {
    /* unsupported browser */
  }
  try {
    predictedFn = PointerEvent.prototype.getPredictedEvents;
    predictedStr = pristineToString.call(predictedFn);
  } catch {
    /* unsupported browser */
  }
  try {
    perfNowFn = Performance.prototype.now;
    perfNowStr = pristineToString.call(perfNowFn);
  } catch {
    /* unsupported browser */
  }

  // Nested double-iframe: cross-realm toString + pristine crypto.subtle
  // Bypasses PHANTOM_DARKNESS and other bot hooks that patch top-level crypto
  let iframeToString: typeof Function.prototype.toString | null = null;
  let iframeCrypto: SubtleCrypto | null = null;
  try {
    const host = document.createElement('div');
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
        iframeToString = (
          win2 as unknown as {
            Function: {
              prototype: { toString: typeof Function.prototype.toString };
            };
          }
        ).Function.prototype.toString;

        try {
          iframeCrypto = (win2 as unknown as { crypto: Crypto }).crypto.subtle;
        } catch {
          /* crypto unavailable in iframe */
        }
      }
    }
    // Note: iframes are left attached until VM execution completes.
    // Removing them early (via setTimeout 0) destroys the crypto context mid-flight
    // because async sigint fetches yield the event loop, allowing the timeout to fire.
  } catch {
    /* iframe creation failed */
  }

  // ── Detection APIs ────────────────────────────────────────────────

  // 0x01: navigator.webdriver
  bridge.register(BridgeApi.NAV_WEBDRIVER, {
    get: () => (navigator as unknown as Record<string, unknown>).webdriver,
  });

  // 0x02: Object.getOwnPropertyNames(window) — filtered to underscore-prefixed names only
  // (bot-injected globals all start with _ or __; filtering prevents 700+ property iteration)
  bridge.register(BridgeApi.WIN_GET_OWN_PROP_NAMES, {
    call: () =>
      pristineGetOwnPropertyNames(window).filter((n) => n.startsWith('_')),
  });

  // 0x03: Object.getOwnPropertyNames(document) — filtered to cdc_-prefixed names
  bridge.register(BridgeApi.DOC_GET_OWN_PROP_NAMES, {
    call: () =>
      pristineGetOwnPropertyNames(document).filter(
        (n) => n.startsWith('cdc_') || n.startsWith('_'),
      ),
  });

  // 0x04: Function.prototype.toString (pristine) — arg[0] is the function
  bridge.register(BridgeApi.FN_TO_STRING, {
    call: (_thisArg, args) => {
      try {
        return pristineToString.call(args[0]);
      } catch {
        return '';
      }
    },
  });

  // 0x05: pristine RegExp.prototype.test for [native code] check
  bridge.register(BridgeApi.NATIVE_REGEX_TEST, {
    call: (_thisArg, args) =>
      pristineRegExpTest.call(nativeCodeRe, args[0] as string),
  });

  // 0x06: navigator.plugins.length
  bridge.register(BridgeApi.PLUGINS_LENGTH, {
    get: () => {
      try {
        return navigator.plugins.length;
      } catch {
        return 0;
      }
    },
  });

  // 0x07: !!window.chrome
  bridge.register(BridgeApi.CHROME_EXISTS, {
    get: () => !!(window as unknown as Record<string, unknown>).chrome,
  });

  // 0x08: navigator has own 'webdriver' property (patched via defineProperty)
  bridge.register(BridgeApi.NAV_WEBDRIVER_OWN, {
    get: () => {
      try {
        return (
          pristineGetOwnPropertyDescriptor(navigator, 'webdriver') !== undefined
        );
      } catch {
        return false;
      }
    },
  });

  // 0x09: phantom iframe webdriver check
  bridge.register(BridgeApi.PHANTOM_WEBDRIVER, {
    call: () => {
      try {
        const el = document.createElement('iframe');
        el.style.cssText = HIDDEN_CSS;
        document.body.appendChild(el);
        const wd = (
          el.contentWindow as unknown as { navigator: { webdriver: boolean } }
        ).navigator.webdriver;
        el.remove();
        return wd;
      } catch {
        return;
      }
    },
  });

  // 0x0A: screen dimensions match (no taskbar = virtual display)
  bridge.register(BridgeApi.SCREEN_NO_TASKBAR, {
    get: () =>
      screen.width === screen.availWidth &&
      screen.height === screen.availHeight,
  });

  // 0x0B: cross-realm toString from nested iframe
  bridge.register(BridgeApi.IFRAME_TO_STRING, {
    call: (_thisArg, args) => {
      if (!iframeToString) return '';
      try {
        return iframeToString.call(args[0]);
      } catch {
        return '';
      }
    },
  });

  // 0x0C: pristine Object.getOwnPropertyDescriptor
  bridge.register(BridgeApi.GET_OWN_PROP_DESCRIPTOR, {
    call: (_thisArg, args) => {
      try {
        return pristineGetOwnPropertyDescriptor(
          args[0] as object,
          args[1] as string,
        );
      } catch {
        return;
      }
    },
  });

  // 0x0D: toString of getCoalescedEvents (pre-captured)
  bridge.register(BridgeApi.PTR_GET_COALESCED_STR, {
    get: () => coalescedStr,
  });

  // 0x0E: toString of getPredictedEvents (pre-captured)
  bridge.register(BridgeApi.PTR_GET_PREDICTED_STR, {
    get: () => predictedStr,
  });

  // 0x0F: toString of Performance.prototype.now (pre-captured)
  bridge.register(BridgeApi.PERF_NOW_STR, {
    get: () => perfNowStr,
  });

  // 0x10: cross-realm toString of getCoalescedEvents
  bridge.register(BridgeApi.XREALM_COALESCED_STR, {
    get: () => {
      if (!iframeToString || !coalescedFn) return '';
      try {
        return iframeToString.call(coalescedFn);
      } catch {
        return '';
      }
    },
  });

  // 0x11: cross-realm toString of getPredictedEvents
  bridge.register(BridgeApi.XREALM_PREDICTED_STR, {
    get: () => {
      if (!iframeToString || !predictedFn) return '';
      try {
        return iframeToString.call(predictedFn);
      } catch {
        return '';
      }
    },
  });

  // 0x12: cross-realm toString of Performance.prototype.now
  bridge.register(BridgeApi.XREALM_PERF_NOW_STR, {
    get: () => {
      if (!iframeToString || !perfNowFn) return '';
      try {
        return iframeToString.call(perfNowFn);
      } catch {
        return '';
      }
    },
  });

  // ── Crypto context APIs ───────────────────────────────────────────

  // 0x13: get full payload JSON (fingerprint + sigint tokens + bot signals + vmHash)
  // args[0] = vmHash string, args[1] = vmSignals string[], args[2] = tampered boolean,
  //           args[3] = tlsResult string, args[4] = tcpToken string, args[5] = h2Token string
  bridge.register(BridgeApi.GET_PAYLOAD_JSON, {
    call: (_thisArg, args) => {
      let payload: Record<string, unknown>;
      try {
        payload = ctx.getPayload();
      } catch {
        return '';
      }
      payload.vmHash = args[0] as string;
      const vmSignals = args[1] as string[];
      const tampered = args[2] as boolean;
      const tlsResult = args[3];
      const tcpToken = args[4];
      const h2Token = args[5];
      if (vmSignals && vmSignals.length > 0) {
        payload.vmSignals = vmSignals;
      }
      if (tampered) {
        payload.tampered = true;
        // Poison pill: even if the bot nulls out `tampered`, these signals cause
        // the server to classify the session as a bot. The injection happens in
        // the bridge (native JS), not in the VM bytecode — harder to hook.
        const bs = payload.botSignals as Record<string, unknown>;
        if (bs) {
          bs.isHeadless = true;
          bs.hasLies = true;
        }
      }
      if (tlsResult) {
        payload.sigintTls = tlsResult;
      }
      if (tcpToken) {
        payload.sigintTcpToken = tcpToken;
      }
      if (h2Token) {
        payload.sigintH2Token = h2Token;
      }
      return JSON.stringify(payload);
    },
  });

  // 0x16: get stable fingerprint hash — included in vmHash to tie integrity hash to payload
  bridge.register(BridgeApi.GET_STABLE_HASH, {
    get: () => ctx.getStableHash(),
  });

  // 0x14: get server public key
  bridge.register(BridgeApi.GET_SERVER_PUB_KEY, {
    get: () => ctx.getServerPubKey(),
  });

  // 0x15: immolate — signal tamper detected; server uses tampered=true as a risk signal
  bridge.register(BridgeApi.IMMOLATE, {
    call: (_thisArg, args) => {
      ctx.onImmolate(args[0] as string[]);
    },
  });

  // ── Async ECDH APIs ───────────────────────────────────────────────

  // 0x30: ECDH key generation using pristine iframe crypto
  bridge.register(BridgeApi.ECDH_GENERATE_KEY, {
    call: async () => {
      const subtle = iframeCrypto ?? crypto.subtle;
      return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
        'deriveBits',
      ]);
    },
  });

  // 0x31: export raw public key → base64 string
  bridge.register(BridgeApi.ECDH_EXPORT_RAW, {
    call: async (_thisArg, args) => {
      const publicKey = args[0] as CryptoKey;
      const subtle = iframeCrypto ?? crypto.subtle;
      const rawPub = await subtle.exportKey('raw', publicKey);
      return uint8ToBase64(new Uint8Array(rawPub));
    },
  });

  // 0x32: ECDH derive + compress + AES-256-GCM encrypt
  // Returns encrypted Uint8Array: [iv(12) | ciphertext+tag]
  bridge.register(BridgeApi.ECDH_DERIVE_ENCRYPT, {
    call: async (_thisArg, args) => {
      const privateKey = args[0] as CryptoKey;
      const serverPubKeyB64 = args[1] as string;
      const payloadJSON = args[2] as string;

      const subtle = iframeCrypto ?? crypto.subtle;

      const serverPubBytes = base64ToUint8(serverPubKeyB64);
      const serverPubKey = await subtle.importKey(
        'raw',
        serverPubBytes.buffer as ArrayBuffer,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );

      const sharedBits = await subtle.deriveBits(
        { name: 'ECDH', public: serverPubKey },
        privateKey,
        256,
      );
      const hkdfKey = await subtle.importKey('raw', sharedBits, 'HKDF', false, [
        'deriveKey',
      ]);
      const salt = new TextEncoder().encode(
        new Date().toISOString().slice(0, 10),
      );
      const aesKey = await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );

      const encoded = new TextEncoder().encode(payloadJSON);
      const compressed = deflateRaw(encoded);

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        compressed.buffer as ArrayBuffer,
      );

      const ctBytes = new Uint8Array(ciphertext);
      const packed = new Uint8Array(12 + ctBytes.length);
      packed.set(iv);
      packed.set(ctBytes, 12);
      return packed;
    },
  });

  // ── Sigint + submission fetch APIs ────────────────────────────────
  // Pre-start sigint fetches eagerly so they run concurrently with bot detection.
  // By the time the VM calls 0x40/0x41/0x42, the fetches are already in flight
  // (or done), so sequential VM execution doesn't add serial network latency.

  const tlsPromise: Promise<string> = ctx.sigintConfig
    ? fetchTlsFingerprint(ctx.sigintConfig)
        .then((r) => (r ? JSON.stringify(r) : ''))
        .catch(() => '')
    : Promise.resolve('');

  const tcpPromise: Promise<string> = ctx.sigintConfig
    ? fetchTcpProbe(ctx.sigintConfig)
        .then((r) => {
          const data = r.data;
          return data && typeof data === 'object' && 'token' in data
            ? (data as { token: string }).token
            : '';
        })
        .catch(() => '')
    : Promise.resolve('');

  // Reuse the h2-probe fetch started by prefetchArgusVm() if available — avoids
  // a duplicate request. Falls back to starting a fresh fetch when bridge is
  // constructed outside the normal prefetch flow.
  const h2Promise: Promise<string> =
    ctx.h2Promise ??
    (ctx.sigintConfig
      ? fetchH2Probe(ctx.sigintConfig)
          .then((r) => {
            const data = r.data;
            return data && typeof data === 'object' && 'token' in data
              ? (data as { token: string }).token
              : '';
          })
          .catch(() => '')
      : Promise.resolve(''));

  // 0x40: fetch TLS fingerprint — awaits pre-started promise
  bridge.register(BridgeApi.FETCH_TLS_FP, {
    call: async () => tlsPromise,
  });

  // 0x41: fetch TCP probe — awaits pre-started promise
  bridge.register(BridgeApi.FETCH_TCP_PROBE, {
    call: async () => tcpPromise,
  });

  // 0x42: fetch H2 probe — awaits pre-started promise
  bridge.register(BridgeApi.FETCH_H2_PROBE, {
    call: async () => h2Promise,
  });

  // ── Timezone cross-validation APIs ───────────────────────────────────

  // 0x17: timezone offset via pristine Date.prototype.getTimezoneOffset
  bridge.register(BridgeApi.TZ_OFFSET, { get: () => tzOffset });

  // 0x18: timezone offset computed via date-parsing arithmetic (no hookable API)
  bridge.register(BridgeApi.TZ_COMPUTED, { get: () => tzComputed });

  // 0x19: IANA timezone from Intl.DateTimeFormat (captured at construction)
  bridge.register(BridgeApi.TZ_LOCATION, { get: () => tzLocation });

  // 0x1a: timezone name extracted from Date.toString() parentheses
  bridge.register(BridgeApi.TZ_ZONE, { get: () => tzZone });

  // ── Worker scope cross-validation ────────────────────────────────────

  // 0x1b: spawn workers fresh, collect all scope data, run full lie detection.
  // Called async by the VM; runs independently of collectIntegrity()'s own
  // worker spawn so results can be compared for parity.
  const wsEmpty = { lied: false, lies: {}, localeEntropyIsTrusty: true, localeIntlEntropyIsTrusty: true, best: '', scopes: {} };
  bridge.register(BridgeApi.WS_COLLECT, {
    call: async () => {
      try {
        return await getBestWorkerScope();
      } catch {
        return wsEmpty;
      }
    },
  });

  // 0x1c: collect WebRTC signals — runs getWebRTCData(), returns WebRTCFingerprint or null
  bridge.register(BridgeApi.WEBRTC_COLLECT, {
    call: async () => {
      try {
        return await getWebRTCData();
      } catch {
        return null;
      }
    },
  });

  // 0x1d: normalize already-collected CSS media fingerprint for VM access.
  // Uses ctx.cssMedia (collected during collectIntegrity()) rather than re-running getCSSMedia(),
  // which mutates PHANTOM_DARKNESS DOM and would produce corrupted results on a second call.
  //
  // hasMismatch: any non-viewport-dependent field where matchMediaCSS ≠ mediaCSS.
  // Orientation is intentionally excluded — getCSSMedia() uses main window matchMedia but
  // PHANTOM_DARKNESS (a 0x0 iframe) for CSS injection, so Firefox always reports a portrait/landscape
  // discrepancy there. All other fields are device/preference-level and should agree.
  bridge.register(BridgeApi.CSS_MEDIA_COLLECT, {
    call: () => {
      const r = ctx.cssMedia;
      if (!r) return null;
      const m = r.matchMediaCSS;
      const c = r.mediaCSS;
      const hasMismatch =
        m.pointer !== c.pointer ||
        m['any-pointer'] !== c['any-pointer'] ||
        m.hover !== c.hover ||
        m['any-hover'] !== c['any-hover'] ||
        m['prefers-color-scheme'] !== c['prefers-color-scheme'] ||
        m['prefers-reduced-motion'] !== c['prefers-reduced-motion'] ||
        m.monochrome !== c.monochrome ||
        m['inverted-colors'] !== c['inverted-colors'] ||
        m['forced-colors'] !== c['forced-colors'] ||
        m['color-gamut'] !== c['color-gamut'] ||
        m['display-mode'] !== c['display-mode'];
      return {
        // Full structures for display and server-side cross-checking
        mediaCSS: r.mediaCSS,
        matchMediaCSS: r.matchMediaCSS,
        screenQuery: r.screenQuery,
        // Flat fields for VM signal checks (dot-accessible in bytecode)
        pointer: m.pointer ?? '',
        hasMismatch,
        screenW: r.screenQuery.width,
        reportedW: window.screen.width,
      };
    },
  });

  // 0x1e: session token — used as part of the inner XOR scramble key.
  // The VM builds xorKey = sessionToken + deploySecret inside bytecode,
  // then XOR-scrambles the JSON before passing to ECDH encrypt.
  // Server reverses with X-Argus-Session header + INTEGRITY_DEPLOY_SECRET env var.
  bridge.register(BridgeApi.GET_SESSION_TOKEN, {
    get: () => ctx.sessionToken,
  });

  // 0x43: POST encrypted payload to /v1/collect — returns session_id or empty string
  // args[0] = encrypted Uint8Array, args[1] = client raw pubkey base64 (for X-Argus-Origin)
  bridge.register(BridgeApi.POST_PAYLOAD, {
    call: async (_thisArg, args) => {
      const encrypted = args[0] as Uint8Array;
      const clientPubKeyB64 = args[1] as string;
      try {
        const resp = await fetch(ctx.apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Argus-Origin': clientPubKeyB64,
            'X-Argus-Session': ctx.sessionToken,
          },
          body: encrypted.buffer as ArrayBuffer,
        });
        if (!resp.ok) return '';
        const json = (await resp.json()) as Record<string, unknown>;
        return (json.session_id as string) ?? '';
      } catch {
        return '';
      }
    },
  });

  return bridge;
}
