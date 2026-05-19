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
   * `Object.getOwnPropertyNames` toStrings as `[native code]`. False
   * means the enumeration primitive that `cdcGlobals` / `pwBindings`
   * / `clientLitter` / `automationGlobals` all depend on has been
   * replaced — those four signals' negative results can't be trusted.
   * Analyzer treats false as hard-residue evidence on its own.
   */
  ownPropsNative: boolean;
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
