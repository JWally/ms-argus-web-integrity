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
}
