/**
 * CSS Media Query Fingerprinting Types
 *
 * Type definitions for media query-based fingerprinting.
 */

/**
 * Media query feature values.
 *
 * Maps CSS media feature names to their detected values.
 */
export interface MediaFeatures {
  /** Reduced motion preference: 'no-preference' | 'reduce' */
  'prefers-reduced-motion': string | undefined;
  /** Color scheme preference: 'light' | 'dark' */
  'prefers-color-scheme': string | undefined;
  /** Monochrome display: 'monochrome' | 'non-monochrome' */
  monochrome: string | undefined;
  /** Inverted colors setting: 'inverted' | 'none' */
  'inverted-colors': string | undefined;
  /** Forced colors mode: 'active' | 'none' */
  'forced-colors': string | undefined;
  /** Any available hover capability: 'hover' | 'none' */
  'any-hover': string | undefined;
  /** Primary hover capability: 'hover' | 'none' */
  hover: string | undefined;
  /** Any available pointer precision: 'fine' | 'coarse' | 'none' */
  'any-pointer': string | undefined;
  /** Primary pointer precision: 'fine' | 'coarse' | 'none' */
  pointer: string | undefined;
  /** Device aspect ratio (e.g., '16/9') */
  'device-aspect-ratio': string | undefined;
  /** Device screen dimensions (e.g., '1920 x 1080') */
  'device-screen': string | undefined;
  /** Display mode: 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser' */
  'display-mode': string | undefined;
  /** Color gamut: 'srgb' | 'p3' | 'rec2020' */
  'color-gamut': string | undefined;
  /** Screen orientation: 'landscape' | 'portrait' */
  orientation: string | undefined;
}

/**
 * Screen dimensions from media query probing.
 */
export interface ScreenQuery {
  width: number;
  height: number;
}

/**
 * CSS Media fingerprint result.
 */
export interface CSSMediaFingerprint {
  /** Media features detected via CSS custom properties */
  mediaCSS: MediaFeatures;
  /** Media features detected via matchMedia() API */
  matchMediaCSS: MediaFeatures;
  /** Screen dimensions from CSS media query probing */
  screenQuery: ScreenQuery;
}
