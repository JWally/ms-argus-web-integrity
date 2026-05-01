/**
 * Argus-Web API bridge — thin host-side surface for the VM bytecode.
 *
 * Ported from ms-argus-bio/src/vm/bridge.ts. After harden-jsvm/phase-2a,
 * the surface is minimal: sigint fetches, ECDH crypto, session token,
 * payload assembly with device identity signing, and POST. The 18
 * labeled detection endpoints + timezone + worker/webrtc/css-media
 * collectors that used to live here were removed — they were registered
 * but unused from bytecode, and the labels (NAV_WEBDRIVER etc.) were a
 * Rosetta stone for reversers. Pristine cross-realm crypto is still
 * captured at construction time via a nested double-iframe, used by the
 * ECDH APIs to defeat bot hooks on top-level `crypto.subtle`.
 */

import { deflateRaw } from 'pako';
import type { SigintConfig } from '../utils/sigint';
import {
  fetchTlsFingerprint,
  fetchTcpProbe,
  fetchH2Probe,
} from '../utils/sigint';
import { getCryptoId } from '../utils/get-crypto-id';
import { getClientUuid } from '../utils/get-client-uuid';
import type { IntegrityResult } from '../integrity';

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

/**
 * Bridge API IDs for argus-web.
 *
 * `const enum`: TypeScript inlines every `BridgeApi.FOO` reference to its
 * numeric literal at compile time and emits no runtime object. The names
 * never appear in the shipped bundle — prevents the Rosetta-stone problem
 * where a reverser could map bridge handler IDs back to semantic labels.
 *
 * Scope: this enum is intentionally minimal. Only APIs *actually called
 * from bytecode* (scripts/vm-src/main.ts) are registered. The previous
 * 0x01-0x12 detection endpoints and 0x17-0x1d cross-validation APIs were
 * removed in harden-jsvm/phase-2a — classification moved server-side and
 * the bytecode stopped calling them back in the 2026-04-13 strip. Adding
 * a new API ID here should be accompanied by a corresponding bytecode
 * call site; registered-but-unused APIs are attack surface without benefit.
 */
export const enum BridgeApi {
  // ── Payload composition helpers (opaque singletons) ────────────
  // 0x10 / 0x11 replace the old GET_PAYLOAD_JSON (0x13) handler. Bytecode
  // now assembles the full payload and runs a bytecode-native stringify,
  // so no JS-level serializer sits on the payload path. These two APIs
  // return individual values the walker needs (session UUID + meta),
  // hooking either only leaks that one piece rather than the whole payload.
  GET_PAYLOAD_UUID = 0x10,
  GET_META = 0x11,
  GET_SERVER_PUB_KEY = 0x14,

  // ── Session token for inner XOR scramble ──────────────────────
  GET_SESSION_TOKEN = 0x1e, // returns ctx.sessionToken (sent as X-Argus-Session header)

  // ── Device identity (persistent ECDSA keypair) ────────────────
  // 0x1f returns the SPKI-b64 pubkey (async — warmed at bridge setup,
  // promise resolves quickly after IDB open). 0x33 signs arbitrary bytes
  // with the cached private key and returns a base64 sig. Both return ""
  // on any failure so bytecode can detect-and-skip without branching.
  GET_CRYPTO_PUBKEY = 0x1f,
  SIGN_BYTES = 0x33,

  // ── Three-store client UUID (persistence signal) ──────────────
  // 0x20 returns { id, conflicts } — id is the persistent UUID chosen
  // across IDB / localStorage / cookie; conflicts lists stores that held
  // a different value (hint for server correlation on partial clears).
  // Warmed at bridge construction so IDB is open by the time bytecode
  // asks. Returns null on total failure; bytecode elides the field.
  GET_CLIENT_UUID = 0x20,

  // ── Async ECDH APIs (called via API_CALL_ASYNC) ────────────────
  ECDH_GENERATE_KEY = 0x30,
  ECDH_EXPORT_RAW = 0x31,
  ECDH_DERIVE_ENCRYPT = 0x32,

  // ── Sigint + submission fetch APIs (async) ─────────────────────
  FETCH_TLS_FP = 0x40,
  FETCH_TCP_PROBE = 0x41,
  FETCH_H2_PROBE = 0x42,
  POST_PAYLOAD = 0x43, // POST octet-stream → returns session_id

  // ── Anti-debug timing source ──────────────────────────────────
  // Returns a high-resolution monotonic timestamp (ms, float). Captured
  // from the nested pristine iframe at bridge construction so a later
  // page-level patch of performance.now doesn't affect it. Bytecode uses
  // this to detect breakpoints / step-debugging: a loop that normally
  // runs in <5ms blowing past 500ms is a strong tamper signal.
  PERF_NOW = 0x70,

  // ── Fingerprint slice APIs (vm-pristine-vault) ─────────────────
  // Each slice returns one device.* sub-object pre-collected by
  // collectIntegrity(). Bytecode composes the device object itself,
  // so an attacker hooking ApiBridge.prototype.get sees individual
  // unlabeled slices instead of the entire payload from one ctx.getPayload
  // call. Order here matches the IntegrityResult interface in src/integrity.ts.
  SLICE_CSS = 0x50,
  SLICE_ENGINE = 0x51,
  SLICE_MATH = 0x52,
  SLICE_HEADLESS = 0x53,
  SLICE_LIES = 0x54,
  SLICE_TRASH = 0x55,
  SLICE_SHIELDING = 0x56,
  SLICE_INCOGNITO = 0x57,
  SLICE_INTL = 0x58,
  SLICE_NAVIGATOR = 0x59,
  SLICE_SCREEN = 0x5a,
  SLICE_STATUS = 0x5b,
  SLICE_TIMEZONE = 0x5c,
  SLICE_TIMING = 0x5d,
  SLICE_CSSMEDIA = 0x5e,
  SLICE_WEBRTC = 0x5f,
  SLICE_WINDOW_PREFIXES = 0x60,
  SLICE_WORKER_SCOPE = 0x61,
  SLICE_ERRORS = 0x62,
}

