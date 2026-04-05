/**
 * Timezone Detection Types
 *
 * Type definitions for timezone fingerprinting.
 *
 * Note: Historical offset validation (locationMeasured, locationEpoch) has been
 * moved to server-side analysis. The client now only collects raw timezone data.
 */

/**
 * Timezone fingerprint result.
 *
 * Contains various representations of the user's timezone for fingerprinting.
 * Lie detection via historical offset comparison is done server-side.
 */
export interface TimezoneFingerprint {
  /**
   * Timezone abbreviation from Date.toString().
   * Example: "PST", "EST", "GMT+0530"
   *
   * Extracted from the parentheses in the date string:
   * "Sat Jan 01 2022 00:00:00 GMT-0800 (Pacific Standard Time)"
   */
  zone: string;

  /**
   * Human-readable location from Intl.DateTimeFormat.resolvedOptions().
   * Example: "America, Los Angeles"
   *
   * This is the IANA timezone identifier with underscores replaced by
   * spaces and slashes replaced by commas.
   */
  location: string;

  /**
   * Current timezone offset in minutes from UTC.
   * Example: -480 for PST (UTC-8), 330 for IST (UTC+5:30)
   *
   * From Date.getTimezoneOffset().
   */
  offset: number;

  /**
   * Computed timezone offset using date manipulation.
   *
   * An alternative method to get timezone offset by comparing
   * local and UTC date parsing. Should match `offset` exactly
   * unless there's tampering.
   */
  offsetComputed: number;

  /**
   * Whether tampering was detected in timezone APIs.
   *
   * Checks for lies in:
   * - Date.getTimezoneOffset
   * - Intl.DateTimeFormat.resolvedOptions
   * - Intl.RelativeTimeFormat.resolvedOptions
   */
  lied: number | false;
}
