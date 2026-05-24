/**
 * Headless Browser Detection Types
 */

/**
 * Soft signals suggesting headless operation.
 * Any single signal is inconclusive — weight combinations server-side.
 */
export interface LikeHeadlessSignals {
  /** IS_BLINK && window.chrome missing — headless often lacks the chrome global */
  noChrome: boolean;
  /** permissions.query('notifications') = prompt but Notification.permission = denied */
  hasPermissionsBug: boolean;
  /** IS_BLINK && navigator.plugins.length === 0 — real Chrome has at least PDF viewer */
  noPlugins: boolean;
  /** IS_BLINK && navigator.mimeTypes empty — real browsers register MIME handlers */
  noMimeTypes: boolean;
  /** IS_BLINK && Notification.permission === 'denied' — headless blocks notifications */
  notificationIsDenied: boolean;
  /** userAgentData.platform is empty — incomplete UA-CH implementation */
  uaDataIsBlank: boolean;
  /** navigator.pdfViewerEnabled === false — Chrome's built-in PDF viewer disabled */
  pdfIsDisabled: boolean;
  /** screen.width === screen.availWidth && screen.height === screen.availHeight — no taskbar */
  noTaskbar: boolean;
  /** viewport exactly matches screen dimensions — configured virtual display */
  hasVvpScreenRes: boolean;
  /**
   * Software renderer detected in WebGL renderer string.
   * Covers: SwiftShader (old + new headless), llvmpipe (Linux Mesa),
   * VMware SVGA, Microsoft Basic Render Driver.
   * NOTE: New headless Chrome on a real GPU uses the real renderer — this
   * only fires on machines without GPU pass-through.
   */
  hasSoftwareRenderer: boolean;
  /** DevTools window size heuristic or Firebug detected */
  devToolsOpen: boolean;
}

/**
 * Hard headless indicators — any true value is strong evidence of automation.
 */
export interface HeadlessSignals {
  /** navigator.webdriver === true, or undefined on modern Chrome (should be false), or lieProps tampered */
  webDriverIsOn: boolean;
  /** "HeadlessChrome" in navigator.userAgent or navigator.appVersion */
  hasHeadlessUA: boolean;
  /** "HeadlessChrome" in worker userAgent — stealth tools often miss the worker context */
  hasHeadlessWorkerUA: boolean;
}

/**
 * Stealth plugin / evasion tool signals.
 * These indicate intentional bot detection bypass attempts.
 */
export interface StealthSignals {
  /** iframe.contentWindow accessible before DOM insertion — proxied iframe creation */
  hasIframeProxy: boolean;
  /** chrome object appears in last 50 window properties — added after page load by stealth plugin */
  hasHighChromeIndex: boolean;
  /** chrome.runtime.sendMessage/connect has prototype or is constructable — fake runtime */
  hasBadChromeRuntime: boolean;
  /** Function.toString has been patched — lieProps detection */
  hasToStringProxy: boolean;
  /** WebGL renderer differs between main thread and worker — selective GPU spoofing */
  hasBadWebGL: boolean;
  /**
   * chrome exists but chrome.loadTimes is missing.
   * Real Chrome always has chrome.loadTimes (deprecated but present).
   * Stealth plugins add window.chrome but routinely omit this.
   *
   * SERVER-SIDE NOTE: chrome.loadTimes is deprecated — validate against
   * the Chrome version before treating absence as a hard signal. If Google
   * removes it, this will fire for all real Chrome users.
   */
  missingLoadTimes: boolean;
  /**
   * chrome exists but chrome.csi is missing.
   * Same pattern as missingLoadTimes — deprecated but always present in real Chrome.
   *
   * SERVER-SIDE NOTE: same caveat as missingLoadTimes re: deprecation.
   */
  missingCsi: boolean;
  /**
   * chrome exists but chrome.app surface is incomplete.
   * Real Chrome always has chrome.app.isInstalled, getDetails, runningState.
   * Stealth plugins that add chrome.runtime typically skip chrome.app.
   *
   * SERVER-SIDE NOTE: chrome.app is tied to deprecated Chrome Apps API.
   * Validate against Chrome version — removal would invert this signal.
   */
  incompleteAppSurface: boolean;
}

/**
 * Console-serialization timing — CDP attach detector.
 *
 * When a CDP client is attached and `Runtime.enable` has been issued,
 * Chrome serializes every console.* argument over the wire. The cost
 * scales with structural complexity, so a deep object is much slower
 * to log than a 1-byte string. Without CDP, both are dropped at the
 * same near-zero cost.
 *
 * `heavy_over_tiny` is the headline ratio (≳2 under CDP, ≈1 without).
 * Absolute fields are kept for telemetry/threshold tuning.
 *
 * Blink-only — Gecko/WebKit use different debugger protocols.
 */
