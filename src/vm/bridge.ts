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

import type { SigintConfig } from '../utils/sigint';
import {
  fetchTlsFingerprint,
  fetchTcpProbe,
  fetchH2Probe,
} from '../utils/sigint';
import { bindPatEndpoint, getPatToken, diagString } from '../utils/pat';
import { getCryptoId } from '../utils/get-crypto-id';
import { getClientUuid } from '../utils/get-client-uuid';
import { getPristineRefs } from '../utils/pristine-iframe';
import type { IntegrityResult } from '../integrity';
import { submitIntegrityPayload } from '../transport/integrity-collect-client';

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

  // ── Server-managed client-carried state (read sync, written by
  // POST_PAYLOAD as a side effect of the response). Backed by
  // localStorage at the intentionally-bland key `cache`; per-merchant
  // scoping is automatic because the srcdoc iframe inherits the
  // parent's origin for storage purposes. Returns '' on absent or
  // localStorage unavailable. Bytecode elides payload.cache when empty.
  // Server side: helpers/device-history.ts + analysis/device-history.
  GET_CACHE = 0x21,

  // ── Async ECDH APIs (called via API_CALL_ASYNC) ────────────────
  ECDH_GENERATE_KEY = 0x30,
  ECDH_EXPORT_RAW = 0x31,
  ECDH_DERIVE_ENCRYPT = 0x32,

  // ── Sigint + submission fetch APIs (async) ─────────────────────
  FETCH_TLS_FP = 0x40,
  FETCH_TCP_PROBE = 0x41,
  FETCH_H2_PROBE = 0x42,
  POST_PAYLOAD = 0x43, // POST octet-stream → returns session_id
  FETCH_PAT_TOKEN = 0x44, // PAT (Apple Private Access Token) probe — '' if no signal
  FETCH_PAT_DIAG = 0x45, // PAT probe diagnostic — JSON string {status, ok, hasToken, err?}

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
  // FPJS-parity slices (FPJS-TO-ARGUS.md §8.1) — device fingerprinting.
  SLICE_CANVAS = 0x63,
  SLICE_AUDIO = 0x64,
  SLICE_FONTS = 0x65,
  // Worker self-attestation. Collected inside the dedicated VM worker
  // (src/index-worker.ts) by reading self.navigator + self.performance
  // directly. Anchors the iframe-supplied navigator slice against the
  // worker's own observations: an attacker who substitutes
  // device.navigator on the iframe → worker postMessage hop will
  // produce a payload where device.navigator.userAgent !==
  // device.worker_attest.ua. Server (helpers/device-mac.ts SLICE_ORDER)
  // absorbs this into the MAC chain and an analyzer can cross-check.
  SLICE_WORKER_ATTEST = 0x66,
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
  /**
   * Optional PAT attestation endpoint, e.g.
   * "https://api.argus.pw/v1/pat-attestation". If absent or unreachable,
   * the PAT signal is silently omitted from the payload. Apple-only;
   * non-iOS clients always resolve to no signal.
   */
  patEndpoint?: string;
  /** Opaque session correlation token — forwarded as X-Argus-Session */
  sessionToken: string;
  /**
   * The argus `session_id` written into the payload's `identifiers` and
   * used as the `(cpi, session_id)` partition key server-side. Minted
   * ONCE per scan by the iframe and threaded into BOTH the worker VM and
   * the in-iframe fallback VM, so a worker→fallback double-submit carries
   * the SAME session_id. That makes the server's single-use STUN claim
   * idempotent (`existing.sessionId === sessionId`) and the DDB write a
   * same-key retry instead of a cross-session replay (409). When absent
   * (legacy callers), the 0x10 handler falls back to a fresh per-run UUID.
   */
  sessionId?: string;
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
  /**
   * Server-managed client-carried state read from `localStorage('cache')`
   * by the outer caller (iframe). The bridge GET_CACHE handler returns
   * this verbatim. Empty string when absent / first visit. The worker
   * can't read localStorage itself (WorkerGlobalScope doesn't expose
   * it), so the iframe forwards it here.
   */
  cacheIn?: string;
  /**
   * Called by the bridge's POST_PAYLOAD handler when the server
   * responds with an updated cache blob. The outer caller is
   * responsible for persisting it (`localStorage.setItem('cache', v)`)
   * — the bridge can't do that itself from worker scope. Silent no-op
   * when not provided.
   */
  onCacheUpdate?: (newCache: string) => void;
}

// HKDF_INFO encoded via the pristine TextEncoder lifted from the nested
// iframe — see utils/pristine-iframe.ts. Lazy-initialized so module
// import order doesn't force iframe creation before document.body exists.
let HKDF_INFO_CACHED: Uint8Array<ArrayBuffer> | null = null;
function getHkdfInfo(): Uint8Array<ArrayBuffer> {
  if (HKDF_INFO_CACHED) return HKDF_INFO_CACHED;
  HKDF_INFO_CACHED = getPristineRefs().textEncode('argus-web-v1');
  return HKDF_INFO_CACHED;
}