export interface ArgusVmContext {
  /**
   * Pre-collected fingerprint. Slice handlers (0x50-0x62) return individual
   * sub-objects from this; meta is read via GET_META (0x11). No `getPayload`
   * thunk — the bytecode composes the device object and serializes it
   * natively, eliminating the "one hook leaks everything" attack on a single
   * payload-builder closure.
   */
  fingerprint: IntegrityResult;
  /**
   * Public client id (cpi) issued by ms-argus-platform. When set, the
   * POST_PAYLOAD bridge call includes `x-argus-cpi: <cpi>` so the server
   * can partition the resulting integrity record under (cpi, session_id)
   * rather than the unbound legacy partition.
   */
  cpi: string | null;
  /** Raw P-256 server public key (88-char base64) — from h2-probe */
  getServerPubKey: () => string;
  /** Sigint probe endpoints (optional — probes skipped if absent) */
  sigintConfig?: SigintConfig;
  /** POST target, e.g. "https://api.argus.pw/v1/integrity-collect" */
  apiEndpoint: string;
  /** Opaque session correlation token — forwarded as X-Argus-Session */
  sessionToken: string;
  /** Pre-started h2-probe token promise — reused to avoid a duplicate fetch */
  h2Promise?: Promise<string>;
  /**
   * Optional callback invoked when the POST submission fails. Receives a
   * short diagnostic string (HTTP status + statusText, or exception
   * message). The bridge still returns '' to keep the VM flow simple;
   * this side-channel lets the outer caller surface the actual failure
   * reason back to the loader's postMessage rather than reporting an
   * opaque 'submission_failed'. No-op if not provided.
   */
  onSubmissionError?: (detail: string) => void;
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

  // Warm the persistent ECDSA device-identity key pair. getCryptoId() opens
  // IndexedDB, reads or generates a P-256 keypair, and memoises it. Starting
  // it here means by the time POST_PAYLOAD fires (after sigint + ECDH work)
  // the bundle is almost certainly resolved — no blocking on IDB at send time.
  // Failures resolve to null so the POST handler can fall through to
  // unsigned submission (server tolerates missing sig headers during rollout).
  const cryptoIdPromise = getCryptoId().catch(() => null);

  // Warm the three-store client UUID in parallel with the keypair. Reads
  // IDB + localStorage + cookie, respawns across any missing stores, and
  // memoises. Resolves to null on total failure so the bytecode can elide
  // the device.client_uuid field rather than block submission.
  const clientUuidPromise = getClientUuid().catch(() => null);

