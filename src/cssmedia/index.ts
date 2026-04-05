/**
 * CSS Media Query Fingerprinting Module
 *
 * Detects user preferences and device characteristics via CSS media queries.
 * Media queries provide unique fingerprinting signals because:
 *
 * 1. **User Preferences**: Reveals accessibility settings like reduced motion,
 *    color scheme (dark/light mode), and forced colors.
 *
 * 2. **Device Capabilities**: Detects pointer type (touch vs mouse), hover
 *    capability, and screen characteristics.
 *
 * 3. **Cross-Validation**: Tests both matchMedia() API and CSS-based detection.
 *    Inconsistencies between methods indicate spoofing.
 *
 * 4. **Screen Probing**: Uses CSS media queries to determine actual screen
 *    dimensions, bypassing JavaScript Screen API tampering.
 *
 * @module cssmedia
 */

import { captureError } from '../errors';
import { PHANTOM_DARKNESS } from '../lies';
import { createTimer, logTestResult, LowerEntropy } from '../utils/helpers';
import { SCREEN_QUERY_RANGE, MAX_SCREEN_SEARCH_ITERATIONS } from './constants';
import type { MediaFeatures, ScreenQuery, CSSMediaFingerprint } from './types';

/**
 * Computes the greatest common divisor of two numbers.
 *
 * Used to reduce aspect ratios to their simplest form.
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Calculates the aspect ratio of screen dimensions.
 *
 * @param width - Screen width in pixels
 * @param height - Screen height in pixels
 * @returns Aspect ratio string (e.g., "16/9")
 */
function getAspectRatio(width: number, height: number): string {
  const r = gcd(width, height);
  return `${width / r}/${height / r}`;
}

/**
 * Probes for a device dimension using CSS media queries.
 *
 * Creates CSS rules for a range of pixel values and checks which one matches.
 * This technique bypasses JavaScript API spoofing since it relies on the
 * browser's CSS engine to evaluate the media query.
 *
 * @param body - Body element to inject CSS into
 * @param type - Dimension type ('width' or 'height')
 * @param rangeStart - Starting pixel value
 * @param rangeLen - Number of pixels to test
 * @returns Matched pixel value or empty string
 */
function queryDimension(
  body: HTMLElement,
  type: string,
  rangeStart: number,
  rangeLen: number,
): string {
  // Generate CSS rules for each pixel in range
  const html = [...Array(rangeLen)]
    .map((_, i) => {
      const px = i + rangeStart;
      return `@media(device-${type}:${px}px){body{--device-${type}:${px};}}`;
    })
    .join('');

  body.innerHTML = `<style>${html}</style>`;

  // Check which value matched
  const style = getComputedStyle(body);
  return style.getPropertyValue(`--device-${type}`).trim();
}

/**
 * Probes for actual screen dimensions using CSS media queries.
 *
 * First tries the reported dimensions, then searches in ranges if no match.
 * This detects screen dimension spoofing where JavaScript reports different
 * values than what CSS sees.
 *
 * @param body - Body element for CSS injection
 * @param width - Reported screen width
 * @param height - Reported screen height
 * @returns Actual screen dimensions from CSS
 */
function getScreenMedia(
  body: HTMLElement,
  width: number,
  height: number,
): ScreenQuery {
  // First try the reported dimensions
  let widthMatch = queryDimension(body, 'width', width, 1);
  let heightMatch = queryDimension(body, 'height', height, 1);

  if (widthMatch && heightMatch) {
    return { width, height };
  }

  // Search in ranges if reported dimensions don't match
  for (let i = 0; i < MAX_SCREEN_SEARCH_ITERATIONS; i++) {
    if (!widthMatch) {
      widthMatch = queryDimension(
        body,
        'width',
        i * SCREEN_QUERY_RANGE,
        SCREEN_QUERY_RANGE,
      );
    }
    if (!heightMatch) {
      heightMatch = queryDimension(
        body,
        'height',
        i * SCREEN_QUERY_RANGE,
        SCREEN_QUERY_RANGE,
      );
    }
    if (widthMatch && heightMatch) break;
  }

  return { width: +widthMatch, height: +heightMatch };
}

/**
 * Detects media features using matchMedia() API.
 *
 * Tests each media feature by calling matchMedia() with different values.
 *
 * @param win - Window object to use
 * @param deviceAspectRatio - Computed aspect ratio
 * @param width - Screen width
 * @param height - Screen height
 * @returns Detected media feature values
 */
