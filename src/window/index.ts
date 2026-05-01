/**
 * Window Prefix Count Module
 *
 * Counts vendor-prefixed properties on the window object.
 * moz prefixes = Gecko (Firefox), webkit = Blink/WebKit (Chrome/Safari),
 * apple = WebKit (Safari). These counts are engine-stable and provide
 * an independent engine discrimination signal.
 *
 * The total key count is volatile (extensions inject globals), but
 * prefix counts are stable — extensions don't add mozSomething to window.
 *
 * @module window
 */

import { captureError } from '../errors';
import { createTimer, logTestResult } from '../utils/timing';

export interface WindowPrefixFingerprint {
  moz: number;
  webkit: number;
  apple: number;
  total: number;
}

export default function getWindowPrefixes():
  | WindowPrefixFingerprint
  | undefined {
  try {
    const timer = createTimer();
    timer.start();

    const keys = Object.getOwnPropertyNames(window);
    let moz = 0;
    let webkit = 0;
    let apple = 0;

    for (const k of keys) {
      if (/^[Mm]oz/.test(k)) moz++;
      else if (/^[Ww]eb[Kk]it/.test(k)) webkit++;
      else if (/^[Aa]pple/.test(k)) apple++;
    }

    logTestResult({
      time: timer.stop(),
      test: 'window prefixes',
      passed: true,
    });
    return { moz, webkit, apple, total: keys.length };
  } catch (error) {
    logTestResult({ test: 'window prefixes', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
