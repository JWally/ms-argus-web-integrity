import { describe, it, expect } from 'vitest';
import { TASKBAR_DETECTION_THRESHOLD } from './constants';

describe('screen constants', () => {
  describe('TASKBAR_DETECTION_THRESHOLD', () => {
    it('is a number', () => {
      expect(typeof TASKBAR_DETECTION_THRESHOLD).toBe('number');
    });

    it('is 800px', () => {
      expect(TASKBAR_DETECTION_THRESHOLD).toBe(800);
    });

    it('is positive', () => {
      expect(TASKBAR_DETECTION_THRESHOLD).toBeGreaterThan(0);
    });

    it('is larger than small mobile screens', () => {
      // Most phones are less than 800px wide
      expect(TASKBAR_DETECTION_THRESHOLD).toBeGreaterThanOrEqual(800);
    });

    it('is smaller than large desktop screens', () => {
      // Most desktops are larger than 800px
      expect(TASKBAR_DETECTION_THRESHOLD).toBeLessThan(1920);
    });
  });
});

// Test detection pattern
describe('screen detection patterns', () => {
  describe('taskbar detection logic', () => {
    it('can detect if screen is large enough for taskbar', () => {
      const hasTaskbar = (screenWidth: number) =>
        screenWidth > TASKBAR_DETECTION_THRESHOLD;

      expect(hasTaskbar(640)).toBe(false); // Mobile
      expect(hasTaskbar(800)).toBe(false); // Threshold
      expect(hasTaskbar(1024)).toBe(true); // Tablet/small desktop
      expect(hasTaskbar(1920)).toBe(true); // Desktop
    });

    it('can detect fullscreen mode on large screens', () => {
      const isFullscreenOnLargeDisplay = (
        screenWidth: number,
        screenHeight: number,
        availWidth: number,
        availHeight: number,
      ) => {
        const isLarge = screenWidth > TASKBAR_DETECTION_THRESHOLD;
        const isFullMatch =
          screenWidth === availWidth && screenHeight === availHeight;
        return isLarge && isFullMatch;
      };

      // Normal desktop with taskbar
      expect(isFullscreenOnLargeDisplay(1920, 1080, 1920, 1040)).toBe(false);

      // Fullscreen on large display (suspicious)
      expect(isFullscreenOnLargeDisplay(1920, 1080, 1920, 1080)).toBe(true);

      // Small screen fullscreen (normal)
      expect(isFullscreenOnLargeDisplay(640, 480, 640, 480)).toBe(false);
    });
  });
});
