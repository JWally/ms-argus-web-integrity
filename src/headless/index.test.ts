import { describe, it, expect } from 'vitest';
import {
  Platform,
  SYSTEM_FONTS,
  GECKO_FONT_PLATFORMS,
  HEADLESS_UA_PATTERNS,
  HEADLESS_ACTIVE_TEXT_COLOR,
  CHROME_INDEX_RANGE,
  CHROME_VERSION_FEATURES,
} from './constants';

describe('headless constants', () => {
  describe('Platform enum', () => {
    it('has Windows platform', () => {
      expect(Platform.WINDOWS).toBe('Windows');
    });

    it('has Mac platform', () => {
      expect(Platform.MAC).toBe('Mac');
    });

    it('has Linux platform', () => {
      expect(Platform.LINUX).toBe('Linux');
    });

    it('has Android platform', () => {
      expect(Platform.ANDROID).toBe('Android');
    });

    it('has Chrome OS platform', () => {
      expect(Platform.CHROME_OS).toBe('Chrome OS');
    });
  });

  describe('SYSTEM_FONTS', () => {
    it('is an array', () => {
      expect(Array.isArray(SYSTEM_FONTS)).toBe(true);
    });

    it('has 6 system fonts', () => {
      expect(SYSTEM_FONTS.length).toBe(6);
    });

    it('contains caption font', () => {
      expect(SYSTEM_FONTS).toContain('caption');
    });

    it('contains icon font', () => {
      expect(SYSTEM_FONTS).toContain('icon');
    });

    it('contains menu font', () => {
      expect(SYSTEM_FONTS).toContain('menu');
    });

    it('contains message-box font', () => {
      expect(SYSTEM_FONTS).toContain('message-box');
    });

    it('contains small-caption font', () => {
      expect(SYSTEM_FONTS).toContain('small-caption');
    });

    it('contains status-bar font', () => {
      expect(SYSTEM_FONTS).toContain('status-bar');
    });
  });

  describe('GECKO_FONT_PLATFORMS', () => {
    it('is an object', () => {
      expect(typeof GECKO_FONT_PLATFORMS).toBe('object');
    });

    it('maps macOS font', () => {
      expect(GECKO_FONT_PLATFORMS['-apple-system']).toBe(Platform.MAC);
    });

    it('maps Windows fonts', () => {
      expect(GECKO_FONT_PLATFORMS['Segoe UI']).toBe(Platform.WINDOWS);
      expect(GECKO_FONT_PLATFORMS['Tahoma']).toBe(Platform.WINDOWS);
      expect(GECKO_FONT_PLATFORMS['Yu Gothic UI']).toBe(Platform.WINDOWS);
      expect(GECKO_FONT_PLATFORMS['Microsoft JhengHei UI']).toBe(
        Platform.WINDOWS,
      );
      expect(GECKO_FONT_PLATFORMS['Microsoft YaHei UI']).toBe(Platform.WINDOWS);
      expect(GECKO_FONT_PLATFORMS['Meiryo UI']).toBe(Platform.WINDOWS);
    });

    it('maps Linux fonts', () => {
      expect(GECKO_FONT_PLATFORMS['Cantarell']).toBe(Platform.LINUX);
      expect(GECKO_FONT_PLATFORMS['Ubuntu']).toBe(Platform.LINUX);
      expect(GECKO_FONT_PLATFORMS['Sans']).toBe(Platform.LINUX);
      expect(GECKO_FONT_PLATFORMS['sans-serif']).toBe(Platform.LINUX);
      expect(GECKO_FONT_PLATFORMS['Fira Sans']).toBe(Platform.LINUX);
    });

    it('maps Android font', () => {
      expect(GECKO_FONT_PLATFORMS['Roboto']).toBe(Platform.ANDROID);
    });

    it('all values are valid Platform enum values', () => {
      const validPlatforms = [
        Platform.WINDOWS,
        Platform.MAC,
        Platform.LINUX,
        Platform.ANDROID,
        Platform.CHROME_OS,
      ];
      for (const platform of Object.values(GECKO_FONT_PLATFORMS)) {
        expect(validPlatforms).toContain(platform);
      }
    });
  });

  describe('HEADLESS_UA_PATTERNS', () => {
    it('is an array', () => {
      expect(Array.isArray(HEADLESS_UA_PATTERNS)).toBe(true);
    });

    it('has 4 patterns', () => {
      expect(HEADLESS_UA_PATTERNS.length).toBe(4);
    });

    it('all elements are RegExp', () => {
      for (const pattern of HEADLESS_UA_PATTERNS) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it('detects HeadlessChrome', () => {
      const ua =
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36';
      expect(HEADLESS_UA_PATTERNS.some((p) => p.test(ua))).toBe(true);
    });

    it('detects PhantomJS', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/534.34 (KHTML, like Gecko) PhantomJS/1.9.8 Safari/534.34';
      expect(HEADLESS_UA_PATTERNS.some((p) => p.test(ua))).toBe(true);
    });

    it('detects Selenium', () => {
      const ua = 'Mozilla/5.0 Selenium/4.8.0';
      expect(HEADLESS_UA_PATTERNS.some((p) => p.test(ua))).toBe(true);
    });

    it('detects WebDriver', () => {
      const ua = 'Mozilla/5.0 (compatible; WebDriver)';
      expect(HEADLESS_UA_PATTERNS.some((p) => p.test(ua))).toBe(true);
    });

    it('does not match normal Chrome UA', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      expect(HEADLESS_UA_PATTERNS.some((p) => p.test(ua))).toBe(false);
    });
  });

  describe('HEADLESS_ACTIVE_TEXT_COLOR', () => {
    it('is red RGB value', () => {
      expect(HEADLESS_ACTIVE_TEXT_COLOR).toBe('rgb(255, 0, 0)');
    });

    it('represents pure red', () => {
      const match = HEADLESS_ACTIVE_TEXT_COLOR.match(
        /rgb\((\d+), (\d+), (\d+)\)/,
      );
      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBe(255);
      expect(parseInt(match![2])).toBe(0);
      expect(parseInt(match![3])).toBe(0);
    });
  });

  describe('CHROME_INDEX_RANGE', () => {
    it('is -50', () => {
      expect(CHROME_INDEX_RANGE).toBe(-50);
    });

    it('is negative for slice from end', () => {
      expect(CHROME_INDEX_RANGE).toBeLessThan(0);
    });
  });

  describe('CHROME_VERSION_FEATURES', () => {
    it('is an object', () => {
      expect(typeof CHROME_VERSION_FEATURES).toBe('object');
    });

    it('has V80 feature', () => {
      expect(CHROME_VERSION_FEATURES.V80).toBe('getVideoPlaybackQuality');
    });

    it('has V81 CSS feature', () => {
      expect(CHROME_VERSION_FEATURES.V81_CSS).toBe('color-scheme: initial');
    });

    it('has V84 CSS feature', () => {
      expect(CHROME_VERSION_FEATURES.V84_CSS).toBe('appearance: initial');
    });

    it('has V86 feature', () => {
      expect(CHROME_VERSION_FEATURES.V86).toBe('DisplayNames');
    });

    it('has V88 CSS feature', () => {
      expect(CHROME_VERSION_FEATURES.V88_CSS).toBe('aspect-ratio: initial');
    });

    it('has V89 CSS feature', () => {
      expect(CHROME_VERSION_FEATURES.V89_CSS).toBe(
        'border-end-end-radius: initial',
      );
    });

    it('has V95 feature', () => {
      expect(CHROME_VERSION_FEATURES.V95).toBe('randomUUID');
    });
  });
});

