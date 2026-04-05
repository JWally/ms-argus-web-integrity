import { describe, it, expect } from 'vitest';
import {
  MEDIA_FEATURES,
  SCREEN_QUERY_RANGE,
  MAX_SCREEN_SEARCH_ITERATIONS,
} from './constants';

describe('cssmedia constants', () => {
  describe('MEDIA_FEATURES', () => {
    it('is an array', () => {
      expect(Array.isArray(MEDIA_FEATURES)).toBe(true);
    });

    it('has multiple features', () => {
      expect(MEDIA_FEATURES.length).toBeGreaterThan(10);
    });

    it('all features are strings', () => {
      for (const feature of MEDIA_FEATURES) {
        expect(typeof feature).toBe('string');
      }
    });

    it('includes prefers-reduced-motion', () => {
      expect(MEDIA_FEATURES).toContain('prefers-reduced-motion');
    });

    it('includes prefers-color-scheme', () => {
      expect(MEDIA_FEATURES).toContain('prefers-color-scheme');
    });

    it('includes hover features', () => {
      expect(MEDIA_FEATURES).toContain('hover');
      expect(MEDIA_FEATURES).toContain('any-hover');
    });

    it('includes pointer features', () => {
      expect(MEDIA_FEATURES).toContain('pointer');
      expect(MEDIA_FEATURES).toContain('any-pointer');
    });

    it('includes display-mode', () => {
      expect(MEDIA_FEATURES).toContain('display-mode');
    });

    it('includes color-gamut', () => {
      expect(MEDIA_FEATURES).toContain('color-gamut');
    });

    it('includes orientation', () => {
      expect(MEDIA_FEATURES).toContain('orientation');
    });

    it('includes accessibility features', () => {
      expect(MEDIA_FEATURES).toContain('forced-colors');
      expect(MEDIA_FEATURES).toContain('inverted-colors');
    });
  });

  describe('SCREEN_QUERY_RANGE', () => {
    it('is a number', () => {
      expect(typeof SCREEN_QUERY_RANGE).toBe('number');
    });

    it('is 1000 pixels', () => {
      expect(SCREEN_QUERY_RANGE).toBe(1000);
    });

    it('is positive', () => {
      expect(SCREEN_QUERY_RANGE).toBeGreaterThan(0);
    });
  });

  describe('MAX_SCREEN_SEARCH_ITERATIONS', () => {
    it('is a number', () => {
      expect(typeof MAX_SCREEN_SEARCH_ITERATIONS).toBe('number');
    });

    it('is 10', () => {
      expect(MAX_SCREEN_SEARCH_ITERATIONS).toBe(10);
    });

    it('allows searching up to 10000 pixels', () => {
      const maxPixels = SCREEN_QUERY_RANGE * MAX_SCREEN_SEARCH_ITERATIONS;
      expect(maxPixels).toBe(10000);
    });
  });
});

// Test media query patterns
describe('cssmedia query patterns', () => {
  describe('screen dimension search', () => {
    it('can calculate search ranges', () => {
      const getRanges = () => {
        const ranges: Array<{ min: number; max: number }> = [];
        for (let i = 0; i < MAX_SCREEN_SEARCH_ITERATIONS; i++) {
          ranges.push({
            min: i * SCREEN_QUERY_RANGE,
            max: (i + 1) * SCREEN_QUERY_RANGE,
          });
        }
        return ranges;
      };

      const ranges = getRanges();
      expect(ranges.length).toBe(10);
      expect(ranges[0]).toEqual({ min: 0, max: 1000 });
      expect(ranges[9]).toEqual({ min: 9000, max: 10000 });
    });
  });

  describe('media feature query construction', () => {
    it('can construct media queries', () => {
      const constructQuery = (feature: string, value: string) =>
        `(${feature}: ${value})`;

      expect(constructQuery('prefers-color-scheme', 'dark')).toBe(
        '(prefers-color-scheme: dark)',
      );
      expect(constructQuery('hover', 'hover')).toBe('(hover: hover)');
    });
  });
});
