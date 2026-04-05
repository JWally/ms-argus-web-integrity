/**
 * Headless Detection Types
 *
 * Type definitions for headless browser and bot detection.
 */

/**
 * Signals that suggest a headless browser environment.
 *
 * These aren't definitive proof of headless operation but are
 * commonly seen in headless configurations. A high count of
 * true values increases the likelihood of bot activity.
 */
export interface LikeHeadlessSignals {
  /**
   * Chrome browser without the `chrome` global object.
   * Real Chrome always has window.chrome, headless often doesn't.
   */
  noChrome: boolean;

  /**
   * Permissions API reports "prompt" but Notification.permission is "denied".
   * This inconsistency occurs in some headless configurations.
   */
  hasPermissionsBug: boolean;

  /**
   * No browser plugins detected.
   * Real browsers usually have at least PDF viewer plugin.
   */
  noPlugins: boolean;

  /**
   * No MIME types registered.
   * Real browsers have MIME type handlers for common formats.
   */
  noMimeTypes: boolean;

  /**
   * Notifications are denied by default.
   * Headless browsers often block notifications entirely.
   */
  notificationIsDenied: boolean;

  /**
   * ActiveText CSS color resolves to red.
   * In headless Chrome, ActiveText = rgb(255, 0, 0) instead of system color.
   */
  hasKnownBgColor: boolean;

  /**
   * Light color scheme is preferred.
   * Headless browsers often default to light mode.
   */
  prefersLightColor: boolean;

  /**
   * User-Agent Client Hints has empty platform.
   * Indicates incomplete UA data implementation.
   */
  uaDataIsBlank: boolean;

  /**
   * PDF viewer is disabled.
   * Chrome's built-in PDF viewer is usually enabled in real browsers.
   */
  pdfIsDisabled: boolean;

  /**
   * Screen height equals available height (no taskbar).
   * Real OS always reserves space for taskbar/dock.
   */
  noTaskbar: boolean;

  /**
   * Viewport exactly matches screen dimensions.
   * Suggests a configured viewport rather than real screen.
   */
  hasVvpScreenRes: boolean;

  /**
   * SwiftShader software renderer detected.
   * Used by headless Chrome when no GPU is available.
   */
  hasSwiftShader: boolean;

  /**
   * Web Share API not available.
   * Should be present in Chrome 89+ desktop.
   */
  noWebShare: boolean;

  /**
   * Content Index API not available (Android-only API).
   * Missing on desktop but present on real Android.
   */
  noContentIndex: boolean;

  /**
   * Contacts Manager API not available (Android-only API).
   * Missing on desktop but present on real Android.
   */
  noContactsManager: boolean;

  /**
   * Network Information downlinkMax not available.
   * Present on Android/Chrome OS, missing elsewhere.
   */
  noDownlinkMax: boolean;

  /**
   * Developer tools appear to be open.
   * Detected via window size discrepancy or console getter probe.
   */
  devToolsOpen: boolean;
}

/**
 * Definitive headless browser indicators.
 *
 * These signals are strong evidence of headless operation.
 * Any true value here should raise a red flag.
 */
export interface HeadlessSignals {
  /**
   * WebDriver property is enabled or was tampered with.
   * navigator.webdriver = true indicates automated control.
   */
  webDriverIsOn: boolean;

  /**
   * User agent contains "HeadlessChrome".
   * Direct admission of headless operation.
   */
  hasHeadlessUA: boolean;

  /**
   * Worker user agent contains "HeadlessChrome".
   * Some stealth tools miss the worker context.
   */
  hasHeadlessWorkerUA: boolean;
}

/**
 * Stealth plugin detection signals.
 *
 * These detect tools like puppeteer-extra-plugin-stealth that try
 * to hide automation. The presence of these signals indicates
 * intentional evasion of bot detection.
 */
export interface StealthSignals {
  /**
   * Iframe contentWindow is accessible before DOM insertion.
   * Stealth plugins may proxy iframe creation.
   */
  hasIframeProxy: boolean;

  /**
   * Chrome object appears late in window property list.
   * Stealth plugins add chrome object after page load.
   */
  hasHighChromeIndex: boolean;

  /**
   * Chrome runtime has improper prototype chain.
   * Stealth plugins incorrectly implement chrome.runtime.
   */
  hasBadChromeRuntime: boolean;

  /**
   * Function.toString has been tampered with.
   * Used to hide injected code from detection.
   */
  hasToStringProxy: boolean;

  /**
   * WebGL renderer differs between main thread and worker.
   * Indicates selective GPU spoofing.
   */
  hasBadWebGL: boolean;
}

/**
 * CDP / automation framework detection signals.
 *
 * Detects Chrome DevTools Protocol markers, automation tool globals,
 * and cross-realm API tampering. These catch modern evasion tools
 * (puppeteer-stealth, Patchright, Camoufox) that bypass basic checks.
 */
export interface CdpSignals {
  /** ChromeDriver `$cdc_` globals found on document */
  cdcGlobals: boolean;

  /** Playwright `__pw_` bindings found on window */
  pwBindings: boolean;

  /** navigator.webdriver differs between main frame and phantom iframe */
  phantomMismatch: boolean;

  /** Bot-injected globals matching known patterns (max 5) */
  clientLitter: string[];

  /** Automation framework globals found (playwright, puppeteer, etc.) */
  automationGlobals: string[];

  /**
   * APIs where cross-realm toString disagrees with main frame.
   * Indicates addInitScript-based API patching.
   */
  crossRealmTampered: string[];
}

/**
 * Platform confidence scores.
 *
 * Each platform gets a score from 0-1 based on how many
 * expected features are present. Higher scores indicate
 * better match with that platform's expected capabilities.
 */
export type PlatformScores = Record<string, number>;

/**
 * Platform estimate result.
 *
 * Used to validate that the detected platform matches
 * the available APIs and features.
 */
export interface PlatformEstimate {
  /** Platform confidence scores */
  scores: PlatformScores;
  /** Highest confidence score achieved */
  highestScore: number;
  /** Platform with highest score */
  platform?: string;
}

/**
 * Headless feature detection inputs.
 *
 * External data needed for comprehensive headless detection.
 */
export interface HeadlessDetectionInputs {
  /** WebGL fingerprint data including GPU renderer */
  webgl?: {
    parameters?: {
      UNMASKED_RENDERER_WEBGL?: string;
    };
  };
  /** Worker scope data including user agent and WebGL info */
  workerScope?: {
    userAgent?: string;
    webglRenderer?: string;
  };
}

/**
 * Complete headless detection result.
 */
export interface HeadlessFingerprint {
  /** Whether this is a Chromium-based browser */
  chromium: boolean;

  /** Signals suggesting headless operation */
  likeHeadless: LikeHeadlessSignals;

  /** Definitive headless indicators */
  headless: HeadlessSignals;

  /** Stealth plugin detection signals */
  stealth: StealthSignals;

  /** CDP / automation framework detection signals */
  cdp: CdpSignals;

  /** Percentage of likeHeadless signals that are true (0-100) */
  likeHeadlessRating: number;

  /** Percentage of headless signals that are true (0-100) */
  headlessRating: number;

  /** Percentage of stealth signals that are true (0-100) */
  stealthRating: number;

  /** System fonts resolved from CSS keywords */
  systemFonts: string;

  /** Platform confidence estimation */
  platformEstimate: [PlatformScores, number];
}
