/**
 * Argus integrity loader — parent-realm entry point.
 *
 * A small stub that runs in the merchant page. On demand, it creates a
 * hidden srcdoc iframe, injects the integrity bundle into the iframe's
 * fresh realm, and resolves with the session id once the iframe posts
 * back. Running collection inside the iframe isolates it from parent-page
 * prototype patches (Sentry, FullStory, Hotjar, RUM, etc.).
 *
 * API endpoints are NOT configured here — they are baked into the iframe
 * bundle at build time based on the loader's stage. Merchant picks a stage
 * by choosing the loader URL (e.g. static-dev-jw.argus.pw for dev vs
 * static.argus.pw for prod). Merchants cannot redirect, inspect, or
 * override the API target.
 *
 * Integration patterns:
 *
 *   // Auto-run, safe-by-default scheduling (idle after window.load):
 *   <script
 *     src="https://.../argus-loader.iife.js"
 *     data-auto-run
 *     data-cpi="argus_cpi_live_..."
 *   ></script>
 *
 *   // Auto-run with explicit scheduling:
 *   //   data-on="immediate"   sync at parse time (legacy)
 *   //   data-on="load"        on window 'load' event
 *   //   data-on="idle"        after load + requestIdleCallback (default)
 *   //   data-on="interaction" first user pointerdown/keydown/scroll/touch
 *   <script src="..." data-auto-run data-on="interaction" data-cpi="..."></script>
 *
 *   // SPA — manual trigger, merchant controls when:
 *   <script src="..."></script>
 *   <script>
 *     const result = await window.argus.run({ sessionId: 'order-123', cpi: '...' });
 *   </script>
 */

/**
 * Caller-supplied attestation request — the iframe signs this with the
 * device's persistent keypair after the integrity scan completes and
 * returns the result inside the run() promise.
 *
 * See src/utils/attestation.ts for envelope shape and verification notes.
 */
interface AttestRequest {
  /**
   * Namespace tag for the signature (signed into the envelope). Verifiers
   * must check this matches the purpose they expect — prevents accidental
   * signature reuse across different protocols on the same device key.
   * Convention: reserve `argus-*` prefix for Argus flows.
   */
  purpose: string;
  /** Caller-supplied JSON-serializable payload. Signed verbatim. */
  payload?: unknown;
  /** TTL in seconds; clamped server-side to [1, 300]. Default 60. */
  ttlSeconds?: number;
}

/** The signed attestation returned inside RunResult.attestation. */
interface Attestation {
  /** base64url-encoded envelope JSON ({v, purpose, payload, iat, exp, keyId}). */
  envelope: string;
  /** base64-encoded ECDSA-P256-SHA-256 signature over the envelope bytes. */
  signature: string;
  /** base64-encoded SPKI public key. */
  publicKey: string;
  /** Short fingerprint of the public key — useful for cross-assertion matching. */
  keyId: string;
}

/** Options passed to window.argus.run(). */
interface RunOptions {
  /** Merchant-provided correlation id, round-tripped back on completion. */
  sessionId?: string;
  /**
   * Public client id (cpi) issued to the merchant by ms-argus-platform —
   * shape `argus_cpi_(test|live)_<...>`. When supplied, the iframe sends it
   * as `x-argus-cpi` on the integrity-collect POST so the server partitions
   * the resulting record under (cpi, session_id). Omitting it routes to the
   * shared "unbound" partition (legacy behavior, deprecated).
   */
  cpi?: string;
  /** Milliseconds to wait before rejecting the returned Promise. 0 disables. Default 10000. */
  timeoutMs?: number;
  /**
   * If set, the iframe builds a signed assertion alongside the integrity
   * scan and returns it on result.attestation. Cheap — uses the same
   * keypair the SDK already maintains for integrity-collect signing.
   */
  attest?: AttestRequest;
  /**
   * Merchant-supplied page URL — used when the SDK runs inside a
   * cross-origin iframe (Shopify Checkout, embedded checkouts, etc.)
   * where `window.top.location.href` is blocked by the browser. The
   * merchant's loader call runs in *their* frame, so `window.location.href`
   * there is the real page. Forward it explicitly:
   *
   *   argus.run({ cpi, page: window.location.href })
   *
   * The server also captures HTTP `Origin` + `Referer` headers and the
   * iframe's own ancestorOrigins/referrer, so this is one input among
   * several. Mismatches between merchant-supplied and browser-attested
   * origin are surfaced as a sigint signal (catches SDK theft / unauthorised
   * embedding). Optional — best-effort auto-capture falls back when absent.
   */
  page?: string;
  /** Merchant-supplied page title (`document.title` in their frame).
   *  Optional; useful for support tooling. Truncated to 256 chars. */
  pageTitle?: string;
}

