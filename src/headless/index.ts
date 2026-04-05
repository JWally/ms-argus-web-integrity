/**
 * Headless Browser Detection Module
 *
 * Detects headless browsers, automation tools, and stealth plugins.
 * This is critical for fraud detection as bots often run in headless
 * Chrome/Puppeteer environments.
 *
 * Detection is organized into three categories:
 *
 * 1. **likeHeadless**: Soft signals that suggest headless operation
 *    - Missing chrome object, plugins, MIME types
 *    - Known headless CSS color values
 *    - Screen/viewport anomalies
 *    - Missing platform-specific APIs
 *
 * 2. **headless**: Hard signals that prove headless operation
 *    - navigator.webdriver = true
 *    - HeadlessChrome in user agent
 *
 * 3. **stealth**: Signs of evasion tools (puppeteer-stealth, etc.)
 *    - Improperly implemented chrome.runtime
 *    - Function.toString tampering
 *    - chrome object at wrong position
 *    - WebGL mismatch between main thread and worker
 *
 * @module headless
 */

import { captureError } from '../errors';
import { lieProps, PARENT_PHANTOM } from '../lies';
import { instanceId } from '../utils/crypto';
import {
  createTimer,
  queueEvent,
  IS_BLINK,
  logTestResult,
} from '../utils/helpers';
import { expectFailure } from '../utils/expected-failure';

import { HEADLESS_ACTIVE_TEXT_COLOR, CHROME_INDEX_RANGE } from './constants';
import getPlatformEstimate from './getPlatformEstimate';
import { getSystemFonts } from './getSystemFonts';
import type {
  CdpSignals,
  HeadlessFingerprint,
  HeadlessDetectionInputs,
  LikeHeadlessSignals,
  HeadlessSignals,
  StealthSignals,
} from './types';

/**
 * Checks if the chrome object is missing (headless indicator).
 *
 * Real Chrome browsers always have window.chrome defined.
 * Headless Chrome often lacks this object.
 *
 * @returns True if Chrome browser lacks chrome object
 */
function hasNoChrome(): boolean {
  return IS_BLINK && !('chrome' in window);
}

/**
 * Checks for the permissions/notifications bug.
 *
 * In some headless configurations, navigator.permissions reports
 * "prompt" for notifications, but Notification.permission is "denied".
 * This inconsistency doesn't occur in normal browsers.
 *
 * @returns Promise resolving to true if bug is detected
 */
async function hasPermissionsBug(): Promise<boolean> {
  if (!IS_BLINK || !('permissions' in navigator)) return false;

  try {
    const res = await navigator.permissions.query({ name: 'notifications' });
    return (
      res.state === 'prompt' &&
      'Notification' in window &&
      Notification.permission === 'denied'
    );
  } catch {
    expectFailure('hasPermissionsBug', 'permissions.query failed');
    return false;
  }
}

/**
 * Checks if browser has no plugins.
 *
 * Real browsers typically have at least a PDF viewer plugin.
 * Headless browsers often have zero plugins.
 *
 * @returns True if no plugins detected
 */
function hasNoPlugins(): boolean {
  return IS_BLINK && navigator.plugins.length === 0;
}

/**
 * Checks if browser has no MIME types.
 *
 * Real browsers have MIME type handlers for common formats.
 * Missing MIME types suggests a minimal headless environment.
 *
 * @returns True if no MIME types registered
 */
function hasNoMimeTypes(): boolean {
  const mimeTypes = Object.keys({ ...navigator.mimeTypes });
  return IS_BLINK && mimeTypes.length === 0;
}

/**
 * Checks if notifications are denied.
 *
 * Headless browsers often block notifications by default.
 *
 * @returns True if notifications are denied
 */
function hasNotificationDenied(): boolean {
  return (
    IS_BLINK && 'Notification' in window && Notification.permission === 'denied'
  );
}

