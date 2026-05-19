/**
 * Headless Browser Detection Module
 *
 * Detects headless browsers, automation tools, and stealth plugins.
 *
 * Signals are organized into four categories:
 *
 * 1. **likeHeadless** — soft signals, individually inconclusive, weighted server-side
 * 2. **headless**     — hard signals, any true = strong automation evidence
 * 3. **stealth**      — evasion tool signals (puppeteer-stealth, Patchright, etc.)
 * 4. **cdp**          — CDP/automation framework residue
 *
 * Raw observables (historyLength) are collected here but analyzed server-side.
 * See per-signal comments for rot risks and server-side validation notes.
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
import { getTopSameOriginWindow } from '../utils/top-window';

import { CHROME_INDEX_RANGE } from './constants';

// Collection runs inside the loader's srcdoc iframe. Window-scoped
// APIs (screen, outer/inner dimensions, visualViewport) read from the
// iframe by default — which on WebKit reports iframe size, and on
// every browser reports iframe inner dimensions rather than the real
// browser's outer chrome. Reach to the topmost same-origin window so
// dimension-based headless heuristics don't false-positive on real
// users whose browsers happen to be windowed inside the iframe's
// perspective. No-op when at top-level.
const topWin = getTopSameOriginWindow();
import getConsoleTiming from './getConsoleTiming';
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

// ── Like-Headless signals ────────────────────────────────────────────────────

function hasNoChrome(): boolean {
  return IS_BLINK && !('chrome' in window);
}

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

function hasNoPlugins(): boolean {
  return IS_BLINK && navigator.plugins.length === 0;
}

function hasNoMimeTypes(): boolean {
  const mimeTypes = Object.keys({ ...navigator.mimeTypes });
  return IS_BLINK && mimeTypes.length === 0;
}

function hasNotificationDenied(): boolean {
  return (
    IS_BLINK && 'Notification' in window && Notification.permission === 'denied'
  );
}

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

function hasNoTaskbar(): boolean {
  const s = topWin.screen;
  return s.height === s.availHeight && s.width === s.availWidth;
}

function hasVvpScreenRes(): boolean {
  const s = topWin.screen;
  if (topWin.innerWidth === s.width && topWin.outerHeight === s.height)
    return true;
  if (!('visualViewport' in topWin)) return false;
  const vp = topWin.visualViewport;
  return !!(vp && vp.width === s.width && vp.height === s.height);
}

/**
 * Detects known software/virtual GPU renderers in the WebGL renderer string.
 *
 * Covers: SwiftShader (old and new headless Chrome format), llvmpipe (Linux/Mesa),
 * VMware SVGA (VM display), Microsoft Basic Render Driver (Windows software fallback).
 *
 * NOTE: New headless Chrome (112+) on a machine WITH a real GPU uses the real
 * renderer — this only fires on cloud machines without GPU pass-through.
 * GPU vendor-based detection (Google/VMware/Mesa vendor strings) is a stronger
 * signal for new headless but requires webglVendor in inputs — server-side cross-
 * reference of vendor + renderer is more reliable.
 */
function hasSoftwareRenderer(
  workerScope: HeadlessDetectionInputs['workerScope'],
): boolean {
  const renderer = workerScope?.webglRenderer || '';
  return /SwiftShader|llvmpipe|VMware SVGA|Mesa DRI|Microsoft Basic Render Driver/i.test(
    renderer,
  );
}

function detectDevTools(): boolean {
  if (
    topWin.outerWidth - topWin.innerWidth > 160 ||
    topWin.outerHeight - topWin.innerHeight > 160
  ) {
    return true;
  }
  // @ts-expect-error Firebug global
  if (topWin.Firebug?.chrome?.isInitialized) return true;
  return false;
}

// ── Hard headless signals ─────────────────────────────────────────────────────

function isWebDriverOn(): boolean {
  const hasModernChrome = CSS.supports('border-end-end-radius: initial');
  const webdriverUndefined = navigator.webdriver === undefined;
  return (
    (hasModernChrome && webdriverUndefined) ||
    !!navigator.webdriver ||
    !!lieProps['Navigator.webdriver']
  );
}

function hasHeadlessUA(): boolean {
  return (
    /HeadlessChrome/.test(navigator.userAgent) ||
    /HeadlessChrome/.test(navigator.appVersion)
  );
}

function hasHeadlessWorkerUA(
  workerScope: HeadlessDetectionInputs['workerScope'],
): boolean {
  return !!workerScope && /HeadlessChrome/.test(workerScope.userAgent || '');
}

// ── Stealth signals ───────────────────────────────────────────────────────────

function hasIframeProxy(): boolean {
  try {
    const iframe = document.createElement('iframe');
    iframe.srcdoc = instanceId;
    return !!iframe.contentWindow;
  } catch {
    expectFailure('hasIframeProxy', 'iframe creation failed');
    return true;
  }
}

