/**
 * Lie Records Management
 *
 * State management for recording detected API lies. Lies are stored by
 * API name (e.g., "Navigator.userAgent") with an array of lie types
 * describing what was detected (e.g., "failed toString").
 *
 * @module lies/records
 */

import type { LieRecords, LieRecordsManager, LiesResult } from './types';

/**
 * Creates a manager for recording detected lies.
 *
 * This factory function creates an isolated lie records store, making
 * the module testable without global state pollution.
 *
 * @returns Manager object with getRecords and documentLie methods
 */
export function createLieRecords(): LieRecordsManager {
  const records: LieRecords = {};

  return {
    getRecords: () => records,
    documentLie: (name: string, lie: string | string[]) => {
      const isArray = lie instanceof Array;
      if (records[name]) {
        if (isArray) {
          return (records[name] = [...records[name], ...lie]);
        }
        return records[name].push(lie) as unknown as string[];
      }
      return isArray ? (records[name] = lie) : (records[name] = [lie]);
    },
  };
}

/**
 * Default global lie records instance.
 * Used by the main lie detection flow.
 */
export const lieRecords = createLieRecords();

/**
 * Shorthand for documenting lies to the global records.
 */
export const { documentLie } = lieRecords;

/**
 * Gets all recorded lies from the global instance.
 *
 * @returns Object with lie data and total count
 */
export function getLies(): LiesResult {
  const records = lieRecords.getRecords();
  const totalLies = Object.keys(records).reduce((acc, key) => {
    acc += records[key].length;
    return acc;
  }, 0);
  return { data: records, totalLies };
}