function getMatchMediaFeatures(
  win: Window,
  deviceAspectRatio: string,
  width: number,
  height: number,
): MediaFeatures {
  return {
    'prefers-reduced-motion': win.matchMedia(
      '(prefers-reduced-motion: no-preference)',
    ).matches
      ? 'no-preference'
      : win.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'reduce'
        : undefined,
    // Use main window for color scheme (more reliable)
    'prefers-color-scheme': matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : undefined,
    monochrome: win.matchMedia('(monochrome)').matches
      ? 'monochrome'
      : win.matchMedia('(monochrome: 0)').matches
        ? 'non-monochrome'
        : undefined,
    'inverted-colors': win.matchMedia('(inverted-colors: inverted)').matches
      ? 'inverted'
      : win.matchMedia('(inverted-colors: none)').matches
        ? 'none'
        : undefined,
    'forced-colors': win.matchMedia('(forced-colors: none)').matches
      ? 'none'
      : win.matchMedia('(forced-colors: active)').matches
        ? 'active'
        : undefined,
    'any-hover': win.matchMedia('(any-hover: hover)').matches
      ? 'hover'
      : win.matchMedia('(any-hover: none)').matches
        ? 'none'
        : undefined,
    hover: win.matchMedia('(hover: hover)').matches
      ? 'hover'
      : win.matchMedia('(hover: none)').matches
        ? 'none'
        : undefined,
    'any-pointer': win.matchMedia('(any-pointer: fine)').matches
      ? 'fine'
      : win.matchMedia('(any-pointer: coarse)').matches
        ? 'coarse'
        : win.matchMedia('(any-pointer: none)').matches
          ? 'none'
          : undefined,
    pointer: win.matchMedia('(pointer: fine)').matches
      ? 'fine'
      : win.matchMedia('(pointer: coarse)').matches
        ? 'coarse'
        : win.matchMedia('(pointer: none)').matches
          ? 'none'
          : undefined,
    'device-aspect-ratio': win.matchMedia(
      `(device-aspect-ratio: ${deviceAspectRatio})`,
    ).matches
      ? deviceAspectRatio
      : undefined,
    'device-screen': win.matchMedia(
      `(device-width: ${width}px) and (device-height: ${height}px)`,
    ).matches
      ? `${width} x ${height}`
      : undefined,
    'display-mode': win.matchMedia('(display-mode: fullscreen)').matches
      ? 'fullscreen'
      : win.matchMedia('(display-mode: standalone)').matches
        ? 'standalone'
        : win.matchMedia('(display-mode: minimal-ui)').matches
          ? 'minimal-ui'
          : win.matchMedia('(display-mode: browser)').matches
            ? 'browser'
            : undefined,
    'color-gamut': win.matchMedia('(color-gamut: rec2020)').matches
      ? 'rec2020'
      : win.matchMedia('(color-gamut: p3)').matches
        ? 'p3'
        : win.matchMedia('(color-gamut: srgb)').matches
          ? 'srgb'
          : undefined,
    // Use main window for orientation
    orientation: matchMedia('(orientation: landscape)').matches
      ? 'landscape'
      : matchMedia('(orientation: portrait)').matches
        ? 'portrait'
        : undefined,
  };
}

/**
 * Detects media features using CSS custom properties.
 *
 * Injects CSS rules that set custom properties based on media queries,
 * then reads the computed values. This is an alternative to matchMedia()
 * that may reveal inconsistencies in spoofed browsers.
 *
 * @param body - Body element for CSS injection
 * @param deviceAspectRatio - Computed aspect ratio
 * @param width - Screen width
 * @param height - Screen height
 * @returns Detected media feature values
 */