// The localStorage key (intentionally bland: 'cache') is owned by
// index-iframe.ts now — the bridge runs in a Worker that can't touch
// localStorage. Iframe reads on the way in (sent via ctx.cacheIn),
// writes on ctx.onCacheUpdate.

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

  // Pristine cross-realm references — see utils/pristine-iframe.ts.
  // Lifts crypto.subtle, JSON.stringify, JSON.parse, TextEncoder,
  // performance.now from a nested double-iframe at module init.
  // Bypasses page-level bot hooks that patch top-level crypto
  // (PHANTOM_DARKNESS etc.) or the §3.11 chokepoint MITM that hooks
  // JSON.stringify / TextEncoder.encode to substitute baseline payloads.
  //
  // The payload JSON itself is serialized inside the VM (see
  // stringify() in scripts/vm-src/main.ts), so pristine.stringify is
  // only used for the TLS-fingerprint string that feeds into sigintTls.
  // pristine.textEncode IS load-bearing — it processes the VM-assembled
  // payload before encryption at the ECDH_DERIVE_ENCRYPT site below.
  const pristine = getPristineRefs();
  const iframeCrypto: SubtleCrypto | null = pristine.subtle;
  const safeStringify: typeof JSON.stringify = pristine.stringify;
  const safePerfNow: () => number = pristine.perfNow;

  // ── Payload composition helpers ───────────────────────────────────

  // 0x10: session UUID written into identifiers.session_id. Prefer the
  // scan-scoped id minted once by the iframe (ctx.sessionId) so the worker
  // and the in-iframe fallback submit under the SAME session_id — without
  // this, each VM run minted its own fresh UUID and a fallback re-submit of
  // the same (single-use) STUN cipher under a different session_id was
  // rejected as a cross-session replay (409). When ctx.sessionId is absent
  // (legacy callers), fall back to the iframe-pristine `randomUUID` so a
  // page-realm hook on `Crypto.prototype.randomUUID` still can't force
  // collisions or mark sessions covertly. The fallback chain inside
  // `pristine.randomUUID` (iframe → iframe-rng + manual v4 → top-level)
  // keeps it honest even if the iframe path is partially available.
  // See CASTLE-TO-ARGUS §3.3.
  bridge.register(BridgeApi.GET_PAYLOAD_UUID, {
    get: () => ctx.sessionId ?? pristine.randomUUID(),
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
  // FPJS-parity slices (FPJS-TO-ARGUS.md §8.1).
  bridge.register(BridgeApi.SLICE_CANVAS, { get: () => fp.canvas });
  bridge.register(BridgeApi.SLICE_AUDIO, { get: () => fp.audio });
  bridge.register(BridgeApi.SLICE_FONTS, { get: () => fp.fonts });
  // Worker self-attestation. Populated by index-worker.ts before
  // runArgusVm is invoked; undefined when this bridge runs in the
  // legacy iframe fallback path (no worker realm to self-attest from).
  // Bytecode reads via __api_get(0x66); macAbsorb tolerates missing
  // slices via the canonical 'null' stringify.
  bridge.register(BridgeApi.SLICE_WORKER_ATTEST, {
    get: () => (fp as { worker_attest?: unknown }).worker_attest,
  });

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

  // 0x21: return the server-managed client-carried state forwarded by
  // the iframe via ctx.cacheIn. The bridge runs in a dedicated Worker
  // (see index-worker.ts) and WorkerGlobalScope does NOT expose
  // localStorage, so the read happens iframe-side and the value is
  // shipped in the RunRequest. Empty string when absent / first visit.
  bridge.register(BridgeApi.GET_CACHE, {
    get: () => ctx.cacheIn ?? '',
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
        // Sign with the iframe-pristine subtle (same realm as
        // get-crypto-id used to generate cryptoId.privateKey) so a
        // page-realm hook on crypto.subtle.sign can't see the
        // to-be-signed bytes or substitute an attacker signature.
        // Falls back to top-level only if iframe lift failed.
        const signSubtle = iframeCrypto ?? crypto.subtle;
        const sigBuf = await signSubtle.sign(
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

  // ECDH crypto subtle, with fallback to global crypto if the nested-iframe
  // path hangs. Background: bridge constructs a double-nested hidden iframe
  // (above) to get a "pristine" crypto.subtle reference that bypasses bot
  // hooks on the top-level crypto. In Playwright Firefox (and similar
  // Marionette-augmented runners), the nested iframe's WebCrypto thread
  // becomes orphaned — `subtle.generateKey({ECDH,P-256}, false, ['deriveBits'])`
  // returns a Promise that never resolves. Real Firefox and real Chrome
  // resolve in <50ms. We race against a 2s deadline and fall back to the
  // top-level `crypto.subtle` on timeout. Once fallback is taken we keep
  // using global for the rest of the run — exportKey + deriveBits + encrypt
  // would all hang in the same iframe.
  let activeSubtle: SubtleCrypto = iframeCrypto ?? crypto.subtle;
  const fallbackToGlobal = (): void => {
    if (activeSubtle !== crypto.subtle) {
      activeSubtle = crypto.subtle;
    }
  };
  const withIframeTimeout = async <T>(
    promiseFactory: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> => {
    if (activeSubtle === crypto.subtle) return promiseFactory();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promiseFactory(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('iframe_crypto_timeout')),
            timeoutMs,
          );
        }),
      ]);
    } catch (err) {
      // Either the iframe-side Promise rejected, or our timer fired.
      // Switch to global crypto and let the caller retry.
      fallbackToGlobal();
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // 0x30: ECDH key generation using pristine iframe crypto (with fallback)
  bridge.register(BridgeApi.ECDH_GENERATE_KEY, {
    call: async () => {
      const params = {
        algo: { name: 'ECDH', namedCurve: 'P-256' } as const,
        extractable: false,
        usages: ['deriveBits'] as KeyUsage[],
      };
      try {
        return await withIframeTimeout(
          () =>
            activeSubtle.generateKey(
              params.algo,
              params.extractable,
              params.usages,
            ),
          2000,
        );
      } catch {
        // iframe path timed out or rejected; activeSubtle is now global.
        return crypto.subtle.generateKey(
          params.algo,
          params.extractable,
          params.usages,
        );
      }
    },
  });

  // 0x31: export raw public key → base64 string
  bridge.register(BridgeApi.ECDH_EXPORT_RAW, {
    call: async (_thisArg, args) => {
      const publicKey = args[0] as CryptoKey;
      const rawPub = await activeSubtle.exportKey('raw', publicKey);
      return uint8ToBase64(new Uint8Array(rawPub));
    },
  });

  // 0x32: ECDH derive + AES-256-GCM encrypt
  // Returns encrypted Uint8Array: [iv(12) | ciphertext+tag]
  bridge.register(BridgeApi.ECDH_DERIVE_ENCRYPT, {
    call: async (_thisArg, args) => {
      const privateKey = args[0] as CryptoKey;
      const serverPubKeyB64 = args[1] as string;
      const payloadJSON = args[2] as string;

      const subtle = activeSubtle;

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
      const salt = pristine.textEncode(new Date().toISOString().slice(0, 10));
      const aesKey = await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: getHkdfInfo() },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );

      // pristine.textEncode here is the critical defense (CASTLE-TO-ARGUS
      // §3.14 bullet A): payloadJSON is the VM-assembled fingerprint
      // string. A page-realm hook on TextEncoder.prototype.encode would
      // see plaintext or substitute a clean baseline before encryption.
      // pristine.textEncode runs through the nested-iframe TextEncoder,
      // out of reach of those hooks.
      const encoded = pristine.textEncode(payloadJSON);
      // pristine.getRandomValues for the AES-GCM IV (CASTLE-TO-ARGUS §3.3
      // inline use-site closure). The status-slice native-integrity probe
      // sees scan-time RNG state only; an attacker who installs a Proxy
      // on Crypto.prototype.getRandomValues *after* status collection
      // produces a true scan-time check but a predictable IV at this
      // line. The pristine iframe ref doesn't inherit page-realm hooks
      // on Crypto.prototype, so we're reading from a structurally
      // independent RNG. Use here is identical-shape to crypto.getRandomValues.
      const iv = pristine.getRandomValues(new Uint8Array(12));
      const ciphertext = await subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        encoded.buffer as ArrayBuffer,
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

  // PAT (Apple Private Access Token) probe. Single fetch shared across
  // two opcodes: 0x44 yields the server-signed token (empty on failure /
  // non-Apple), 0x45 yields a JSON diag string with status/ok/hasToken/err
  // — kept separate so attackers stripping the token field can't also
  // forge the diagnostic. Loose-coupling: omit ctx.patEndpoint to skip
  // both entirely.
  const patPromise = ctx.patEndpoint
    ? getPatToken(
        bindPatEndpoint(ctx.patEndpoint, ctx.cpi, ctx.sessionId),
      ).catch(() => ({
        token: '',
        status: 0,
        ok: false,
        hasToken: false,
        err: 'caught',
      }))
    : null;

  // 0x44: fetch PAT token — '' if no signal
  bridge.register(BridgeApi.FETCH_PAT_TOKEN, {
    call: async () => (patPromise ? (await patPromise).token : ''),
  });

  // 0x45: fetch PAT diag — '' when probe was skipped, JSON string otherwise
  bridge.register(BridgeApi.FETCH_PAT_DIAG, {
    call: async () => (patPromise ? diagString(await patPromise) : ''),
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
      // Fetch cannot set Sec-* client-hint headers. The server detector uses
      // device.navigator.userAgentData instead when Chromium omits them.
      return submitIntegrityPayload({
        endpoint: ctx.apiEndpoint,
        encrypted,
        clientPublicKey: clientPubKeyB64,
        sessionToken: ctx.sessionToken,
        cpi: ctx.cpi,
        onSubmissionError: ctx.onSubmissionError,
        onCacheUpdate: ctx.onCacheUpdate,
      });
    },
  });

  return bridge;
}
