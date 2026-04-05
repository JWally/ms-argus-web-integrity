/**
 * Headless Detection Constants
 *
 * Constants used for detecting headless browsers, automation tools,
 * and stealth plugins. These help identify bots, scrapers, and
 * automated testing frameworks.
 */

/**
 * Supported platform types for OS detection.
 *
 * Platform detection is used to validate that the reported OS
 * matches the available APIs and system fonts. Mismatches indicate
 * spoofed user agents or headless environments.
 */
export const enum Platform {
  WINDOWS = 'Windows',
  MAC = 'Mac',
  LINUX = 'Linux',
  ANDROID = 'Android',
  CHROME_OS = 'Chrome OS',
}

/**
 * CSS system font keywords.
 *
 * These are CSS font keywords that resolve to the operating system's
 * default fonts. The actual font family varies by OS:
 * - Windows: "Segoe UI", "Tahoma"
 * - macOS: "-apple-system", "SF Pro"
 * - Linux: "Cantarell", "Ubuntu", "Sans"
 * - Android: "Roboto"
 *
 * By checking which font the system resolves to, we can infer the OS
 * without relying on user agent strings.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/font#system_font_values
 */
export const SYSTEM_FONTS = [
  'caption', // Used by captioned controls (buttons, menus, etc.)
  'icon', // Used for labeling icons
  'menu', // Used in menus (e.g., dropdown menus)
  'message-box', // Used in dialog boxes
  'small-caption', // Used for small controls
  'status-bar', // Used in window status bars
] as const;

/**
 * Firefox-specific font to platform mapping.
 *
 * Firefox/Gecko resolves system fonts differently than Chromium.
 * These mappings allow OS detection from the resolved font family.
 *
 * The font name is the result of getComputedStyle() after applying
 * a system font keyword. Each OS has characteristic default fonts.
 */
export const GECKO_FONT_PLATFORMS: Record<string, Platform> = {
  // macOS fonts
  '-apple-system': Platform.MAC,

  // Windows fonts
  'Segoe UI': Platform.WINDOWS,
  Tahoma: Platform.WINDOWS,
  'Yu Gothic UI': Platform.WINDOWS, // Japanese Windows
  'Microsoft JhengHei UI': Platform.WINDOWS, // Traditional Chinese Windows
  'Microsoft YaHei UI': Platform.WINDOWS, // Simplified Chinese Windows
  'Meiryo UI': Platform.WINDOWS, // Japanese Windows

  // Linux fonts
  Cantarell: Platform.LINUX, // GNOME default
  Ubuntu: Platform.LINUX, // Ubuntu default
  Sans: Platform.LINUX, // Generic fallback
  'sans-serif': Platform.LINUX, // Generic fallback
  'Fira Sans': Platform.LINUX, // Firefox OS, some Linux distros

  // Android fonts
  Roboto: Platform.ANDROID,
};

/**
 * Known headless browser user agent patterns.
 *
 * These regex patterns match known headless browser signatures.
 * Legitimate headless browsers often include these identifiers,
 * while stealth tools try to remove them.
 */
export const HEADLESS_UA_PATTERNS = [
  /HeadlessChrome/,
  /PhantomJS/,
  /Selenium/,
  /WebDriver/,
] as const;

/**
 * Known headless ActiveText CSS color.
 *
 * In headless Chrome, the CSS color "ActiveText" resolves to
 * red (rgb(255, 0, 0)) instead of the system's actual active
 * text color. This is a reliable headless indicator.
 */
export const HEADLESS_ACTIVE_TEXT_COLOR = 'rgb(255, 0, 0)';

/**
 * High index range for chrome object position check.
 *
 * In stealth plugins (like puppeteer-extra-plugin-stealth),
 * the `chrome` object is often added after page load and appears
 * at a high index in Object.keys(window). Real Chrome adds it early,
 * so it appears at a low index. We check the last 50 properties.
 */
export const CHROME_INDEX_RANGE = -50;

/**
 * Chrome version feature detection thresholds.
 *
 * These CSS/API checks determine the minimum Chrome version.
 * Used to validate that expected APIs exist for the detected version.
 * If a v95+ feature is missing on a reported v95+ browser, it's suspicious.
 */
export const CHROME_VERSION_FEATURES = {
  // Chrome 80+: getVideoPlaybackQuality on HTMLVideoElement
  V80: 'getVideoPlaybackQuality' as const,
  // Chrome 81+: color-scheme CSS property
  V81_CSS: 'color-scheme: initial' as const,
  // Chrome 84+: appearance CSS property
  V84_CSS: 'appearance: initial' as const,
  // Chrome 86+: Intl.DisplayNames API
  V86: 'DisplayNames' as const,
  // Chrome 88+: aspect-ratio CSS property
  V88_CSS: 'aspect-ratio: initial' as const,
  // Chrome 89+: border-end-end-radius CSS property
  V89_CSS: 'border-end-end-radius: initial' as const,
  // Chrome 95+: Crypto.randomUUID API
  V95: 'randomUUID' as const,
} as const;