// Test detection pattern behavior
describe('headless detection patterns', () => {
  describe('platform detection via fonts', () => {
    it('can detect Windows from Segoe UI font', () => {
      const fontFamily = 'Segoe UI';
      expect(GECKO_FONT_PLATFORMS[fontFamily]).toBe(Platform.WINDOWS);
    });

    it('can detect Mac from -apple-system font', () => {
      const fontFamily = '-apple-system';
      expect(GECKO_FONT_PLATFORMS[fontFamily]).toBe(Platform.MAC);
    });

    it('can detect Linux from Cantarell font', () => {
      const fontFamily = 'Cantarell';
      expect(GECKO_FONT_PLATFORMS[fontFamily]).toBe(Platform.LINUX);
    });

    it('returns undefined for unknown font', () => {
      const fontFamily = 'UnknownFont';
      expect(GECKO_FONT_PLATFORMS[fontFamily]).toBeUndefined();
    });
  });

  describe('headless UA detection', () => {
    it('can check if any pattern matches', () => {
      const isHeadless = (ua: string) =>
        HEADLESS_UA_PATTERNS.some((pattern) => pattern.test(ua));

      expect(isHeadless('HeadlessChrome/100.0.0.0')).toBe(true);
      expect(isHeadless('Chrome/100.0.0.0')).toBe(false);
    });
  });

  describe('Chrome version feature detection', () => {
    it('V80 check for getVideoPlaybackQuality', () => {
      const hasV80 = 'getVideoPlaybackQuality' in HTMLVideoElement.prototype;
      expect(typeof hasV80).toBe('boolean');
    });

    it('CSS feature check pattern', () => {
      const cssFeatures = [
        CHROME_VERSION_FEATURES.V81_CSS,
        CHROME_VERSION_FEATURES.V84_CSS,
        CHROME_VERSION_FEATURES.V88_CSS,
        CHROME_VERSION_FEATURES.V89_CSS,
      ];
      for (const feature of cssFeatures) {
        expect(feature).toMatch(/: initial$/);
      }
    });
  });
});
