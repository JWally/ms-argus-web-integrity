/**
 * Internationalization (Intl) Fingerprinting Module
 *
 * Extracts locale information through the Intl API for fingerprinting.
 * The Intl API is a valuable fingerprinting signal because:
 *
 * 1. **Locale Detection**: The browser's default locale reveals the user's
 *    language preference and often their geographic region.
 *
 * 2. **Formatting Variations**: Date, number, and list formatting varies
 *    significantly between locales, providing unique strings.
 *
 * 3. **Consistency Validation**: All Intl constructors should resolve to
 *    the same locale. Inconsistencies suggest partial spoofing.
 *
 * 4. **Hard to Spoof Completely**: Spoofing requires overriding many APIs
 *    consistently. Most spoofers miss some Intl methods.
 *
 * The module probes multiple Intl APIs with specific inputs designed to
 * produce locale-specific outputs that vary between users.
 *
 * @module intl
 */

import { caniuse, captureError } from '../errors';
import { lieProps } from '../lies';
import { createTimer, queueEvent, logTestResult } from '../utils/helpers';
import { expectFailure } from '../utils/expected-failure';
import { INTL_CONSTRUCTORS, REFERENCE_TIMESTAMP } from './constants';
import type { IntlFingerprint } from './types';

/**
 * Extracts locale from all Intl constructors.
 *
 * Probes each Intl constructor's resolvedOptions() to get its locale.
 * All constructors should return the same locale if the browser is
 * configured consistently. Different locales might indicate:
 * - Partial locale spoofing
 * - Browser bug
 * - Extension interference
 *
 * @param intl - The global Intl object
 * @returns Array of unique locales (usually just one)
 */
function getLocale(intl: typeof Intl): string[] {
  const locales: string[] = INTL_CONSTRUCTORS.reduce(
    (acc: string[], name: string) => {
      try {
        // @ts-expect-error - Dynamic constructor access
        const obj = new intl[name]();
        if (!obj) return acc;

        const { locale } = obj.resolvedOptions() || {};
        return locale ? [...acc, locale] : acc;
      } catch {
        expectFailure('getLocale', `Intl.${name} constructor failed`);
        return acc;
      }
    },
    [],
  );

  return [...new Set(locales)];
}

/**
 * Formats a date to reveal locale-specific patterns.
 *
 * Uses a historical date (July 1970) with long month and timezone names.
 * The output varies by locale:
 * - "July 1970 Pacific Daylight Time" (en-US)
 * - "juillet 1970 heure avancée du Pacifique" (fr-FR)
 *
 * @returns Formatted date string or undefined if API unavailable
 */
function getDateTimeFormat(): string | undefined {
  return caniuse(() => {
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      timeZoneName: 'long',
    }).format(REFERENCE_TIMESTAMP);
  });
}

/**
 * Gets the display name for American English.
 *
 * Different locales describe "en-US" differently:
 * - "American English" (en-US)
 * - "anglais américain" (fr-FR)
 * - "inglés estadounidense" (es-ES)
 *
 * @returns Display name string or undefined if API unavailable
 */
function getDisplayNames(): string | undefined {
  return caniuse(() => {
    return new Intl.DisplayNames(undefined, {
      type: 'language',
    }).of('en-US');
  });
}

/**
 * Formats a list with disjunction ("or").
 *
 * The word for "or" varies by locale:
 * - "0 or 1" (en-US)
 * - "0 o 1" (es-ES)
 * - "0 ou 1" (fr-FR)
 *
 * @returns Formatted list string or undefined if API unavailable
 */
function getListFormat(): string | undefined {
  return caniuse(() => {
    // @ts-expect-error - ListFormat may not be in all TypeScript versions
    return new Intl.ListFormat(undefined, {
      style: 'long',
      type: 'disjunction',
    }).format(['0', '1']);
  });
}

/**
 * Formats a large number in compact notation.
 *
 * Different locales use different compact formats:
 * - "21 million" (en-US)
 * - "21 M" (fr-FR)
 * - "2100万" (ja-JP)
 *
 * @returns Formatted number string or undefined if API unavailable
 */
function getNumberFormat(): string | undefined {
  return caniuse(() => {
    return new Intl.NumberFormat(undefined, {
      notation: 'compact',
      compactDisplay: 'long',
    }).format(21000000);
  });
}

/**
 * Gets the plural category for number 1.
 *
 * While most locales return "one" for 1, languages with complex plural
 * rules (like Russian, Arabic) may differ. This validates the API works.
 *
 * @returns Plural category string or undefined if API unavailable
 */
function getPluralRules(): string | undefined {
  return caniuse(() => {
    return new Intl.PluralRules().select(1);
  });
}

/**
 * Formats relative time for "next year".
 *
 * Different locales express "in 1 year" differently:
 * - "next year" (en-US)
 * - "l'année prochaine" (fr-FR)
 * - "el próximo año" (es-ES)
 *
 * @returns Relative time string or undefined if API unavailable
 */
function getRelativeTimeFormat(): string | undefined {
  return caniuse(() => {
    return new Intl.RelativeTimeFormat(undefined, {
      localeMatcher: 'best fit',
      numeric: 'auto',
      style: 'long',
    }).format(1, 'year');
  });
}

/**
 * Checks for lie detection on Intl-related APIs.
 *
 * Monitors resolvedOptions() on all Intl constructors for tampering.
 *
 * @returns Lie array or false if no tampering detected
 */
function detectIntlLies(): number | false {
  return (
    lieProps['Intl.Collator.resolvedOptions'] ||
    lieProps['Intl.DateTimeFormat.resolvedOptions'] ||
    lieProps['Intl.DisplayNames.resolvedOptions'] ||
    lieProps['Intl.ListFormat.resolvedOptions'] ||
    lieProps['Intl.NumberFormat.resolvedOptions'] ||
    lieProps['Intl.PluralRules.resolvedOptions'] ||
    lieProps['Intl.RelativeTimeFormat.resolvedOptions'] ||
    false
  );
}

/**
 * Collects Intl fingerprint data.
 *
 * Probes multiple Intl APIs to extract locale-specific formatted strings.
 * Each API produces output that varies by locale, providing fingerprint signals.
 *
 * @returns Intl fingerprint data or undefined on error
 */
export default async function getIntl(): Promise<IntlFingerprint | undefined> {
  try {
    const timer = createTimer();
    await queueEvent(timer);

    // Check for API tampering
    const lied = detectIntlLies();

    // Collect formatted outputs from various Intl APIs
    const dateTimeFormat = getDateTimeFormat();
    const displayNames = getDisplayNames();
    const listFormat = getListFormat();
    const numberFormat = getNumberFormat();
    const pluralRules = getPluralRules();
    const relativeTimeFormat = getRelativeTimeFormat();

    // Get locale from all constructors
    const locale = getLocale(Intl);

    logTestResult({ time: timer.stop(), test: 'intl', passed: true });

    return {
      dateTimeFormat,
      displayNames,
      listFormat,
      numberFormat,
      pluralRules,
      relativeTimeFormat,
      locale: '' + locale,
      lied,
    };
  } catch (error) {
    logTestResult({ test: 'intl', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