/**
 * Checks for the known headless ActiveText color.
 *
 * In headless Chrome, the CSS color "ActiveText" resolves to
 * red (rgb(255, 0, 0)) instead of the system's actual active text color.
 *
 * @returns True if ActiveText resolves to the known headless value
 */
function hasKnownBgColor(): boolean {
  if (!IS_BLINK) return false;

  // Use phantom iframe if available, otherwise create temp element
  let rendered: HTMLElement | null = PARENT_PHANTOM ?? null;
  const needsCleanup = !PARENT_PHANTOM;

  if (needsCleanup) {
    rendered = document.createElement('div');
    document.body.appendChild(rendered);
  }

  if (!rendered) return false;

  rendered.setAttribute('style', 'background-color: ActiveText');
  const { backgroundColor: activeText } = getComputedStyle(rendered) || {};

  if (needsCleanup && rendered.parentNode) {
    document.body.removeChild(rendered);
  }

  return activeText === HEADLESS_ACTIVE_TEXT_COLOR;
}

/**
 * Checks if user agent data is blank.
 *
 * Empty platform in userAgentData indicates incomplete implementation.
 *
 * @returns Promise resolving to true if UA data is blank
 */
async function hasBlankUaData(): Promise<boolean> {
  if (!('userAgentData' in navigator)) return false;

  try {
    // @ts-expect-error userAgentData may not be typed
    if (navigator.userAgentData?.platform === '') return true;

    // @ts-expect-error userAgentData may not be typed
    const highEntropy = await navigator.userAgentData.getHighEntropyValues([
      'platform',
    ]);
    return highEntropy.platform === '';
  } catch {
    expectFailure(
      'hasBlankUaData',
      'userAgentData.getHighEntropyValues failed',
    );
    return false;
  }
}

/**
 * Checks if screen dimensions match available dimensions.
 *
 * Real operating systems reserve space for taskbar/dock.
 * Screen matching available dimensions suggests virtual display.
 *
 * @returns True if no taskbar space detected
 */
function hasNoTaskbar(): boolean {
  return (
    screen.height === screen.availHeight && screen.width === screen.availWidth
  );
}

/**
 * Checks if viewport matches screen exactly.
 *
 * When viewport exactly matches screen, it suggests a configured
 * virtual display rather than a real physical screen.
 *
 * @returns True if viewport matches screen dimensions
 */
function hasVvpScreenRes(): boolean {
  if (innerWidth === screen.width && outerHeight === screen.height) {
    return true;
  }

  if (!('visualViewport' in window)) return false;

  const vp = window.visualViewport;
  return !!(
    vp &&
    vp.width === screen.width &&
    vp.height === screen.height
  );
}

/**
 * Checks if SwiftShader software renderer is in use.
 *
 * SwiftShader is a CPU-based OpenGL implementation used by
 * headless Chrome when no GPU is available.
 *
 * @param workerScope - Worker scope data
 * @returns True if SwiftShader is detected
 */
function hasSwiftShader(
  workerScope: HeadlessDetectionInputs['workerScope'],
): boolean {
  return /SwiftShader/.test(workerScope?.webglRenderer || '');
}

/**
 * Checks if Web Share API is missing.
 *
 * Web Share should be present in Chrome 89+ desktop.
 * Missing suggests headless or incomplete implementation.
 *
 * @returns True if Web Share API is missing
 */
function hasNoWebShare(): boolean {
  // Only check if browser version supports accent-color (Chrome 93+)
  return (
    IS_BLINK &&
    CSS.supports('accent-color: initial') &&
    (!('share' in navigator) || !('canShare' in navigator))
  );
}

/**
 * Checks if WebDriver is enabled.
 *
 * navigator.webdriver = true indicates automated control.
 * Also checks for tampering with the webdriver property.
 *
 * @returns True if webdriver is on or tampered
 */
function isWebDriverOn(): boolean {
  // Check for modern Chrome without webdriver (should have it defined)
  const hasModernChrome = CSS.supports('border-end-end-radius: initial');
  const webdriverUndefined = navigator.webdriver === undefined;

  return (
    (hasModernChrome && webdriverUndefined) ||
    !!navigator.webdriver ||
    !!lieProps['Navigator.webdriver']
  );
}

