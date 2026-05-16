/**
 * Screen Fingerprinting Types
 *
 * Type definitions for screen-based fingerprinting.
 */

/**
 * Screen fingerprint result.
 *
 * Contains screen dimensions and characteristics that can fingerprint
 * the user's display configuration.
 */
export interface ScreenFingerprint {
  /** Screen width in CSS pixels */
  width: number;

  /** Screen height in CSS pixels */
  height: number;

  /**
   * Available width excluding OS UI elements.
   * Taskbar/dock reduces this value.
   */
  availWidth: number;

  /**
   * Available height excluding OS UI elements.
   * Taskbar/dock reduces this value.
   */
  availHeight: number;

  /**
   * Color depth in bits per pixel.
   * Typically 24 (8-bit RGB) or 30 (10-bit HDR).
   */
  colorDepth: number;

  /**
   * Pixel depth for images.
   * Usually matches colorDepth.
   */
  pixelDepth: number;

  /** Whether touch events are supported */
  touch: boolean;

  /** Whether tampering was detected */
  lied: boolean;

  /**
   * DPR discovered via `(max-resolution: X dppx)` binary search.
   * Compared server-side against window.devicePixelRatio — a gap means
   * the JS-reported DPR was patched but the CSS engine wasn't.
   */
  dprFromMedia?: number;

  /** Viewport width — page-visible area in CSS px (changes with browser resize and zoom). */
  innerWidth?: number;

  /** Viewport height — page-visible area in CSS px. */
  innerHeight?: number;

  /** Window width including browser chrome in CSS px. outer-inner gap reveals chrome size. */
  outerWidth?: number;

  /** Window height including browser chrome in CSS px. */
  outerHeight?: number;

  /**
   * Mobile pinch-zoom scale via VisualViewport API. Stays at 1 on desktop;
   * non-1 values mean the user is pinch-zoomed.
   */
  visualViewportScale?: number | null;

  /** Visual viewport width — what's actually visible after pinch. */
  visualViewportWidth?: number | null;

  /** Visual viewport height. */
  visualViewportHeight?: number | null;

  /** Screen orientation type ("landscape-primary", "portrait-primary", etc.). */
  orientation?: string | null;

  /**
   * Browser zoom inference from three independent sources. Convergence = high
   * confidence in the zoom level; divergence = tampered or unusual environment.
   * - dpr: window.devicePixelRatio (Chromium multiplies this by zoom factor)
   * - outerInnerRatio: outerWidth / innerWidth (cross-browser approximation)
   * - screenClientRatio: screen.width / documentElement.clientWidth
   */
  zoomEstimate?: {
    dpr: number;
    outerInnerRatio: number | null;
    screenClientRatio: number | null;
  } | null;
}
