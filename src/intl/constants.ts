/**
 * Intl Fingerprinting Constants
 *
 * Configuration values for internationalization API testing.
 */

/**
 * List of Intl constructors to probe for locale information.
 *
 * Each constructor's resolvedOptions() should return the same locale
 * if the browser is consistent. Inconsistencies may indicate spoofing.
 */
export const INTL_CONSTRUCTORS = [
  'Collator',
  'DateTimeFormat',
  'DisplayNames',
  'ListFormat',
  'NumberFormat',
  'PluralRules',
  'RelativeTimeFormat',
] as const;

/**
 * Reference timestamp for DateTimeFormat testing.
 *
 * July 15, 1970 00:00:00 UTC (963644400000 ms since epoch)
 * This date is used because:
 * 1. It's a historical date, avoiding DST edge cases
 * 2. July ensures we get summer timezone names
 * 3. The formatted output varies significantly by locale
 */
export const REFERENCE_TIMESTAMP = 963644400000;