/**
 * Checks if user agent contains HeadlessChrome.
 *
 * @returns True if HeadlessChrome is in the UA string
 */
function hasHeadlessUA(): boolean {
  return (
    /HeadlessChrome/.test(navigator.userAgent) ||
    /HeadlessChrome/.test(navigator.appVersion)
  );
}

/**
 * Checks if worker user agent contains HeadlessChrome.
 *
 * Some stealth tools miss the worker context.
 *
 * @param workerScope - Worker scope data
 * @returns True if worker UA has HeadlessChrome
 */
function hasHeadlessWorkerUA(
  workerScope: HeadlessDetectionInputs['workerScope'],
): boolean {
  return !!workerScope && /HeadlessChrome/.test(workerScope.userAgent || '');
}

/**
 * Checks for iframe proxy behavior.
 *
 * Stealth plugins may proxy iframe creation, causing contentWindow
 * to be accessible before DOM insertion.
 *
 * @returns True if iframe proxy is detected
 */
function hasIframeProxy(): boolean {
  try {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = instanceId;
    // contentWindow should be null before insertion
    return !!iframe.contentWindow;
  } catch {
    expectFailure('hasIframeProxy', 'iframe creation failed');
    return true;
  }
}

/**
 * Checks if chrome object appears late in window properties.
 *
 * Real Chrome adds the chrome object early in page lifecycle.
 * Stealth plugins add it after load, causing it to appear at
 * a high index in Object.keys(window).
 *
 * @returns True if chrome is at high index
 */
function hasHighChromeIndex(): boolean {
  const key = 'chrome';
  return (
    Object.keys(window).slice(CHROME_INDEX_RANGE).includes(key) &&
    Object.getOwnPropertyNames(window).slice(CHROME_INDEX_RANGE).includes(key)
  );
}

/**
 * Checks for improperly implemented chrome.runtime.
 *
 * Stealth plugins often implement chrome.runtime incorrectly:
 * - sendMessage/connect have prototype property
 * - Can be called with new (shouldn't be constructors)
 * - Don't throw TypeError when misused
 *
 * @returns True if chrome.runtime is implemented incorrectly
 */
function hasBadChromeRuntime(): boolean {
   
  const chromeAny = (window as any).chrome;
  if (!chromeAny || !('runtime' in chromeAny)) {
    return false;
  }

  try {
    // Real chrome.runtime methods don't have prototype
    if (
      'prototype' in chromeAny.runtime.sendMessage ||
      'prototype' in chromeAny.runtime.connect
    ) {
      return true;
    }

    // Real chrome.runtime methods can't be called with new
    new chromeAny.runtime.sendMessage();
    new chromeAny.runtime.connect();

    // If we get here, they're constructable (bad)
    return true;
  } catch (err: unknown) {
    // Real methods throw TypeError
    return (err as Error).constructor.name !== 'TypeError';
  }
}

/**
 * Checks if WebGL renderer differs between main and worker.
 *
 * Some stealth tools only spoof GPU in the main thread,
 * leaving the worker with the real GPU string.
 *
 * @param webgl - WebGL fingerprint data
 * @param workerScope - Worker scope data
 * @returns True if WebGL mismatch detected
 */
function hasBadWebGL(
  webgl: HeadlessDetectionInputs['webgl'],
  workerScope: HeadlessDetectionInputs['workerScope'],
): boolean {
  const gpu = webgl?.parameters?.UNMASKED_RENDERER_WEBGL;
  const workerGPU = workerScope?.webglRenderer;
  return !!(gpu && workerGPU && gpu !== workerGPU);
}

// ============================================================================
// CDP / AUTOMATION FRAMEWORK DETECTION
// ============================================================================

const NATIVE_RE = /\{\s*\[native code\]\s*\}/;
const HIDDEN_IFRAME_CSS = 'display:none;width:0;height:0;border:none';

