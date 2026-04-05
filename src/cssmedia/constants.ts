/**
 * CSS Media Query Fingerprinting Constants
 *
 * Media feature names and query configurations.
 */

/**
 * Media feature names to test.
 *
 * These CSS media features reveal user preferences and device capabilities.
 */
export const MEDIA_FEATURES = [
  'prefers-reduced-motion',
  'prefers-color-scheme',
  'monochrome',
  'inverted-colors',
  'forced-colors',
  'any-hover',
  'hover',
  'any-pointer',
  'pointer',
  'device-aspect-ratio',
  'device-screen',
  'display-mode',
  'color-gamut',
  'orientation',
] as const;

/**
 * Screen dimension search range length.
 *
 * When probing for screen dimensions via CSS media queries,
 * we search in chunks of this size.
 */
export const SCREEN_QUERY_RANGE = 1000;

/**
 * Maximum number of search iterations for screen dimensions.
 *
 * Searches up to SCREEN_QUERY_RANGE * MAX_SCREEN_SEARCH_ITERATIONS pixels.
 * 10 iterations covers screens up to 10,000 pixels.
 */
export const MAX_SCREEN_SEARCH_ITERATIONS = 10;
