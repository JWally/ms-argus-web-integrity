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
}

/** Resolved value from a successful run. */
interface RunResult {
  /** Merchant-supplied session id echoed back (null if not supplied). */
  sessionId: string | null;
  /** Argus-assigned session id from the iframe's submission. */
  argusSessionId: string;
  /** Run duration from Promise construction to result in ms. */
  durationMs: number;
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
  messageHandler: (ev: MessageEvent) => void;
  startMs: number;
  sessionId: string | null;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const IFRAME_MARK = 'data-argus-loader';

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

function capturePageUrl(): string {
  try {
    return window.top?.location?.href ?? '';
  } catch {
    /* cross-origin parent */
  }
  return '';
}

function generateRunId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

function innerScriptUrl(
  runId: string,
  sessionId: string | null,
  cpi: string | null,
  opts: { pageUrl: string; referrer: string },
): string {
  if (!loaderLocation) {
    throw new Error('argus: unable to resolve loader script origin');
  }
  const url = new URL(
    `${loaderLocation.basePath}/argus-integrity-iframe.iife.js`,
    loaderLocation.origin,
  );
  const q = url.searchParams;
  q.set('runId', runId);
  if (sessionId) q.set('sessionId', sessionId);
  if (cpi) q.set('cpi', cpi);
  if (opts.pageUrl) q.set('pageUrl', opts.pageUrl);
  if (opts.referrer) q.set('referrer', opts.referrer);
  return url.toString();
}

function clearPending(): PendingRun | null {
  if (!pending) return null;
  const p = pending;
  window.removeEventListener('message', p.messageHandler);
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

function resolvePending(data: { argusSessionId?: string }): void {
  const p = clearPending();
  if (!p) return;
  p.resolve({
    sessionId: p.sessionId,
    argusSessionId: data.argusSessionId ?? '',
    durationMs: performance.now() - p.startMs,
  });
}

function createIframe(
  runId: string,
  innerUrl: string,
  onScriptError: () => void,
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.setAttribute(IFRAME_MARK, runId);
  iframe.setAttribute('style', HIDDEN_STYLE);
  iframe.setAttribute('title', 'Fraud prevention analytics');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('role', 'presentation');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute(
    'srcdoc',
    '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
  );

  iframe.addEventListener(
    'load',
    () => {
      const doc = iframe.contentDocument;
      if (!doc) {
        rejectPending('iframe contentDocument unavailable');
        return;
      }
      const s = doc.createElement('script');
      s.src = innerUrl;
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

  // Supersede any in-flight run + purge stray iframes from prior broken runs.
  if (pending) rejectPending('superseded by new run');
  killExistingIframes();

  const runId = generateRunId();
  const sessionId = opts.sessionId ?? null;
  const cpi =
    typeof opts.cpi === 'string' && opts.cpi.length > 0 ? opts.cpi : null;
  const timeoutMs =
    typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const pageUrl = capturePageUrl();
  const referrer = document.referrer ?? '';

  let innerUrl: string;
  try {
    innerUrl = innerScriptUrl(runId, sessionId, cpi, { pageUrl, referrer });
  } catch (err) {
    return Promise.reject(err as Error);
  }

  const cdnOrigin = loaderLocation.origin;

  return new Promise<RunResult>((resolve, reject) => {
    const messageHandler = (ev: MessageEvent): void => {
      // srcdoc iframe inherits parent's origin for postMessage purposes, so
      // ev.origin will be the merchant page origin — NOT our CDN origin.
      // Match on runId + shape instead, which is tamper-resistant enough for
      // this purpose (runId is a UUID the merchant page can't guess).
      const data = ev.data as Record<string, unknown> | null | undefined;
      if (!data || typeof data !== 'object') return;
      if (data.runId !== runId) return;
      if (data.argusDone === true) {
        const result = (data.result ?? {}) as { argusSessionId?: string };
        resolvePending(result);
      } else if (data.argusDone === false) {
        const errMsg =
          typeof data.error === 'string' ? data.error : 'unknown error';
        rejectPending(`inner: ${errMsg}`);
      }
    };

    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(
            () => rejectPending(`timeout after ${timeoutMs}ms`),
            timeoutMs,
          )
        : null;

    window.addEventListener('message', messageHandler);

    let iframe: HTMLIFrameElement;
    try {
      iframe = createIframe(runId, innerUrl, () =>
        rejectPending('inner script load failed'),
      );
    } catch (err) {
      window.removeEventListener('message', messageHandler);
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
      messageHandler,
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

const argus: ArgusGlobal = { run, destroy, _state: state };

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
