/**
 * Timezone Detection Constants (Lite Version)
 *
 * This module loads timezone data from external JSON files.
 * No inline data - requires external data files to be served.
 */

import { loadTimezoneCities } from '../utils/data-loader';

/**
 * Historical year used for timezone offset calculations.
 */
export const HISTORICAL_YEAR = 1113;

/**
 * Milliseconds per minute for offset calculations.
 */
export const MS_PER_MINUTE = 60000;

/** Cached timezone cities */
let _timezoneCities: string[] | null = null;

/**
 * Get timezone cities from external data.
 * @throws Error if external data cannot be loaded
 */
export async function getTimezoneCities(): Promise<string[]> {
  if (_timezoneCities) return _timezoneCities;

  _timezoneCities = await loadTimezoneCities();
  return _timezoneCities;
}

/**
 * Placeholder for backwards compatibility - always empty in lite build.
 * Use getTimezoneCities() instead.
 */
export const TIMEZONE_CITIES: readonly string[] = [];
export const TIMEZONE_CITIES_INLINE: readonly string[] = [];
