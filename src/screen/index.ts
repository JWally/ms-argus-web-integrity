/**
 * Screen Fingerprinting Module
 *
 * Collects screen dimensions and validates their authenticity.
 * Screen data is a valuable fingerprinting signal because:
 *
 * 1. **Device Identification**: Screen resolution correlates strongly with
 *    device type (mobile, laptop, desktop, external monitor).
 *
 * 2. **Multi-Monitor Detection**: Available dimensions differ from full
 *    dimensions when taskbars/docks are present, revealing OS configuration.
 *
 * 3. **Cross-Validation**: Screen dimensions can be validated against
 *    CSS media queries, catching spoofing attempts that only patch the
 *    Screen API but not matchMedia().
 *
 * 4. **Touch Capability**: Combined with screen size, touch support helps
 *    distinguish mobile devices from desktop browsers.
 *
 * @module screen
 */

import { captureError } from '../errors';
import { lieProps, documentLie } from '../lies';
import {
  createTimer,
  IS_GECKO,
  IS_WEBKIT,
  logTestResult,
  LowerEntropy,
} from '../utils/helpers';
import { expectFailure } from '../utils/expected-failure';
import { getTopSameOriginWindow } from '../utils/top-window';
import { TASKBAR_DETECTION_THRESHOLD } from './constants';
import type { ScreenFingerprint } from './types';

// Collection runs inside a srcdoc iframe. WebKit reports window.screen
// as the iframe's frame size; Chromium/Firefox look through to the real
// device screen. Reading from the topmost same-origin window normalizes
// all three. No-op when already at top (e.g. library consumers calling
// collectIntegrity() from the parent realm directly).
const topWin = getTopSameOriginWindow();

/**
 * Detects touch screen capability.
 *
 * Uses two signals:
 * 1. `ontouchstart` in window - indicates touch event support
 * 2. TouchEvent constructor - validates the event type exists
 *
 * Some emulators fake ontouchstart but fail to implement TouchEvent,
 * so both checks together provide better accuracy.
 *
 * @returns True if genuine touch support is detected
 */
function hasTouch(): boolean {
  try {
    return 'ontouchstart' in window && !!document.createEvent('TouchEvent');
  } catch {
    expectFailure('hasTouch', 'TouchEvent creation failed');
    return false;
  }
}

/**
 * Validates screen dimensions against CSS media queries.
 *
 * The Screen API and matchMedia() should return consistent values.
 * Spoofers often patch Screen.width/height but forget to also patch
 * matchMedia(), allowing us to detect the inconsistency.
 *
 * @param width - Reported screen width
 * @param height - Reported screen height
 * @returns True if dimensions match media query
 */
function validateScreenDimensions(width: number, height: number): boolean {
  return topWin.matchMedia(
    `(device-width: ${width}px) and (device-height: ${height}px)`,
  ).matches;
}

/**
 * Validates device pixel ratio against CSS resolution.
 *
 * Similar to dimension validation, dppx (dots per pixel) from
 * matchMedia should match window.devicePixelRatio. Inconsistency
 * suggests the DPR value has been spoofed.
 *
 * @param dpr - Reported device pixel ratio
 * @returns True if DPR matches media query
 */
function validateDevicePixelRatio(dpr: number): boolean {
  return topWin.matchMedia(`(resolution: ${dpr}dppx)`).matches;
}

/**
 * Discovers the actual devicePixelRatio via matchMedia binary search.
 *
 * `validateDevicePixelRatio` above only asks "does the *reported* DPR
 * round-trip through matchMedia?". A spoofer who patches
 * `window.devicePixelRatio` but leaves the CSS engine untouched can
 * survive that check if they spoof to a value that doesn't round-trip
 * cleanly — `(resolution: X dppx)` is an exact match and brittle.
 *
 * This routine instead brackets the real DPR with `(max-resolution: X
 * dppx)` queries, which the CSS engine answers honestly regardless of
 * what JS reports. After ~12 iterations the bracket has ~0.001
 * precision — much finer than the gap between any legitimate adjacent
 * DPR values. The server compares the returned value against the
 * reported `devicePixelRatio` and treats a gap as a tamper signal.
 *
 * Technique borrowed from Castle's matchMedia probe (Castle.md §3.3 /
 * §4.3) — they do the same 41-step search across DPI but the dppx
 * variant is equivalent and one fewer unit-conversion to reason about.
 *
 * @returns Midpoint of the converged bracket, ≈ the real DPR
 */
