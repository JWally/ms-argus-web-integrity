/**
 * Fonts Fingerprinting Module
 *
 * Two complementary measurements:
 *
 * 1. **Installed-font probe** — classic comparison-against-baseline.
 *    For each candidate font, render a fixed string in `${font},
 *    monospace`. If the measured width differs from baseline
 *    `monospace`, the candidate font IS installed (browser used it
 *    instead of falling back to monospace).
 *
 * 2. **Generic-family pixel widths + heights** — for `{default, serif,
 *    sans-serif, monospace, cursive, fantasy}`, measure the width and
 *    height of a fixed probe string. Captures the actual font stack
 *    the engine resolved without enumerating individual font names.
 *    Resistant to font-blocker extensions that target the
 *    installed-font probe pattern.
 *
 * Server cross-checks:
 *   - `installed` vs claimed-OS expected font set (Windows: Segoe UI,
 *     Calibri, Cambria, Tahoma; macOS: SF Pro, Helvetica Neue, Avenir,
 *     Lucida Grande; Linux: DejaVu Sans, Liberation, Ubuntu, Noto)
 *   - `genericWidths` vs engine-version baselines (typography stack
 *     differs across Chrome / Firefox / Safari major versions)
 *
 * @module fonts
 */

import { captureError } from '../errors';
import { createTimer, logTestResult } from '../utils/helpers';
import type { FontsFingerprint } from './types';

// Probe string used by Castle (`measureText('mmmmmmmmmmlli')`) — a
// mix of wide and narrow glyphs that produces high width variance
// across font stacks.
const PROBE_TEXT = 'mmmmmmmmmmlli';

const GENERIC_FAMILIES = [
  'default',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
];

// Candidate font list — biased toward OS-distinguishing names. Each
// is exactly ONE font; the probe checks whether the browser USED that
// font (vs fell back to monospace).
const CANDIDATES = [
  // Windows-typical
  'Segoe UI',
  'Calibri',
  'Cambria',
  'Tahoma',
  'Consolas',
  'Microsoft Sans Serif',
  'Comic Sans MS',
  // macOS-typical
  'Helvetica Neue',
  'SF Pro Text',
  'Avenir',
  'Lucida Grande',
  'Menlo',
  'Monaco',
  // Linux-typical
  'DejaVu Sans',
  'Liberation Sans',
  'Liberation Serif',
  'Liberation Mono',
  'Ubuntu',
  'Noto Sans',
  'Noto Color Emoji',
  // Cross-platform
  'Arial',
  'Verdana',
  'Times New Roman',
  'Courier New',
  'Georgia',
  // Less-common (helps with version drift)
  'Palatino Linotype',
  'Trebuchet MS',
  'Garamond',
  'Impact',
  'Lucida Console',
  'Symbol',
  'PMingLiU',
  'MS Gothic',
];

/**
 * Use a hidden div with a fixed character set rendered in each font;
 * measure the bounding rect. Compare to the baseline (the same string
 * rendered in `monospace` alone) — if the measured width differs, the
 * candidate font is present.
 *
 * Span-based offsetWidth is used (not canvas.measureText) because it
 * exercises the layout engine's font fallback, which is what we want
 * — font blockers often target only the canvas measureText path.
 */
function probeInstalled(): string[] {
  if (typeof document === 'undefined' || !document.body) return [];

  const container = document.createElement('div');
  container.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:72px;';
  document.body.appendChild(container);

  try {
    // Baseline widths per generic family
    const baseline: Record<string, number> = {};
    for (const fam of ['monospace', 'serif', 'sans-serif']) {
      const span = document.createElement('span');
      span.textContent = PROBE_TEXT;
      span.style.fontFamily = fam;
      container.appendChild(span);
      baseline[fam] = span.offsetWidth;
    }

    const found: string[] = [];
    for (const name of CANDIDATES) {
      let detected = false;
      // If forcing the candidate font produces a different width than
      // ANY baseline generic family, the candidate font is installed.
      for (const fam of ['monospace', 'serif', 'sans-serif']) {
        const span = document.createElement('span');
        span.textContent = PROBE_TEXT;
        span.style.fontFamily = `"${name}", ${fam}`;
        container.appendChild(span);
        if (span.offsetWidth !== baseline[fam]) {
          detected = true;
          break;
        }
      }
      if (detected) found.push(name);
    }
    return found;
  } finally {
    container.remove();
  }
}

function probeGenericMetrics(): {
  widths: Record<string, number>;
  heights: Record<string, number>;
} {
  const widths: Record<string, number> = {};
  const heights: Record<string, number> = {};

  if (typeof document === 'undefined' || !document.body) {
    return { widths, heights };
  }

  const container = document.createElement('div');
  container.style.cssText =
    'position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:16px;line-height:normal;';
  document.body.appendChild(container);

  try {
    for (const fam of GENERIC_FAMILIES) {
      const span = document.createElement('span');
      span.textContent = PROBE_TEXT;
      // 'default' = let browser pick (no font-family)
      if (fam !== 'default') span.style.fontFamily = fam;
      container.appendChild(span);
      const rect = span.getBoundingClientRect();
      widths[fam] = Math.round(rect.width * 1000) / 1000;
      heights[fam] = Math.round(rect.height * 1000) / 1000;
    }
  } finally {
    container.remove();
  }

  return { widths, heights };
}

export default function getFonts(): FontsFingerprint | undefined {
  try {
    const timer = createTimer();
    timer.start();

    if (typeof document === 'undefined') {
      return {
        available: false,
        installed: [],
        genericWidths: {},
        genericHeights: {},
      };
    }

    const installed = probeInstalled();
    const { widths, heights } = probeGenericMetrics();

    logTestResult({ time: timer.stop(), test: 'fonts', passed: true });
    return {
      available: true,
      installed,
      genericWidths: widths,
      genericHeights: heights,
    };
  } catch (error) {
    logTestResult({ test: 'fonts', passed: false });
    captureError(error as Error);
    return {
      available: false,
      installed: [],
      genericWidths: {},
      genericHeights: {},
    };
  }
}