/** Regex matching known bot-injected window globals. */
const BOT_LITTER_RE =
  /^(__decryptedChallenge|__nextFlash|__captcha|__solver|__bot|__scrape|__crawl|__auto|__inject|__hook|__intercept|__proxy|__bypass|__patch|puppeteer_|playwright_|selenium_|webdriver_|cdc_|_phantom$|callPhantom$)/;

/** Automation framework globals to probe. */
const AUTOMATION_GLOBALS: [string, () => unknown][] = [
  [
    'playwright',
    () => (window as unknown as Record<string, unknown>).__playwright,
  ],
  [
    'puppeteer',
    () => (window as unknown as Record<string, unknown>).__puppeteer,
  ],
  ['phantom', () => (window as unknown as Record<string, unknown>)._phantom],
  [
    'nightmare',
    () => (window as unknown as Record<string, unknown>).__nightmare,
  ],
  [
    'callPhantom',
    () => (window as unknown as Record<string, unknown>).callPhantom,
  ],
  [
    'selenium_unwrapped',
    () => (document as unknown as Record<string, unknown>).__selenium_unwrapped,
  ],
  [
    'webdriver_evaluate',
    () => (document as unknown as Record<string, unknown>).__webdriver_evaluate,
  ],
  [
    'driver_evaluate',
    () => (document as unknown as Record<string, unknown>).__driver_evaluate,
  ],
];