function searchDevicePixelRatio(): number {
  let lo = 0.5;
  let hi = 5;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (topWin.matchMedia(`(max-resolution: ${mid}dppx)`).matches) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Checks for missing taskbar space on large screens.
 *
 * On screens larger than 800px, operating systems typically show a
 * taskbar (Windows), dock (macOS), or panel (Linux). This reduces
 * availWidth/availHeight compared to full dimensions.
 *
 * If a large screen has no taskbar space, it suggests:
 * - Headless browser mode (no OS UI)
 * - Full-screen kiosk mode
 * - Screen dimension spoofing
 *
 * @param width - Full screen width
 * @param height - Full screen height
 * @param availWidth - Available width
 * @param availHeight - Available height
 * @returns True if taskbar space is suspiciously missing
 */
function hasNoTaskbar(
  width: number,
  height: number,
  availWidth: number,
  availHeight: number,
): boolean {
  const noTaskbarSpace = !(width - availWidth || height - availHeight);
  return width > TASKBAR_DETECTION_THRESHOLD && noTaskbarSpace;
}

/**
 * Checks for lie detection on screen-related APIs.
 *
 * Monitors these Screen properties for tampering:
 * - Screen.width / Screen.height
 * - Screen.availWidth / Screen.availHeight
 * - Screen.colorDepth / Screen.pixelDepth
 *
 * @returns True if any screen property was tampered with
 */
/**
 * Collects viewport, window, visual-viewport, orientation, and zoom-estimate
 * fields. Read separately from screen.* because these reflect the *browser
 * window* state, not the device — and they shift with zoom while screen.* stays
 * fixed. Three independent zoom estimates are recorded so divergence between
 * them flags a tampered environment.
 */
function collectViewport(
  dpr: number,
  screenWidth: number,
): Partial<ScreenFingerprint> {
  try {
    const innerWidth = topWin.innerWidth;
    const innerHeight = topWin.innerHeight;
    const outerWidth = topWin.outerWidth;
    const outerHeight = topWin.outerHeight;

    let visualViewportScale: number | null = null;
    let visualViewportWidth: number | null = null;
    let visualViewportHeight: number | null = null;
    try {
      const vv = topWin.visualViewport;
      if (vv) {
        visualViewportScale = vv.scale ?? null;
        visualViewportWidth = vv.width ?? null;
        visualViewportHeight = vv.height ?? null;
      }
    } catch {}

    let orientation: string | null = null;
    try {
      orientation = topWin.screen?.orientation?.type ?? null;
    } catch {}

    const clientWidth = topWin.document?.documentElement?.clientWidth ?? 0;
    const outerInnerRatio =
      outerWidth && innerWidth ? outerWidth / innerWidth : null;
    const screenClientRatio =
      screenWidth && clientWidth ? screenWidth / clientWidth : null;

    return {
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      visualViewportScale,
      visualViewportWidth,
      visualViewportHeight,
      orientation,
      zoomEstimate: {
        dpr,
        outerInnerRatio,
        screenClientRatio,
      },
    };
  } catch {
    return {};
  }
}

function detectScreenLies(): boolean {
  return !!(
    lieProps['Screen.width'] ||
    lieProps['Screen.height'] ||
    lieProps['Screen.availWidth'] ||
    lieProps['Screen.availHeight'] ||
    lieProps['Screen.colorDepth'] ||
    lieProps['Screen.pixelDepth']
  );
}

/**
 * Collects screen fingerprint data.
 *
 * Gathers screen dimensions, color depth, and touch capability while
 * performing validation against CSS media queries to detect spoofing.
 *
 * The validation approach differs by browser:
 * - Firefox with high DPR uses floating point dimensions, so we skip
 *   matchMedia validation (would produce false positives)
 * - WebKit sometimes returns mismatched DPR, so we skip that validation
 *
 * @param log - Whether to log test results (default: true)
 * @returns Screen fingerprint data or undefined on error
 */
export default async function getScreen(
  log = true,
): Promise<ScreenFingerprint | undefined> {
  try {
    const timer = createTimer();
    timer.start();

    // Check for API tampering
    let lied = detectScreenLies();

    // Get screen dimensions from the topmost same-origin window — see
    // topWin note at module top. WebKit in an iframe reports iframe-size
    // via window.screen; reaching up fixes it.
    const s = topWin.screen || {};
    const { width, height, availWidth, availHeight, colorDepth, pixelDepth } =
      s;

    // Validate dimensions against media queries (with browser exceptions)
    const dpr = topWin.devicePixelRatio || 0;
    const firefoxWithHighDPR = IS_GECKO && dpr !== 1;

    if (!firefoxWithHighDPR) {
      // Firefox with high DPR uses floating point dimensions
      const matchMediaLie = !validateScreenDimensions(width, height);
      if (matchMediaLie) {
        lied = true;
        documentLie('Screen', 'failed matchMedia');
      }
    }

    // Validate DPR (skip on WebKit due to inconsistencies)
    const hasLiedDPR = !validateDevicePixelRatio(dpr);
    if (!IS_WEBKIT && hasLiedDPR) {
      lied = true;
      documentLie('Window.devicePixelRatio', 'lied dpr');
    }

    // Independent DPR discovery via max-resolution binary search.
    // Emitted raw so the server can compare against `dpr` regardless of
    // what client-side validation concludes. WebKit has the same
    // matchMedia/DPR quirks that gate the strict check above; the
    // server is expected to apply the same exemption when scoring drift.
    const dprFromMedia = searchDevicePixelRatio();

    // Flag missing taskbar on large screens as suspicious
    if (hasNoTaskbar(width, height, availWidth, availHeight)) {
      LowerEntropy.SCREEN = true;
    }

    const data: ScreenFingerprint = {
      width,
      height,
      availWidth,
      availHeight,
      colorDepth,
      pixelDepth,
      touch: hasTouch(),
      lied,
      dprFromMedia,
      ...collectViewport(dpr, width),
    };

    log && logTestResult({ time: timer.stop(), test: 'screen', passed: true });
    return data;
  } catch (error) {
    log && logTestResult({ test: 'screen', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
