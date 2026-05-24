/**
 * Fonts Fingerprinting Types
 */

/**
 * Font fingerprint — installed-font probe plus generic-family height
 * vector. Mirrors FingerprintJS slots s20 (font enumeration) + s51
 * (generic-family metrics).
 *
 * Server-side analysis:
 *   - installed set vs claimed-OS expected fonts (Windows: Segoe UI /
 *     Calibri / Cambria; Mac: SF Pro / Helvetica Neue; Linux: DejaVu /
 *     Liberation / Ubuntu)
 *   - generic-family widths vs known engine baselines
 */
export interface FontsFingerprint {
  /** Could we probe at all (DOM + canvas measurement available)? */
  available: boolean;
  /** Installed-font probe — names of fonts that measured differently from a baseline. */
  installed: string[];
  /**
   * Per-generic-family pixel widths for a fixed probe string.
   * Fpjs s51 emits {default, apple, serif, sans, mono}.
   */
  genericWidths: Record<string, number>;
  /** Per-generic-family pixel heights (line-height when 16px). */
  genericHeights: Record<string, number>;
}
