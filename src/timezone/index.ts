/**
 * Timezone Fingerprinting Module
 *
 * Extracts timezone information for fingerprinting and location estimation.
 * The timezone is a valuable fingerprinting signal because:
 *
 * 1. **Geographic Correlation**: Timezone directly reveals approximate
 *    longitude and often the country/region of the user.
 *
 * 2. **Hard to Spoof Correctly**: While the timezone can be changed in OS
 *    settings, consistently spoofing all timezone-related APIs is difficult.
 *
 * Note: Historical offset validation for lie detection has been moved to
 * server-side analysis. See __ideas__/TODO-server-side-analysis.md for implementation details.
 *
 * @see https://arkenfox.github.io/TZP - Timezone fingerprinting project
 * @module timezone
 */

import { captureError } from '../errors';
import { lieProps } from '../lies';
import { createTimer, logTestResult } from '../utils/helpers';
import { expectFailure } from '../utils/expected-failure';

import { MS_PER_MINUTE } from './constants';
import type { TimezoneFingerprint } from './types';

/**
 * Computes timezone offset using date parsing differences.
 *
 * This alternative method calculates offset by comparing how the browser
 * parses the same date in local vs UTC format. The difference reveals
 * the timezone offset without calling getTimezoneOffset().
 *
 * This cross-validation helps detect tampering if someone hooks
 * Date.getTimezoneOffset() but forgets to also hook date parsing.
 *
 * @returns Timezone offset in minutes
 */
function getTimezoneOffset(): number {
  // Get current date components from JSON stringification (which uses UTC)
  const [year, month, day] = JSON.stringify(new Date()).slice(1, 11).split('-');

  // Parse as local date (M/D/Y format)
  const dateString = `${month}/${day}/${year}`;
  // Parse as UTC date (ISO format)
  const dateStringUTC = `${year}-${month}-${day}`;

  // The difference between local and UTC parsing reveals the offset
  const now = +new Date(dateString);
  const utc = +new Date(dateStringUTC);
  const offset = +((now - utc) / MS_PER_MINUTE);

  // Use bitwise OR to truncate to integer (faster than Math.floor)
  return ~~offset;
}

/**
 * Formats a timezone identifier for display.
 *
 * Converts IANA format "America/Los_Angeles" to
 * human-readable "America, Los Angeles".
 *
 * @param location - IANA timezone identifier
 * @returns Formatted location string
 */
function formatLocation(location: string): string {
  try {
    return location.replace(/_/g, ' ').split('/').join(', ');
  } catch {
    expectFailure('formatLocation', 'String manipulation failed');
    return location;
  }
}

/**
 * Extracts timezone abbreviation from Date.toString().
 *
 * The Date.toString() method includes the timezone in parentheses:
 * "Sat Jan 01 2022 00:00:00 GMT-0800 (Pacific Standard Time)"
 *
 * This extracts "Pacific Standard Time" from the string.
 *
 * @param date - Date object to extract timezone from
 * @returns Timezone abbreviation or name
 */
function extractTimezoneAbbreviation(date: Date): string {
  const notWithinParentheses = /.*\(|\).*/g;
  return ('' + date).replace(notWithinParentheses, '');
}

/**
 * Checks for lie detection on timezone-related APIs.
 *
 * @returns Lie array or false if no tampering detected
 */
function detectTimezoneLies(): number | false {
  return (
    lieProps['Date.getTimezoneOffset'] ||
    lieProps['Intl.DateTimeFormat.resolvedOptions'] ||
    lieProps['Intl.RelativeTimeFormat.resolvedOptions'] ||
    false
  );
}

/**
 * Collects timezone fingerprint data.
 *
 * Gathers timezone signals for fingerprinting:
 * - Timezone abbreviation from Date.toString()
 * - IANA timezone from Intl.DateTimeFormat
 * - Direct and computed timezone offsets
 *
 * Note: Historical offset validation for lie detection has been moved to
 * server-side. The server can compare offset with IP geolocation and other
 * signals more effectively than client-side binary search.
 *
 * @returns Timezone fingerprint data or undefined on error
 */
export default async function getTimezone(): Promise<
  TimezoneFingerprint | undefined
> {
  try {
    const timer = createTimer();
    timer.start();

    // Check for API tampering
    const lied = detectTimezoneLies();

    // Get browser-reported timezone
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();

    // Collect timezone data (validation moved to server-side)
    const data: TimezoneFingerprint = {
      // Timezone name from Date.toString() (e.g., "Pacific Standard Time")
      zone: extractTimezoneAbbreviation(new Date()),

      // Human-readable IANA location (e.g., "America, Los Angeles")
      location: formatLocation(timeZone),

      // Direct offset from Date API
      offset: new Date().getTimezoneOffset(),

      // Computed offset via date parsing (cross-validation)
      offsetComputed: getTimezoneOffset(),

      // Tampering detection
      lied,
    };

    logTestResult({ time: timer.stop(), test: 'timezone', passed: true });
    return data;
  } catch (error) {
    logTestResult({ test: 'timezone', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
