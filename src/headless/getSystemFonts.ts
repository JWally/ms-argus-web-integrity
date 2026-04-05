/**
 * System Font Detection
 *
 * Detects the operating system by examining which fonts the browser
 * resolves for CSS system font keywords. This technique works because:
 *
 * 1. CSS system font keywords (caption, icon, menu, etc.) resolve to
 *    the OS's default UI font
 * 2. Each OS has characteristic default fonts:
 *    - Windows: "Segoe UI", "Tahoma"
 *    - macOS: "-apple-system", "SF Pro"
 *    - Linux: "Cantarell", "Ubuntu", "Sans"
 *    - Android: "Roboto"
 *
 * 3. Firefox/Gecko browsers expose the resolved font name in
 *    getComputedStyle(), allowing OS detection without UA parsing
 *
 * This is harder to spoof than user agent strings because it requires
 * either installing the correct fonts or modifying CSS resolution.
 */

import { expectFailure } from '../utils/expected-failure';
import { Platform, SYSTEM_FONTS, GECKO_FONT_PLATFORMS } from './constants';

/**
 * Detects the operating system from resolved system fonts.
 *
 * Creates a temporary element, applies CSS system font keywords,
 * and reads back the resolved font family. The resolved font
 * reveals the OS because each platform has different default fonts.
 *
 * @returns Font family string, optionally with ":Platform" suffix for Gecko
 *
 * @example
 * // Windows
 * getSystemFonts() // "Segoe UI:Windows"
 *
 * @example
 * // macOS
 * getSystemFonts() // "-apple-system:Mac"
 *
 * @example
 * // Linux
 * getSystemFonts() // "Cantarell:Linux"
 */
export function getSystemFonts(): string {
  const { body } = document;
  const el = document.createElement('div');
  body.appendChild(el);

  try {
    // Apply each system font keyword and collect unique resolved fonts
    const systemFonts = String([
      ...SYSTEM_FONTS.reduce((acc, font) => {
        el.setAttribute('style', `font: ${font} !important`);
        return acc.add(getComputedStyle(el).fontFamily);
      }, new Set<string>()),
    ]);

    // Check if resolved font maps to a known platform (Firefox/Gecko only)
    const geckoPlatform = GECKO_FONT_PLATFORMS[systemFonts];

    // Return with platform suffix if detected, otherwise just the font string
    return geckoPlatform ? `${systemFonts}:${geckoPlatform}` : systemFonts;
  } catch {
    expectFailure('getSystemFonts', 'Font detection failed');
    return '';
  } finally {
    // Always clean up the temporary element
    body.removeChild(el);
  }
}