export interface ConsoleTiming {
  /** µs/call for `console.log("a")` over 1000 calls. */
  log_tiny_us: number;
  /** µs/call for `console.log(heavyObject)` over 1000 calls. */
  log_heavy_us: number;
  /** µs/call for `console.dir(heavyObject)` over 1000 calls. */
  dir_heavy_us: number;
  /** log_heavy_us / log_tiny_us. ≳2 under CDP, ≈1 without. */
  heavy_over_tiny: number;
  /**
   * Same `log_heavy` loop measured with `Date.now()` — a second clock
   * on a completely different prototype chain (static method on the
   * Date constructor). Real browsers: this agrees with `log_heavy_us`
   * to within milliseconds. An attacker who patches only
   * `Performance.prototype.now` (every red-team round to date) leaves
   * this clock untouched → `tl_heavy_us` reflects real wall time
   * while `log_heavy_us` reflects the attacker's counter. The
   * disagreement is the tell.
   *
   * Note: field is named `tl_heavy_us` for backward compat with the
   * initial deploy that used `DocumentTimeline.currentTime`. Renamed
   * to use `Date.now()` instead because the timeline only advances
   * per animation frame — both reads inside a synchronous loop
   * returned the same value (delta = 0).
   */
  tl_heavy_us: number;
  /**
   * Hardware anchor: µs/iter of a Math-only loop (Math.sqrt + Math.sin)
   * over 5000 iterations. CDP's `Runtime.consoleAPICalled` does not
   * intercept Math intrinsics, so this number reflects pure V8/CPU
   * throughput — a value the attacker can't predict from the timing
   * fields alone. Server cross-checks: a stubbed bench that reports
   * believable `log_*_us` must also pick a `math_loop_us` consistent
   * with the device's `hardwareConcurrency` × `deviceMemory` ×
   * historical timing distribution. The ratio `log_tiny_us /
   * math_loop_us` has a hardware-independent floor.
   *
   * Optional because the original iframe bench predates the field —
   * older clients submit `ConsoleTiming` without it. Treat absence
   * as "couldn't measure", not "passed".
   */
  math_loop_us?: number;
  /**
   * `Performance.prototype.now` toStrings as `[native code]` in the
   * bench iframe's realm. False = an attacker has replaced the
   * timing oracle the bench depends on. Catches the v4-class bypass
   * that the lie scanner can't reach (Performance is not in
   * `API_SEARCH_TARGETS`).
   */
  perf_now_native: boolean;
  /**
   * `Date.now` toStrings as `[native code]`. Date.now is a static
   * method on the Date constructor and is structurally unreachable
   * by the prototype-walking lie scanner. This is the only place
   * it's verified.
   */
  date_now_native: boolean;
  /**
   * `console.log` is native in the bench iframe. The bench's signal
   * IS the cost of `con.log(...)` — a no-op replacement makes the
   * measurement meaningless. The broad lie scanner covers `console`,
   * but this is the bench-local source of truth.
   */
  con_log_native: boolean;
  /** `console.dir` is native in the bench iframe. */
  con_dir_native: boolean;
  /**
   * Count of `console.*` methods detected as wrapped/patched in the
   * bench realm. Only the worker bench populates this field — it's
   * the new home for the v3-closure scan after `console` was removed
   * from the main-thread lie scanner (which false-positived on
   * CriOS's Google-iOS analytics shim, see `src/lies/constants.ts`).
   *
   * Probes `log`, `warn`, `error`, `info`, `debug`, `dir`. Each method
   * is tested for native shape (`Function.prototype.toString` matches
   * `[native code]`), absence of an own `prototype` property, and
   * non-constructability (`new method()` throws TypeError). A method
   * failing any probe counts as 1 lie — collapsed to one-per-method
   * rather than the eleven-per-method explosion that broke CriOS.
   *
   * - 0 — all probed methods native in the bench realm
   * - 1-6 — one or more methods wrapped (in the worker realm, this
   *   is direct evidence of attacker-injected source via wrapped
   *   `Worker` / `Blob` / `URL.createObjectURL` — not legitimate
   *   extension or app-shim activity, since workers are out of those
   *   reach paths)
   *
   * Optional because the iframe bench predates the field and older
   * SDK builds don't emit it. Treat absence as "no probe ran."
   */
  console_lies?: number;
  /**
   * Heavy loop measured with `+new Date()`. Routes through the Date
   * constructor (V8 `DateConstructor::Construct`), NOT `Date.now`.
   *
   * v7 closure clock. The v7 attack (2026-05-19) wraps both
   * `Performance.prototype.now` and `Date.now` in lockstep Proxies,
   * making `log_heavy_us` and `tl_heavy_us` both report ~0 under
   * attack. `+new Date()` is on a different code path and v7 leaves
   * it untouched — empirically validated 2026-05-22 in
   * `~/Dev/tmp/timer-experiment` (`newDateValueOf` agrees with truth
   * 1.008× under v7 attack, while `dateNow` reads 0).
   *
   * Server check: `abs(wall_heavy_us - log_heavy_us) > ~2µs/call`
   * (≈2ms across the loop) is v7-class clock tampering. Real
   * browsers agree to clock resolution.
   *
   * Optional: older SDK builds don't emit it.
   */
  wall_heavy_us?: number;
  /**
   * Heavy loop measured via `performance.measure(start, end).duration`.
   * The marks capture wall time in C++ at `performance.mark()` call;
   * `.duration` computes from those captured values and does NOT
   * re-read `performance.now()` at query time.
   *
   * Second v7-bypassing clock. Empirically validated 2026-05-22
   * (`perfMeasureDuration` agrees with truth 1.0015× under v7
   * attack). Redundant with `wall_heavy_us` but on a different
   * surface — a v8-class attacker would have to patch BOTH the Date
   * constructor AND `performance.mark`/`performance.measure` to hide.
   *
   * Optional: older SDK builds don't emit it.
   */
  measure_heavy_us?: number;
}