function hasHighChromeIndex(): boolean {
  const key = 'chrome';
  return (
    Object.keys(window).slice(CHROME_INDEX_RANGE).includes(key) &&
    Object.getOwnPropertyNames(window).slice(CHROME_INDEX_RANGE).includes(key)
  );
}

function hasBadChromeRuntime(): boolean {
  const chromeAny = (window as any).chrome;
  if (!chromeAny || !('runtime' in chromeAny)) return false;
  try {
    if (
      'prototype' in chromeAny.runtime.sendMessage ||
      'prototype' in chromeAny.runtime.connect
    ) {
      return true;
    }
    new chromeAny.runtime.sendMessage();
    new chromeAny.runtime.connect();
    return true;
  } catch (err: unknown) {
    return (err as Error).constructor.name !== 'TypeError';
  }
}

/**
 * chrome exists but chrome.loadTimes is missing.
 *
 * Real Chrome always exposes chrome.loadTimes (deprecated since Chrome 64 but
 * never removed). Stealth plugins that add window.chrome routinely omit it.
 * Only checked when chrome exists — pairs with noChrome in likeHeadless.
 *
 * ROT RISK: If Google removes chrome.loadTimes this inverts — all real Chrome
 * users would return true. SERVER-SIDE: validate against Chrome version before
 * treating as hard signal.
 */
function hasMissingLoadTimes(): boolean {
  const chromeAny = (window as any).chrome;
  if (!chromeAny) return false;
  return typeof chromeAny.loadTimes !== 'function';
}

/**
 * chrome exists but chrome.csi is missing.
 * Same pattern as hasMissingLoadTimes — deprecated but always present in real Chrome.
 *
 * ROT RISK / SERVER-SIDE: same caveat as hasMissingLoadTimes.
 */
function hasMissingCsi(): boolean {
  const chromeAny = (window as any).chrome;
  if (!chromeAny) return false;
  return typeof chromeAny.csi !== 'function';
}

/**
 * chrome exists but chrome.app surface is incomplete.
 *
 * Real Chrome always has:
 *   chrome.app.isInstalled   (boolean)
 *   chrome.app.getDetails    (function)
 *   chrome.app.runningState  (function)
 *
 * Stealth plugins that add chrome.runtime typically skip chrome.app entirely.
 *
 * ROT RISK: chrome.app is tied to the deprecated Chrome Apps API (killed 2022).
 * If Google removes chrome.app, this fires for all real Chrome users.
 * SERVER-SIDE: validate against Chrome version before treating as hard signal.
 */
function hasIncompleteAppSurface(): boolean {
  const chromeAny = (window as any).chrome;
  if (!chromeAny) return false;
  const app = chromeAny.app;
  if (!app) return true;
  return (
    typeof app.isInstalled !== 'boolean' ||
    typeof app.getDetails !== 'function' ||
    typeof app.runningState !== 'function'
  );
}

function hasBadWebGL(
  webgl: HeadlessDetectionInputs['webgl'],
  workerScope: HeadlessDetectionInputs['workerScope'],
): boolean {
  const gpu = webgl?.parameters?.UNMASKED_RENDERER_WEBGL;
  const workerGPU = workerScope?.webglRenderer;
  return !!(gpu && workerGPU && gpu !== workerGPU);
}

// ── CDP / Automation framework detection ─────────────────────────────────────

const NATIVE_RE = /\{\s*\[native code\]\s*\}/;
const HIDDEN_IFRAME_CSS = 'display:none;width:0;height:0;border:none';

const BOT_LITTER_RE =
  /^(__decryptedChallenge|__nextFlash|__captcha|__solver|__bot|__scrape|__crawl|__auto|__inject|__hook|__intercept|__proxy|__bypass|__patch|puppeteer_|playwright_|selenium_|webdriver_|cdc_|_phantom$|callPhantom$)/;

const AUTOMATION_GLOBALS: [string, () => unknown][] = [
  ['playwright', () => (window as any).__playwright],
  ['puppeteer', () => (window as any).__puppeteer],
  ['phantom', () => (window as any)._phantom],
  ['nightmare', () => (window as any).__nightmare],
  ['callPhantom', () => (window as any).callPhantom],
  ['selenium_unwrapped', () => (document as any).__selenium_unwrapped],
  ['webdriver_evaluate', () => (document as any).__webdriver_evaluate],
  ['driver_evaluate', () => (document as any).__driver_evaluate],
];

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

