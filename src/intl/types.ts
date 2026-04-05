/**
 * Intl Fingerprinting Types
 *
 * Type definitions for internationalization API fingerprinting.
 */

/**
 * Intl fingerprint result.
 *
 * Contains formatted strings from various Intl APIs that reveal
 * the user's locale configuration.
 */
export interface IntlFingerprint {
  /**
   * Formatted date/time string.
   * Example: "July 1970 Pacific Daylight Time" (en-US)
   *
   * The exact format varies by locale and reveals:
   * - Month name in locale's language
   * - Timezone name in locale's language
   */
  dateTimeFormat: string | undefined;

  /**
   * Display name for 'en-US' language.
   * Example: "American English" (en-US), "anglais américain" (fr-FR)
   *
   * Different locales describe languages differently.
   */
  displayNames: string | undefined;

  /**
   * Formatted list with disjunction.
   * Example: "0 or 1" (en-US), "0 o 1" (es-ES)
   *
   * Reveals the locale's word for "or".
   */
  listFormat: string | undefined;

  /**
   * Compact number format.
   * Example: "21 million" (en-US), "21 M" (fr-FR)
   *
   * Different locales use different compact notations.
   */
  numberFormat: string | undefined;

  /**
   * Plural category for number 1.
   * Example: "one" (most locales), varies for languages with complex plural rules
   *
   * While most locales return "one", this validates the API works.
   */
  pluralRules: string | undefined;

  /**
   * Relative time format for "in 1 year".
   * Example: "next year" (en-US), "l'année prochaine" (fr-FR)
   *
   * Reveals locale-specific relative time expressions.
   */
  relativeTimeFormat: string | undefined;

  /**
   * Resolved locale from all Intl constructors.
   * Example: "en-US" or "en-US,en-US,en-US,en-US,en-US,en-US,en-US"
   *
   * If all constructors resolve to the same locale, only one is shown.
   * Inconsistencies might indicate partial spoofing.
   */
  locale: string;

  /** Whether tampering was detected in Intl APIs */
  lied: number | false;
}