/** Resolved value from a successful run. */
interface RunResult {
  /** Merchant-supplied session id echoed back (null if not supplied). */
  sessionId: string | null;
  /** Argus-assigned session id from the iframe's submission. */
  argusSessionId: string;
  /** Run duration from Promise construction to result in ms. */
  durationMs: number;
  /**
   * Signed assertion if `opts.attest` was supplied. Null if not requested,
   * undefined if requested but signing failed (see attestError).
   */
  attestation?: Attestation | null;
  /** Error message if attestation was requested but signing failed. */
  attestError?: string | null;
}

interface LoaderState {
  running: boolean;
  lastRunId: string | null;
}

interface PendingRun {
  runId: string;
  iframe: HTMLIFrameElement;
  resolve: (r: RunResult) => void;
  reject: (e: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  /**
   * Private MessagePort the iframe replies on. The corresponding port2 is
   * transferred to the iframe at load time. The reference here is held in
   * a closure and never exposed to the DOM or to window, so a parent-realm
   * forger cannot acquire a handle on it to spoof a reply.
   */
  port: MessagePort;
  startMs: number;
  sessionId: string | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const IFRAME_MARK = 'data-argus-loader';
declare const __ARGUS_IFRAME_INTEGRITY__: string | undefined;
declare const __ARGUS_IFRAME_FILENAME__: string | undefined;
const IFRAME_INTEGRITY =
  typeof __ARGUS_IFRAME_INTEGRITY__ === 'string'
    ? __ARGUS_IFRAME_INTEGRITY__
    : '';
const IFRAME_FILENAME =
  typeof __ARGUS_IFRAME_FILENAME__ === 'string'
    ? __ARGUS_IFRAME_FILENAME__
    : 'argus-integrity-iframe.iife.js';

// Applied as an inline style attribute on iframe creation. Off-screen
// absolute positioning rather than the opacity:0/1×1 pattern:
//   - 100×100 is big enough that browsers won't throttle it as "negligible"
//     render surface (affects Canvas/WebGL/IntersectionObserver behavior).
//   - top/left: -5000px puts it off-viewport. Never visible to the user,
//     pointer-events irrelevant.
//   - Inline styles win specificity against any merchant CSS without
//     needing !important everywhere.
//   - Matches Signifyd's production loader pattern; avoids the Oak-style
//     1×1+opacity tricks that can trip both browser optimizers and
//     anti-tracking heuristics.
const HIDDEN_STYLE =
  'position:absolute;top:-5000px;left:-5000px;width:100px;height:100px;border:0';

let pending: PendingRun | null = null;
const state: LoaderState = { running: false, lastRunId: null };

// Captured synchronously at parse time — document.currentScript is only
// valid during synchronous execution of the script tag.
const loaderScript =
  (document.currentScript as HTMLScriptElement | null) ?? null;
const loaderSrc = loaderScript?.src ?? '';
const loaderLocation = (() => {
  if (!loaderSrc) return null;
  try {
    const url = new URL(loaderSrc);
    const basePath = url.pathname.replace(/\/[^/]*$/, '');
    return { origin: url.origin, basePath };
  } catch {
    return null;
  }
})();

function killExistingIframes(): void {
  document
    .querySelectorAll(`iframe[${IFRAME_MARK}]`)
    .forEach((el) => el.remove());
}

/** Auto-capture page URL from `window.top.location.href` if same-origin.
 *  Cross-origin parents throw SecurityError → caller falls back. */
function captureTopUrlIfAccessible(): string {
  try {
    return window.top?.location?.href ?? '';
  } catch {
    /* cross-origin parent — caller falls back to merchant-supplied page */
  }
  return '';
}

/** Auto-capture additional frame context that's cross-origin-safe even
 *  when the SDK is iframed by a different-origin embedder. */
function captureFrameContext(): {
  /** True if the SDK loader is running in the top frame (window.top === window). */
  isTop: boolean;
  /** Document.referrer — usually the embedder's URL (policy-dependent). */
  referrer: string;
  /** location.ancestorOrigins chain (Chrome / Safari). Empty in Firefox. */
  ancestorOrigins: string[];
} {
  const isTop = window.top === window.self;
  const referrer = (() => {
    try {
      return document.referrer ?? '';
    } catch {
      return '';
    }
  })();
  const ancestorOrigins: string[] = [];
  try {
    const list = (
      window.location as Location & { ancestorOrigins?: DOMStringList }
    ).ancestorOrigins;
    if (list && typeof list.length === 'number') {
      for (let i = 0; i < list.length && i < 8; i++) {
        const o = list.item(i);
        if (typeof o === 'string') ancestorOrigins.push(o);
      }
    }
  } catch {
    /* Firefox lacks ancestorOrigins → list stays empty */
  }
  return { isTop, referrer, ancestorOrigins };
}

const MAX_PAGE_URL_LEN = 2048;
const MAX_PAGE_TITLE_LEN = 256;

function clamp(s: string | undefined, max: number): string {
  if (typeof s !== 'string' || s.length === 0) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function generateRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

function b64urlEncodeJson(v: unknown): string {
  const json = JSON.stringify(v);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function innerScriptUrl(
  runId: string,
  sessionId: string | null,
  cpi: string | null,
  attest: AttestRequest | null,
  page: {
    pageUrl: string;
    pageTitle: string;
    pageSource: 'merchant' | 'auto' | 'unknown';
    referrer: string;
    isTop: boolean;
    ancestorOrigins: string[];
  },
): string {
  if (!loaderLocation) {
    throw new Error('argus: unable to resolve loader script origin');
  }
  const url = new URL(
    `${loaderLocation.basePath}/${IFRAME_FILENAME}`,
    loaderLocation.origin,
  );
  const q = url.searchParams;
  q.set('runId', runId);
  if (sessionId) q.set('sessionId', sessionId);
  if (cpi) q.set('cpi', cpi);
  if (attest) {
    q.set('attestPurpose', attest.purpose);
    if (attest.payload !== undefined) {
      q.set('attestPayload', b64urlEncodeJson(attest.payload));
    }
    if (typeof attest.ttlSeconds === 'number') {
      q.set('attestTtl', String(attest.ttlSeconds));
    }
  }
  if (page.pageUrl) q.set('pageUrl', page.pageUrl);
  if (page.pageTitle) q.set('pageTitle', page.pageTitle);
  if (page.pageSource && page.pageSource !== 'unknown') {
    q.set('pageSource', page.pageSource);
  }
  if (page.referrer) q.set('referrer', page.referrer);
  q.set('isTop', page.isTop ? '1' : '0');
  if (page.ancestorOrigins.length > 0) {
    // newline-joined keeps it URL-safe after encodeURIComponent and
    // avoids comma collision if any origin ever embeds a comma (it can't
    // per RFC, but defensive).
    q.set('ancestorOrigins', page.ancestorOrigins.join('\n'));
  }
  return url.toString();
}

function clearPending(): PendingRun | null {
  if (!pending) return null;
  const p = pending;
  try {
    p.port.close();
  } catch {
    /* already closed */
  }
  if (p.timeoutHandle) clearTimeout(p.timeoutHandle);
  try {
    p.iframe.remove();
  } catch {
    /* already detached */
  }
  pending = null;
  state.running = false;
  return p;
}

function rejectPending(reason: string): void {
  const p = clearPending();
  if (p) p.reject(new Error(`argus: ${reason}`));
}

function resolvePending(data: {
  argusSessionId?: string;
  attestation?: Attestation | null;
  attestError?: string | null;
}): void {
  const p = clearPending();
  if (!p) return;
  p.resolve({
    sessionId: p.sessionId,
    argusSessionId: data.argusSessionId ?? '',
    durationMs: performance.now() - p.startMs,
    attestation: data.attestation ?? null,
    attestError: data.attestError ?? null,
  });
}

// The srcdoc HTML pre-arms a message listener BEFORE any inner script
// loads. The listener captures the MessagePort the loader transfers in
// at iframe-load time and buffers any postBack calls the iframe makes
// before the port arrives. The iframe-side bundle then uses
// `window.__argusPostBack(msg)` instead of `window.parent.postMessage`,
// which means replies travel through a private port the parent realm
// has no handle on — forging a reply from the parent realm now requires
// holding port1, which never leaves the loader's closure.
const SRCDOC_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
  '(function(){var port=null;var buf=[];' +
  'window.__argusPostBack=function(m){if(port){try{port.postMessage(m)}catch(e){}}else{buf.push(m)}};' +
  'window.addEventListener("message",function on(e){' +
  'if(e&&e.data&&e.data.argusInit===true&&e.ports&&e.ports[0]){' +
  'window.removeEventListener("message",on);' +
  'port=e.ports[0];' +
  'while(buf.length){try{port.postMessage(buf.shift())}catch(_){}}' +
  '}});' +
  '})();</script></body></html>';

function createIframe(
  port2: MessagePort,
  innerUrl: string,
  onScriptError: () => void,
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  // Marker is presence-only so killExistingIframes can clean up strays.
  // We deliberately do NOT serialize the runId here — putting it on a DOM
  // attribute lets any same-page script read it and forge a reply.
  iframe.setAttribute(IFRAME_MARK, '');
  iframe.setAttribute('style', HIDDEN_STYLE);
  iframe.setAttribute('title', 'Fraud prevention analytics');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('role', 'presentation');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('srcdoc', SRCDOC_HTML);

  iframe.addEventListener(
    'load',
    () => {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) {
        rejectPending('iframe contentDocument unavailable');
        return;
      }
      // Transfer port2 to the iframe. The srcdoc pre-armed listener
      // captures it; the inner script then sends results through it.
      try {
        win.postMessage({ argusInit: true }, '*', [port2]);
      } catch {
        rejectPending('argusInit transfer failed');
        return;
      }
      const s = doc.createElement('script');
      s.src = innerUrl;
      s.integrity = IFRAME_INTEGRITY;
      s.crossOrigin = 'anonymous';
      s.onerror = onScriptError;
      doc.body.appendChild(s);
    },
    { once: true },
  );

  (document.body ?? document.documentElement).appendChild(iframe);
  return iframe;
}

function run(opts: RunOptions = {}): Promise<RunResult> {
  if (!loaderLocation) {
    return Promise.reject(new Error('argus: loader origin unknown'));
  }
  if (!IFRAME_INTEGRITY) {
    return Promise.reject(new Error('argus: iframe_integrity_missing'));
  }

  // Supersede any in-flight run + purge stray iframes from prior broken runs.
  if (pending) rejectPending('superseded by new run');
  killExistingIframes();

  const runId = generateRunId();
  const sessionId = opts.sessionId ?? null;
  const cpi =
    typeof opts.cpi === 'string' && opts.cpi.length > 0 ? opts.cpi : null;
  const timeoutMs =
    typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const attest =
    opts.attest && typeof opts.attest.purpose === 'string' ? opts.attest : null;

  // Page URL resolution. Prefer the merchant-supplied value — it works
  // even when the SDK is iframed by a cross-origin embedder (Shopify
  // Checkout Extensibility etc.) where window.top.location.href throws.
  // Auto-capture is the fallback for top-frame deployments.
  const merchantPage = clamp(opts.page, MAX_PAGE_URL_LEN);
  const autoPage = captureTopUrlIfAccessible();
  let pageUrl: string;
  let pageSource: 'merchant' | 'auto' | 'unknown';
  if (merchantPage) {
    pageUrl = merchantPage;
    pageSource = 'merchant';
  } else if (autoPage) {
    pageUrl = clamp(autoPage, MAX_PAGE_URL_LEN);
    pageSource = 'auto';
  } else {
    pageUrl = '';
    pageSource = 'unknown';
  }
  const frame = captureFrameContext();

  let innerUrl: string;
  try {
    innerUrl = innerScriptUrl(runId, sessionId, cpi, attest, {
      pageUrl,
      pageTitle: clamp(opts.pageTitle, MAX_PAGE_TITLE_LEN),
      pageSource,
      referrer: clamp(frame.referrer, MAX_PAGE_URL_LEN),
      isTop: frame.isTop,
      ancestorOrigins: frame.ancestorOrigins,
    });
  } catch (err) {
    return Promise.reject(err as Error);
  }

  const cdnOrigin = loaderLocation.origin;

  return new Promise<RunResult>((resolve, reject) => {
    // Private channel: port1 lives in this closure forever, port2 is
    // transferred to the iframe on load. Replies arrive on port1.
    // A forger in the parent realm cannot send messages here without
    // holding port1, and port1 is never exposed.
    const channel = new MessageChannel();
    const { port1, port2 } = channel;

    port1.onmessage = (ev: MessageEvent): void => {
      const data = ev.data as Record<string, unknown> | null | undefined;
      if (!data || typeof data !== 'object') return;
      if (data.argusDone === true) {
        const result = (data.result ?? {}) as {
          argusSessionId?: string;
          attestation?: Attestation | null;
          attestError?: string | null;
        };
        resolvePending(result);
      } else if (data.argusDone === false) {
        const errMsg =
          typeof data.error === 'string' ? data.error : 'unknown error';
        rejectPending(`inner: ${errMsg}`);
      }
    };
    port1.start();

    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(
            () => rejectPending(`timeout after ${timeoutMs}ms`),
            timeoutMs,
          )
        : null;

    let iframe: HTMLIFrameElement;
    try {
      iframe = createIframe(port2, innerUrl, () =>
        rejectPending('inner script load failed'),
      );
    } catch (err) {
      try {
        port1.close();
      } catch {
        /* noop */
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err as Error);
      return;
    }

    pending = {
      runId,
      iframe,
      resolve,
      reject,
      timeoutHandle,
      port: port1,
      startMs: performance.now(),
      sessionId,
    };
    state.running = true;
    state.lastRunId = runId;

    // Unused var guard for cdnOrigin — left in case we later tighten message
    // origin matching (requires inner script to set targetOrigin correctly).
    void cdnOrigin;
  });
}

function destroy(): void {
  if (pending) rejectPending('destroyed');
  killExistingIframes();
}

interface ArgusGlobal {
  run(opts?: RunOptions): Promise<RunResult>;
  destroy(): void;
  _state: LoaderState;
  /**
   * Convenience wrapper — runs a full integrity scan and returns just
   * the device's persistent public key + keyId. Triggers a full run()
   * (the keypair is held inside the integrity iframe), so callers who
   * also want the integrity scan result should call `run()` directly
   * instead of this method.
   */
  getDevicePublicKey(): Promise<{ publicKey: string; keyId: string }>;
  /**
   * Convenience wrapper — runs a full integrity scan and signs a
   * structured assertion with the device's persistent keypair. Equivalent
   * to `run({ attest: opts }).then(r => r.attestation)`, but discards the
   * integrity scan id. Use `run({ attest: ... })` directly if you also
   * need the integrity scan result.
   */
  signAssertion(opts: AttestRequest): Promise<Attestation>;
}

/**
 * Auto-run scheduling mode. Controls when an auto-run-tagged loader fires
 * its first run() relative to the parent page lifecycle.
 *
 *   immediate    sync at script parse time (legacy)
 *   load         on window 'load' event (or right away if already loaded)
 *   idle         after load + requestIdleCallback (DEFAULT — safe for perf)
 *   interaction  first user pointerdown/keydown/scroll/touchstart
 */
type ScheduleMode = 'immediate' | 'load' | 'idle' | 'interaction';

const VALID_MODES: ReadonlyArray<ScheduleMode> = [
  'immediate',
  'load',
  'idle',
  'interaction',
];

function readScheduleMode(script: HTMLScriptElement | null): ScheduleMode {
  const raw = script?.getAttribute('data-on')?.toLowerCase();
  if (raw && (VALID_MODES as ReadonlyArray<string>).includes(raw)) {
    return raw as ScheduleMode;
  }
  return 'idle';
}

function onLoadOrNow(cb: () => void): void {
  if (document.readyState === 'complete') {
    cb();
  } else {
    window.addEventListener('load', cb, { once: true });
  }
}

function scheduleAutoRun(mode: ScheduleMode, fire: () => void): void {
  if (mode === 'immediate') {
    fire();
    return;
  }
  if (mode === 'load') {
    onLoadOrNow(fire);
    return;
  }
  if (mode === 'idle') {
    const ric =
      (
        window as unknown as {
          requestIdleCallback?: (
            cb: () => void,
            opts?: { timeout: number },
          ) => number;
        }
      ).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1));
    onLoadOrNow(() => ric(fire, { timeout: 5000 }));
    return;
  }
  // interaction
  const events: ReadonlyArray<keyof WindowEventMap> = [
    'pointerdown',
    'keydown',
    'scroll',
    'touchstart',
  ];
  const trigger = (): void => {
    events.forEach((e) => window.removeEventListener(e, trigger));
    fire();
  };
  events.forEach((e) =>
    window.addEventListener(e, trigger, { once: true, passive: true }),
  );
}

async function getDevicePublicKey(): Promise<{
  publicKey: string;
  keyId: string;
}> {
  // Spin a minimal run() solely to extract the pubkey. Caller probably
  // wants run() directly if they also want the integrity scan; this is
  // here for completeness so the "get my device public key" use case has
  // a clear surface.
  const result = await run({
    attest: { purpose: 'argus-pubkey-export-v1', ttlSeconds: 1 },
  });
  if (!result.attestation) {
    throw new Error(
      `argus: getDevicePublicKey failed: ${result.attestError ?? 'no attestation returned'}`,
    );
  }
  return {
    publicKey: result.attestation.publicKey,
    keyId: result.attestation.keyId,
  };
}

async function signAssertion(opts: AttestRequest): Promise<Attestation> {
  const result = await run({ attest: opts });
  if (!result.attestation) {
    throw new Error(
      `argus: signAssertion failed: ${result.attestError ?? 'no attestation returned'}`,
    );
  }
  return result.attestation;
}

const argus: ArgusGlobal = {
  run,
  destroy,
  _state: state,
  getDevicePublicKey,
  signAssertion,
};

const win = window as unknown as Record<string, unknown>;
if (win.argus) {
  // Double-load. Don't overwrite — the first loader may already have in-flight
  // runs with message listeners bound to its closure. Fail loud.
  console.error(
    '[argus-loader] window.argus already defined — double-load detected',
  );
} else {
  win.argus = argus;

  if (loaderScript?.hasAttribute('data-auto-run')) {
    const sessionId = loaderScript.getAttribute('data-session-id') ?? undefined;
    const cpi = loaderScript.getAttribute('data-cpi') ?? undefined;
    const timeoutAttr = loaderScript.getAttribute('data-timeout-ms');
    const timeoutMs = timeoutAttr ? parseInt(timeoutAttr, 10) : undefined;
    const mode = readScheduleMode(loaderScript);
    const fire = (): void => {
      run({ sessionId, cpi, timeoutMs }).catch((err) => {
        console.error('[argus-loader] auto-run failed:', err);
      });
    };
    scheduleAutoRun(mode, fire);
  }
}
