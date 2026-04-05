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

/**
 * Detect private mode from delta-pass results.
 *
 * Safari private mode adds deterministic per-page canvas noise: both
 * within-page runs produce identical noisy output, so the delta detection
 * can't strip it. Regular Safari's noise is probabilistic (varies between
 * runs), so delta successfully strips it.
 *
 * Signal: canvas reports noise (lied=true) but delta found zero differences.
 */
export function detectPrivateFromDelta(opts: {
  browser: string;
  canvasLied: boolean;
  canvasDeltaDropped: string[];
  hasSecondRun: boolean;
}): { isPrivate: boolean; confidence: number; signal: string } | null {
  if (!opts.hasSecondRun) return null;

  // Safari-specific: deterministic per-page noise = private mode
  if (
    opts.browser === 'Safari' &&
    opts.canvasLied &&
    opts.canvasDeltaDropped.length === 0
  ) {
    return {
      isPrivate: true,
      confidence: 0.9,
      signal: 'safari-deterministic-canvas-noise',
    };
  }

  return null;
}

export default detectIncognito;