function checkPhantomMismatch(): boolean {
  try {
    const mainWebdriver = (navigator as any).webdriver;
    const phantom = getPhantomWindow();
    if (!phantom) return false;
    const iframeWebdriver = (phantom.navigator as any).webdriver;
    if (!mainWebdriver && iframeWebdriver === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

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

    const cleanToString = (win2 as any).Function.prototype.toString;
    setTimeout(() => host1.remove(), 0);
    return cleanToString;
  } catch {
    return null;
  }
}

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
 * `Object.getOwnPropertyNames` is the single API that `checkCdcGlobals`,
 * `checkPwBindings`, `checkClientLitter`, and `checkAutomationGlobals`
 * all depend on. A bot that replaces it with a filtered version
 * (`function getOwnPropertyNames(obj) { return native(obj).filter(k =>
 * !/^__pw_/.test(k)); }`) blinds all four signals at once — the four
 * hard-residue checks see clean state and `hasHardCdpResidue` returns
 * false. `Object` is not in `API_SEARCH_TARGETS` (the broad scanner
 * skips it because legitimate-code FP blast radius would be too high to
 * scan generically). Verifying it here, at the one use-site that
 * cares, gives the analyzer a flag without bloating the generic scan.
 *
 * False here doesn't necessarily mean a bot — but combined with otherwise
 * clean CDP signals, it's the shape of "attacker is hiding from the
 * enumeration we just ran." The analyzer treats it as hard residue.
 */
function isOwnPropsNative(): boolean {
  try {
    return NATIVE_RE.test(
      Function.prototype.toString.call(Object.getOwnPropertyNames),
    );
  } catch {
    return false;
  }
}

function detectCdp(): CdpSignals {
  return {
    cdcGlobals: checkCdcGlobals(),
    pwBindings: checkPwBindings(),
    phantomMismatch: checkPhantomMismatch(),
    clientLitter: checkClientLitter(),
    automationGlobals: checkAutomationGlobals(),
    crossRealmTampered: detectCrossRealmTampering(),
    consoleTiming: getConsoleTiming(),
    ownPropsNative: isOwnPropsNative(),
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function calculateRating(signals: Record<string, boolean>): number {
  const keys = Object.keys(signals);
  const trueCount = keys.filter((key) => signals[key]).length;
  return +((trueCount / keys.length) * 100).toFixed(0);
}

// ── Main export ───────────────────────────────────────────────────────────────

export default async function getHeadlessFeatures(
  inputs: HeadlessDetectionInputs,
): Promise<HeadlessFingerprint | undefined> {
  const { webgl, workerScope } = inputs;

  try {
    const timer = createTimer();
    await queueEvent(timer);

    const systemFonts = getSystemFonts();
    const [scores, highestScore] = getPlatformEstimate();

    const likeHeadless: LikeHeadlessSignals = {
      noChrome: hasNoChrome(),
      hasPermissionsBug: await hasPermissionsBug(),
      noPlugins: hasNoPlugins(),
      noMimeTypes: hasNoMimeTypes(),
      notificationIsDenied: hasNotificationDenied(),
      uaDataIsBlank: await hasBlankUaData(),
      pdfIsDisabled:
        'pdfViewerEnabled' in navigator && navigator.pdfViewerEnabled === false,
      noTaskbar: hasNoTaskbar(),
      hasVvpScreenRes: hasVvpScreenRes(),
      hasSoftwareRenderer: hasSoftwareRenderer(workerScope),
      devToolsOpen: detectDevTools(),
    };

    const headless: HeadlessSignals = {
      webDriverIsOn: isWebDriverOn(),
      hasHeadlessUA: hasHeadlessUA(),
      hasHeadlessWorkerUA: hasHeadlessWorkerUA(workerScope),
    };

    const stealth: StealthSignals = {
      hasIframeProxy: hasIframeProxy(),
      hasHighChromeIndex: hasHighChromeIndex(),
      hasBadChromeRuntime: hasBadChromeRuntime(),
      hasToStringProxy: !!lieProps['Function.toString'],
      hasBadWebGL: hasBadWebGL(webgl, workerScope),
      missingLoadTimes: hasMissingLoadTimes(),
      missingCsi: hasMissingCsi(),
      incompleteAppSurface: hasIncompleteAppSurface(),
    };

    const cdp = detectCdp();

    logTestResult({ time: timer.stop(), test: 'headless', passed: true });

    return {
      chromium: IS_BLINK,
      likeHeadless,
      headless,
      stealth,
      cdp,
      likeHeadlessRating: calculateRating(
        likeHeadless as unknown as Record<string, boolean>,
      ),
      headlessRating: calculateRating(
        headless as unknown as Record<string, boolean>,
      ),
      stealthRating: calculateRating(
        stealth as unknown as Record<string, boolean>,
      ),
      systemFonts,
      platformEstimate: [scores || {}, highestScore || 0],
      historyLength: history.length,
    };
  } catch (error) {
    logTestResult({ test: 'headless', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
