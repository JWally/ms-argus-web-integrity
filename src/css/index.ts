/**
 * CSS Key Count Module
 *
 * Counts the number of CSS properties available via getComputedStyle.
 * This varies by browser engine and version — Chrome 146 has ~590 keys,
 * Firefox 148 has ~360, Safari 18 has ~400. Server-side baselines learn
 * the expected count per browser version and flag outliers.
 *
 * @module css
 */

import { captureError } from '../errors';
import { createTimer, logTestResult } from '../utils/timing';

export interface CSSKeyCountFingerprint {
  keyCount: number;
}

export default function getCSSKeyCount(): CSSKeyCountFingerprint | undefined {
  try {
    const timer = createTimer();
    timer.start();

    const style = getComputedStyle(document.body);
    const keyCount = style.length;

    logTestResult({ time: timer.stop(), test: 'css key count', passed: true });
    return { keyCount };
  } catch (error) {
    logTestResult({ test: 'css key count', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