/** Checks for ChromeDriver `cdc_` globals on `document`. */
function checkCdcGlobals(): boolean {
  try {
    for (const key of Object.getOwnPropertyNames(document)) {
      if (/^(\$)?cdc_/.test(key)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Checks for Playwright `__pw_` bindings on `window`. */
function checkPwBindings(): boolean {
  try {
    for (const key of Object.getOwnPropertyNames(window)) {
      if (/^__pw_/.test(key)) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Creates a hidden iframe in a closed Shadow DOM and returns its window.
 * Bot's `addInitScript` patches main frame but not dynamically created iframes.
 */
function getPhantomWindow(): Window | null {
  try {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    iframe.style.cssText = HIDDEN_IFRAME_CSS;
    shadow.appendChild(iframe);
    document.body.appendChild(host);
    const win = iframe.contentWindow;
    setTimeout(() => host.remove(), 0);
    return win;
  } catch {
    return null;
  }
}

/**
 * Detects webdriver mismatch between main frame and a phantom iframe.
 * Stealth tools patch main frame's navigator.webdriver but miss iframes.
 */
function checkPhantomMismatch(): boolean {
  try {
    const mainWebdriver = (navigator as unknown as Record<string, unknown>)
      .webdriver;
    const phantom = getPhantomWindow();
    if (!phantom) return false;
    const iframeWebdriver = (
      phantom.navigator as unknown as Record<string, unknown>
    ).webdriver;
    if (!mainWebdriver && iframeWebdriver === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Scans window globals for known bot-injected properties.
 * Returns the list of matching global names (max 5).
 */
function checkClientLitter(): string[] {
  try {
    const matches: string[] = [];
    for (const key of Object.getOwnPropertyNames(window)) {
      if (BOT_LITTER_RE.test(key)) matches.push(key);
    }
    return matches.slice(0, 5);
  } catch {
    return [];
  }
}

/** Checks for automation framework globals. */
function checkAutomationGlobals(): string[] {
  const found: string[] = [];
  for (const [name, getFn] of AUTOMATION_GLOBALS) {
    try {
      if (getFn() != null) found.push(name);
    } catch {
      /* ignore */
    }
  }
  return found;
}

/**
 * Gets a clean Function.prototype.toString from a double-nested iframe.
 *
 * Bot's addInitScript patches main frame and sometimes first-level iframes,
 * but rarely reaches a second-level iframe inside a closed Shadow DOM.
 */
function getCrossRealmToString(): typeof Function.prototype.toString | null {
  try {
    const host1 = document.createElement('div');
    const shadow1 = host1.attachShadow({ mode: 'closed' });
    const iframe1 = document.createElement('iframe');
    iframe1.style.cssText = HIDDEN_IFRAME_CSS;
    shadow1.appendChild(iframe1);
    document.body.appendChild(host1);
    const win1 = iframe1.contentWindow;
    if (!win1) {
      host1.remove();
      return null;
    }

    const doc1 = win1.document;
    const iframe2 = doc1.createElement('iframe');
    iframe2.style.cssText = HIDDEN_IFRAME_CSS;
    doc1.body.appendChild(iframe2);
    const win2 = iframe2.contentWindow;
    if (!win2) {
      host1.remove();
      return null;
    }

    const cleanToString = (
      win2 as unknown as {
        Function: {
          prototype: { toString: typeof Function.prototype.toString };
        };
      }
    ).Function.prototype.toString;

    setTimeout(() => host1.remove(), 0);
    return cleanToString;
  } catch {
    return null;
  }
}

/**
 * Cross-realm integrity check (PHANTOM_DARKNESS pattern).
 *
 * Compares Function.prototype.toString from the main frame against a clean
 * copy from a double-nested iframe. If the main frame claims [native code]
 * but the cross-realm copy disagrees, the API has been tampered with.
 *
 * This catches puppeteer-stealth, Patchright, Camoufox, and similar tools
 * that use addInitScript to patch APIs.
 */
function detectCrossRealmTampering(): string[] {
  const signals: string[] = [];
  const cleanToString = getCrossRealmToString();
  if (!cleanToString) return signals;

  const checks: [string, () => unknown][] = [
    [
      'Element.getBoundingClientRect',
      () => Element.prototype.getBoundingClientRect,
    ],
    [
      'HTMLCanvasElement.getContext',
      () => HTMLCanvasElement.prototype.getContext,
    ],
    [
      'HTMLCanvasElement.toDataURL',
      () => HTMLCanvasElement.prototype.toDataURL,
    ],
    ['Performance.now', () => Performance.prototype.now],
    ['Date.getTimezoneOffset', () => Date.prototype.getTimezoneOffset],
    ['Navigator.toString', () => Navigator.prototype.toString],
  ];

  for (const [name, getFn] of checks) {
    try {
      const fn = getFn();
      if (typeof fn !== 'function') continue;
      const mainResult = Function.prototype.toString.call(fn);
      const crossResult = cleanToString.call(fn);
      if (NATIVE_RE.test(mainResult) && !NATIVE_RE.test(crossResult)) {
        signals.push(name);
      }
    } catch {
      /* ignore */
    }
  }
  return signals;
}

/**
 * Collects all CDP / automation detection signals.
 */
function detectCdp(): CdpSignals {
  const cdcGlobals = checkCdcGlobals();
  const pwBindings = checkPwBindings();
  const phantomMismatch = checkPhantomMismatch();
  const clientLitter = checkClientLitter();
  const automationGlobals = checkAutomationGlobals();
  const crossRealmTampered = detectCrossRealmTampering();

  return {
    cdcGlobals,
    pwBindings,
    phantomMismatch,
    clientLitter,
    automationGlobals,
    crossRealmTampered,
  };
}

// ============================================================================
// DEVELOPER TOOLS DETECTION
// ============================================================================

/**
 * Detects whether developer tools appear to be open.
 *
 * Uses window size discrepancy: when DevTools is docked, outerWidth/outerHeight
 * remain the same but innerWidth/innerHeight shrink, creating a large gap.
 * A threshold of 160px avoids false positives from browser chrome.
 *
 * Also checks for the legacy Firebug debugger.
 *
 * @returns True if DevTools appears open
 */
function detectDevTools(): boolean {
  // Size-based detection (docked DevTools)
  if (outerWidth - innerWidth > 160 || outerHeight - innerHeight > 160) {
    return true;
  }

  // Firebug legacy detection
  // @ts-expect-error Firebug global
  if (window.Firebug?.chrome?.isInitialized) {
    return true;
  }

  return false;
}

/**
 * Calculates percentage of true signals.
 *
 * @param signals - Object of boolean signals
 * @returns Percentage (0-100) of true signals
 */
function calculateRating(signals: Record<string, boolean>): number {
  const keys = Object.keys(signals);
  const trueCount = keys.filter((key) => signals[key]).length;
  return +((trueCount / keys.length) * 100).toFixed(0);
}

/**
 * Collects headless browser detection signals.
 *
 * Performs comprehensive analysis to detect:
 * - Headless Chrome/Puppeteer
 * - Automation tools (Selenium, WebDriver)
 * - Stealth plugins trying to hide automation
 *
 * @param inputs - WebGL and worker scope data for cross-validation
 * @returns Headless detection fingerprint
 */
export default async function getHeadlessFeatures(
  inputs: HeadlessDetectionInputs,
): Promise<HeadlessFingerprint | undefined> {
  const { webgl, workerScope } = inputs;

  try {
    const timer = createTimer();
    await queueEvent(timer);

    // Get system fonts and platform estimate
    const systemFonts = getSystemFonts();
    const [scores, highestScore, headlessEstimate] = getPlatformEstimate();

    // Collect "like headless" signals (soft indicators)
    const likeHeadless: LikeHeadlessSignals = {
      noChrome: hasNoChrome(),
      hasPermissionsBug: await hasPermissionsBug(),
      noPlugins: hasNoPlugins(),
      noMimeTypes: hasNoMimeTypes(),
      notificationIsDenied: hasNotificationDenied(),
      hasKnownBgColor: hasKnownBgColor(),
      prefersLightColor: matchMedia('(prefers-color-scheme: light)').matches,
      uaDataIsBlank: await hasBlankUaData(),
      pdfIsDisabled:
        'pdfViewerEnabled' in navigator && navigator.pdfViewerEnabled === false,
      noTaskbar: hasNoTaskbar(),
      hasVvpScreenRes: hasVvpScreenRes(),
      hasSwiftShader: hasSwiftShader(workerScope),
      noWebShare: hasNoWebShare(),
      noContentIndex: !!headlessEstimate?.noContentIndex,
      noContactsManager: !!headlessEstimate?.noContactsManager,
      noDownlinkMax: !!headlessEstimate?.noDownlinkMax,
      devToolsOpen: detectDevTools(),
    };

    // Collect hard headless signals (definitive proof)
    const headless: HeadlessSignals = {
      webDriverIsOn: isWebDriverOn(),
      hasHeadlessUA: hasHeadlessUA(),
      hasHeadlessWorkerUA: hasHeadlessWorkerUA(workerScope),
    };

    // Collect stealth plugin signals
    const stealth: StealthSignals = {
      hasIframeProxy: hasIframeProxy(),
      hasHighChromeIndex: hasHighChromeIndex(),
      hasBadChromeRuntime: hasBadChromeRuntime(),
      hasToStringProxy: !!lieProps['Function.toString'],
      hasBadWebGL: hasBadWebGL(webgl, workerScope),
    };

    // Collect CDP / automation framework signals
    const cdp = detectCdp();

    // Calculate detection ratings
    const likeHeadlessRating = calculateRating(likeHeadless as unknown as Record<string, boolean>);
    const headlessRating = calculateRating(headless as unknown as Record<string, boolean>);
    const stealthRating = calculateRating(stealth as unknown as Record<string, boolean>);

    logTestResult({ time: timer.stop(), test: 'headless', passed: true });

    return {
      chromium: IS_BLINK,
      likeHeadless,
      headless,
      stealth,
      cdp,
      likeHeadlessRating,
      headlessRating,
      stealthRating,
      systemFonts,
      platformEstimate: [scores || {}, highestScore || 0],
    };
  } catch (error) {
    logTestResult({ test: 'headless', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
