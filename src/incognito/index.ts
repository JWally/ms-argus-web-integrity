/**
 * Incognito / Private Browsing Detection Module
 *
 * Uses detectincognitojs for reliable cross-browser private mode detection.
 * - Firefox: ServiceWorker/IndexedDB unavailable in private mode
 * - Safari: openDatabase API disabled in private mode
 * - Chrome 133+: No reliable detection method exists
 *
 * @module incognito
 */

import { detectIncognito as detect } from 'detectincognitojs';
import { createTimer, logTestResult } from '../utils/helpers';

export interface IncognitoResult {
  isPrivate: boolean;
  confidence: number;
  signals: string[];
  browser: string;
  durationMs: number;
}

/**
 * Detects whether the browser is in incognito/private browsing mode
 * using the detectincognitojs library.
 *
 * @returns A promise resolving to an object containing the private mode status,
 *   confidence level, detection signals, browser name, and detection duration.
 */
export async function detectIncognito(): Promise<IncognitoResult> {
  const timer = createTimer();

  try {
    const { isPrivate, browserName } = await detect();
    const durationMs = timer.stop();

    logTestResult({
      time: durationMs,
      test: 'incognito detection',
      passed: true,
    });

    return {
      isPrivate,
      confidence: isPrivate ? 1 : 0,
      signals: isPrivate ? ['detectincognitojs'] : [],
      browser: browserName,
      durationMs,
    };
  } catch {
    const durationMs = timer.stop();

    logTestResult({
      time: durationMs,
      test: 'incognito detection',
      passed: false,
    });

    return {
      isPrivate: false,
      confidence: 0,
      signals: [],
      browser: 'Unknown',
      durationMs,
    };
  }
}

export default detectIncognito;