  // Nested double-iframe → pristine crypto.subtle + JSON.stringify. Bypasses
  // bot hooks that patch top-level crypto (PHANTOM_DARKNESS etc.). Used by
  // the ECDH APIs (0x30-0x32) and the residual TLS-result stringify below.
  // Leave iframes attached until VM execution completes — removing them
  // early (setTimeout 0) destroys the crypto context mid-flight because
  // async sigint fetches yield the event loop.
  //
  // The payload JSON itself is now serialized inside the VM (see stringify()
  // in scripts/vm-src/main.ts) — no JS-level stringify is called on it.
  // iframeStringify therefore only protects the TLS-fingerprint string that
  // feeds into the sigintTls field, a lower-value target.
  let iframeCrypto: SubtleCrypto | null = null;
  let iframeStringify: typeof JSON.stringify | null = null;
  let iframePerfNow: (() => number) | null = null;
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
        try {
          iframeCrypto = (win2 as unknown as { crypto: Crypto }).crypto.subtle;
        } catch {
          /* crypto unavailable in iframe */
        }
        try {
          const win2Perf = (win2 as unknown as { performance: Performance })
            .performance;
          iframePerfNow = win2Perf.now.bind(win2Perf);
        } catch {
          /* performance unavailable in iframe */
        }
        try {
          const win2JSON = (win2 as unknown as { JSON: typeof JSON }).JSON;
          iframeStringify = win2JSON.stringify.bind(win2JSON);
        } catch {
          /* JSON unavailable in iframe */
        }
      }
    }
  } catch {
    /* iframe creation failed */
  }
  const safeStringify: typeof JSON.stringify =
    iframeStringify ?? JSON.stringify;

  // Pristine monotonic timer for anti-debug timing checks in bytecode.
  // Prefer the nested iframe's performance.now (captured before any page
  // patching); fall back to top-level performance.now then Date.now.
  // Bound to its owner so later reassignment of the bare reference can't
  // neutralize us.
  const safePerfNow: () => number =
    iframePerfNow ??
    (typeof performance !== 'undefined'
      ? performance.now.bind(performance)
      : Date.now.bind(Date));

  // ── Payload composition helpers ───────────────────────────────────

  // 0x10: fresh session UUID. Hooking this only leaks a correlation id, which
  // is immediately visible server-side on the decrypted payload anyway —
  // swapping it doesn't defeat the fingerprint.
  bridge.register(BridgeApi.GET_PAYLOAD_UUID, {
    get: () => crypto.randomUUID(),
  });

  // 0x11: meta sub-object (version + timing). Raw object, read-only from the
  // bytecode's perspective.
  bridge.register(BridgeApi.GET_META, {
    get: () => ctx.fingerprint.meta,
  });

  // 0x70: pristine monotonic timer for bytecode-side timing checks.
  bridge.register(BridgeApi.PERF_NOW, {
    get: () => safePerfNow(),
  });

  // ── Fingerprint slice APIs (0x50-0x62) ────────────────────────────
  // Each slice returns one device.* sub-object pre-collected in
  // collectIntegrity(). Bytecode composes the device object from these.
  // Order matches IntegrityResult in src/integrity.ts and the prior
  // ctx.getPayload composition order — important for keeping the
  // assembled JSON byte-stable across the refactor.
  const fp = ctx.fingerprint;
  bridge.register(BridgeApi.SLICE_CSS, { get: () => fp.css });
  bridge.register(BridgeApi.SLICE_ENGINE, { get: () => fp.engine });
  bridge.register(BridgeApi.SLICE_MATH, { get: () => fp.math });
  bridge.register(BridgeApi.SLICE_HEADLESS, { get: () => fp.headless });
  bridge.register(BridgeApi.SLICE_LIES, { get: () => fp.lies });
  bridge.register(BridgeApi.SLICE_TRASH, { get: () => fp.trash });
  bridge.register(BridgeApi.SLICE_SHIELDING, { get: () => fp.shielding });
  bridge.register(BridgeApi.SLICE_INCOGNITO, { get: () => fp.incognito });
  bridge.register(BridgeApi.SLICE_INTL, { get: () => fp.intl });
  bridge.register(BridgeApi.SLICE_NAVIGATOR, { get: () => fp.navigator });
  bridge.register(BridgeApi.SLICE_SCREEN, { get: () => fp.screen });
  bridge.register(BridgeApi.SLICE_STATUS, { get: () => fp.status });
  bridge.register(BridgeApi.SLICE_TIMEZONE, { get: () => fp.timezone });
  bridge.register(BridgeApi.SLICE_TIMING, { get: () => fp.timing });
  bridge.register(BridgeApi.SLICE_CSSMEDIA, { get: () => fp.cssMedia });
  bridge.register(BridgeApi.SLICE_WEBRTC, { get: () => fp.webrtc });
  bridge.register(BridgeApi.SLICE_WINDOW_PREFIXES, {
    get: () => fp.windowPrefixes,
  });
  bridge.register(BridgeApi.SLICE_WORKER_SCOPE, { get: () => fp.workerScope });
  bridge.register(BridgeApi.SLICE_ERRORS, { get: () => fp.errors });

  // 0x14: get server public key
  bridge.register(BridgeApi.GET_SERVER_PUB_KEY, {
    get: () => ctx.getServerPubKey(),
  });

  // ── Device-identity APIs (persistent ECDSA keypair) ──────────────
  // 0x1f returns the SPKI-b64 pubkey. Async because the keypair bundle is
  // fronted by a Promise that opens IndexedDB; warmed at bridge setup so
  // resolution is usually free by the time bytecode asks. Returns "" on any
  // failure so bytecode can gracefully skip attaching device_identity.
  bridge.register(BridgeApi.GET_CRYPTO_PUBKEY, {
    call: async () => {
      try {
        const cryptoId = await cryptoIdPromise;
        return cryptoId?.publicKey ?? '';
      } catch {
        return '';
      }
    },
  });

  // 0x20 returns the full client-UUID bundle { id, conflicts } or null.
  // Async because the warmed promise may still be pending when the bytecode
  // reaches this call (IDB open + read can take tens of ms on cold start).
  // Null return lets bytecode skip attaching the fields entirely.
  bridge.register(BridgeApi.GET_CLIENT_UUID, {
    call: async () => {
      try {
        return await clientUuidPromise;
      } catch {
        return null;
      }
    },
  });

  // 0x33 signs arbitrary bytes with the cached non-extractable private key.
  // Input is a "raw-byte string" where each char code is one byte (0-255) —
  // this matches the rest of the bytecode's string-as-byte pattern so the VM
  // can pass XOR'd output directly without base64 round-tripping. Returns
  // base64 signature, or "" on failure.
  bridge.register(BridgeApi.SIGN_BYTES, {
    call: async (_thisArg, args) => {
      try {
        const cryptoId = await cryptoIdPromise;
        if (!cryptoId) return '';
        const raw = args[0];
        if (typeof raw !== 'string' || raw.length === 0) return '';
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          bytes[i] = raw.charCodeAt(i) & 0xff;
        }
        const sigBuf = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          cryptoId.privateKey,
          bytes,
        );
        return uint8ToBase64(new Uint8Array(sigBuf));
      } catch {
        return '';
      }
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
        .then((r) => (r ? safeStringify(r) : ''))
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

  // 0x1e: session token — seed for the inner XOR scramble derivation.
  // The VM derives a per-byte key using Fibonacci-modulated sessionToken chars,
  // then XOR-scrambles the JSON before passing to ECDH encrypt.
  // Server reverses with X-Argus-Session header using the same derivation.
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
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'X-Argus-Origin': clientPubKeyB64,
          'X-Argus-Session': ctx.sessionToken,
          'X-Argus-V': '2',
        };
        // The payload is ECDH-encrypted before this call, so we can't add
        // cpi to the body. It's a routing concern anyway — the server
        // partitions on (cpi, session_id) regardless of the encrypted
        // fingerprint contents.
        if (ctx.cpi) headers['X-Argus-Cpi'] = ctx.cpi;
        const resp = await fetch(ctx.apiEndpoint, {
          method: 'POST',
          // Send the `_fpid` third-party cookie (scoped to .argus.pw) so
          // the API can verify its sig against the current TLS token.
          credentials: 'include',
          headers,
          body: encrypted.buffer as ArrayBuffer,
        });
        if (!resp.ok) {
          ctx.onSubmissionError?.(
            `http_${resp.status}_${resp.statusText || 'error'}`,
          );
          return '';
        }
        const json = (await resp.json()) as Record<string, unknown>;
        const sid = (json.session_id as string) ?? '';
        if (!sid) ctx.onSubmissionError?.('no_session_id_in_response');
        return sid;
      } catch (err) {
        ctx.onSubmissionError?.(
          `fetch_threw: ${(err as Error)?.message ?? 'unknown'}`,
        );
        return '';
      }
    },
  });

  return bridge;
}