/**
 * CDP / automation framework detection signals.
 */
export interface CdpSignals {
  /** ChromeDriver $cdc_ globals on document */
  cdcGlobals: boolean;
  /** Playwright __pw_ bindings on window */
  pwBindings: boolean;
  /** navigator.webdriver differs between main frame and phantom iframe */
  phantomMismatch: boolean;
  /** Bot-injected globals matching known patterns (max 5) */
  clientLitter: string[];
  /** Known automation framework globals found */
  automationGlobals: string[];
  /** APIs where cross-realm toString disagrees with main frame — addInitScript patching */
  crossRealmTampered: string[];
  /** Console-serialization timing bench. Absent on non-Blink. */
  consoleTiming?: ConsoleTiming;
  /**
   * Same bench as `consoleTiming`, but run in a dedicated Worker spawned
   * via blob URL. The worker realm is unreachable by main-thread Proxy
   * patches and the blob URL is not interceptable by `page.route`
   * (browser-internal scheme). Together with the iframe bench, the two
   * fields cross-validate: a stub-the-function attack on either path
   * leaves the other intact and the disagreement is the tell.
   *
   * Absent when:
   *   - non-Blink (same as `consoleTiming`)
   *   - merchant CSP blocks blob workers (`worker-src 'none'` or
   *     similar) — falls back to iframe bench only
   *   - worker timeout (1500ms) — under CDP the heavy loop can take
   *     ~60ms but worker spawn + bench should finish well inside this
   */
  consoleTimingWorker?: ConsoleTiming;
  /**
   * `Object.getOwnPropertyNames` toStrings as `[native code]`. False
   * means the enumeration primitive that `cdcGlobals` / `pwBindings`
   * / `clientLitter` / `automationGlobals` all depend on has been
   * replaced — those four signals' negative results can't be trusted.
   * Analyzer treats false as hard-residue evidence on its own.
   */
  ownPropsNative: boolean;
  /**
   * isTrusted event probe (fpjs s165). Dispatches a synthetic event
   * via `dispatchEvent`, captures `event.isTrusted` in the handler.
   *   - `value: false` → expected for a real browser; script-dispatched
   *     events are always untrusted.
   *   - `value: true` → automation tooling is lying about isTrusted
   *     (CDP-driven Input.dispatchMouseEvent yields true; some stealth
   *     scripts patch Event.prototype incorrectly).
   *   - `value: null` (with threw=false) → handler never fired; weird
   *     event-system state.
   *   - `threw: true` → environment lacks Event constructor or DOM.
   */
  isTrustedProbe: { value: boolean | null; threw: boolean };
}

export type PlatformScores = Record<string, number>;

export interface HeadlessDetectionInputs {
  webgl?: {
    parameters?: {
      UNMASKED_RENDERER_WEBGL?: string;
    };
  };
  workerScope?: {
    userAgent?: string;
    webglRenderer?: string;
  };
}

/**
 * Complete headless detection result.
 */
export interface HeadlessFingerprint {
  /** Chromium-based browser */
  chromium: boolean;
  /** Soft headless indicators */
  likeHeadless: LikeHeadlessSignals;
  /** Hard headless indicators */
  headless: HeadlessSignals;
  /** Stealth/evasion signals */
  stealth: StealthSignals;
  /** CDP / automation framework signals */
  cdp: CdpSignals;
  /** % of likeHeadless signals that are true */
  likeHeadlessRating: number;
  /** % of headless signals that are true */
  headlessRating: number;
  /** % of stealth signals that are true */
  stealthRating: number;
  /** Resolved CSS system font string — OS inference (Gecko only; Blink returns generic names) */
  systemFonts: string;
  /** Platform feature confidence scores */
  platformEstimate: [PlatformScores, number];
  /**
   * Raw history.length value.
   *
   * SERVER-SIDE: flag === 1 in context of referrer chain, navigation timing,
   * and session data. Bots using page.goto() consistently produce length 1,
   * but so do real users arriving via direct link / email / bookmark.
   * Not meaningful in isolation — only signal in combination.
   */
  historyLength: number;
}