function getCSSMediaFeatures(
  body: HTMLElement,
  deviceAspectRatio: string,
  width: number,
  height: number,
): MediaFeatures {
  body.innerHTML = `
    <style>
    @media (prefers-reduced-motion: no-preference) {body {--prefers-reduced-motion: no-preference}}
    @media (prefers-reduced-motion: reduce) {body {--prefers-reduced-motion: reduce}}
    @media (prefers-color-scheme: light) {body {--prefers-color-scheme: light}}
    @media (prefers-color-scheme: dark) {body {--prefers-color-scheme: dark}}
    @media (monochrome) {body {--monochrome: monochrome}}
    @media (monochrome: 0) {body {--monochrome: non-monochrome}}
    @media (inverted-colors: inverted) {body {--inverted-colors: inverted}}
    @media (inverted-colors: none) {body {--inverted-colors: none}}
    @media (forced-colors: none) {body {--forced-colors: none}}
    @media (forced-colors: active) {body {--forced-colors: active}}
    @media (any-hover: hover) {body {--any-hover: hover}}
    @media (any-hover: none) {body {--any-hover: none}}
    @media (hover: hover) {body {--hover: hover}}
    @media (hover: none) {body {--hover: none}}
    @media (any-pointer: fine) {body {--any-pointer: fine}}
    @media (any-pointer: coarse) {body {--any-pointer: coarse}}
    @media (any-pointer: none) {body {--any-pointer: none}}
    @media (pointer: fine) {body {--pointer: fine}}
    @media (pointer: coarse) {body {--pointer: coarse}}
    @media (pointer: none) {body {--pointer: none}}
    @media (device-aspect-ratio: ${deviceAspectRatio}) {body {--device-aspect-ratio: ${deviceAspectRatio}}}
    @media (device-width: ${width}px) and (device-height: ${height}px) {body {--device-screen: ${width} x ${height}}}
    @media (display-mode: fullscreen) {body {--display-mode: fullscreen}}
    @media (display-mode: standalone) {body {--display-mode: standalone}}
    @media (display-mode: minimal-ui) {body {--display-mode: minimal-ui}}
    @media (display-mode: browser) {body {--display-mode: browser}}
    @media (color-gamut: srgb) {body {--color-gamut: srgb}}
    @media (color-gamut: p3) {body {--color-gamut: p3}}
    @media (color-gamut: rec2020) {body {--color-gamut: rec2020}}
    @media (orientation: landscape) {body {--orientation: landscape}}
    @media (orientation: portrait) {body {--orientation: portrait}}
    </style>
  `;

  const style = getComputedStyle(body);

  return {
    'prefers-reduced-motion':
      style.getPropertyValue('--prefers-reduced-motion').trim() || undefined,
    'prefers-color-scheme':
      style.getPropertyValue('--prefers-color-scheme').trim() || undefined,
    monochrome: style.getPropertyValue('--monochrome').trim() || undefined,
    'inverted-colors':
      style.getPropertyValue('--inverted-colors').trim() || undefined,
    'forced-colors':
      style.getPropertyValue('--forced-colors').trim() || undefined,
    'any-hover': style.getPropertyValue('--any-hover').trim() || undefined,
    hover: style.getPropertyValue('--hover').trim() || undefined,
    'any-pointer': style.getPropertyValue('--any-pointer').trim() || undefined,
    pointer: style.getPropertyValue('--pointer').trim() || undefined,
    'device-aspect-ratio':
      style.getPropertyValue('--device-aspect-ratio').trim() || undefined,
    'device-screen':
      style.getPropertyValue('--device-screen').trim() || undefined,
    'display-mode':
      style.getPropertyValue('--display-mode').trim() || undefined,
    'color-gamut': style.getPropertyValue('--color-gamut').trim() || undefined,
    orientation: style.getPropertyValue('--orientation').trim() || undefined,
  };
}

/**
 * Collects CSS media fingerprint data.
 *
 * Tests media queries via both matchMedia() and CSS to detect preferences
 * and device characteristics while enabling cross-validation.
 *
 * @returns CSS media fingerprint data or undefined on error
 */
export default function getCSSMedia(): CSSMediaFingerprint | undefined {
  try {
    const timer = createTimer();
    timer.start();

    const win = PHANTOM_DARKNESS.window;
    const { body } = win.document;
    const { width, availWidth, height, availHeight } = win.screen;

    // Check for suspicious screen settings
    const noTaskbar = !(width - availWidth || height - availHeight);
    if (screen.width !== width || (width > 800 && noTaskbar)) {
      LowerEntropy.IFRAME_SCREEN = true;
    }

    const deviceAspectRatio = getAspectRatio(width, height);

    // Detect features via matchMedia() API
    const matchMediaCSS = getMatchMediaFeatures(
      win,
      deviceAspectRatio,
      width,
      height,
    );

    // Detect features via CSS custom properties
    const mediaCSS = getCSSMediaFeatures(
      body,
      deviceAspectRatio,
      width,
      height,
    );

    // Probe actual screen dimensions via CSS
    const screenQuery = getScreenMedia(body, width, height);

    logTestResult({ time: timer.stop(), test: 'css media', passed: true });
    return { mediaCSS, matchMediaCSS, screenQuery };
  } catch (error) {
    logTestResult({ test: 'css media', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
