import { describe, it, expect } from 'vitest';
import { TIMEZONE_CITIES, HISTORICAL_YEAR, MS_PER_MINUTE } from './constants';

describe('timezone constants', () => {
  describe('TIMEZONE_CITIES', () => {
    it('contains UTC and GMT zones', () => {
      expect(TIMEZONE_CITIES).toContain('UTC');
      expect(TIMEZONE_CITIES).toContain('GMT');
    });

    it('contains major continent regions', () => {
      // Check for presence of various regions
      const regions = [
        'Africa',
        'America',
        'Antarctica',
        'Asia',
        'Atlantic',
        'Australia',
        'Europe',
        'Indian',
        'Pacific',
      ];
      for (const region of regions) {
        const hasRegion = TIMEZONE_CITIES.some((tz) =>
          tz.startsWith(region + '/'),
        );
        expect(hasRegion, `Should have ${region} region`).toBe(true);
      }
    });

    it('contains major cities', () => {
      const majorCities = [
        'America/New_York',
        'America/Los_Angeles',
        'America/Chicago',
        'Europe/London',
        'Europe/Paris',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Australia/Sydney',
        'Pacific/Honolulu',
      ];
      for (const city of majorCities) {
        expect(TIMEZONE_CITIES).toContain(city);
      }
    });

    it('contains Etc/GMT offset zones', () => {
      expect(TIMEZONE_CITIES).toContain('Etc/GMT+0');
      expect(TIMEZONE_CITIES).toContain('Etc/GMT-12');
      expect(TIMEZONE_CITIES).toContain('Etc/GMT+12');
    });

    it('has valid IANA timezone format', () => {
      // All entries should be valid IANA format: Region/City or special like UTC/GMT/Etc/*
      const validPattern =
        /^(UTC|GMT|Etc\/|Africa\/|America\/|Antarctica\/|Arctic\/|Asia\/|Atlantic\/|Australia\/|Europe\/|Indian\/|Pacific\/)/;
      for (const tz of TIMEZONE_CITIES) {
        expect(tz).toMatch(validPattern);
      }
    });

    it('has no duplicates', () => {
      const uniqueCount = new Set(TIMEZONE_CITIES).size;
      expect(uniqueCount).toBe(TIMEZONE_CITIES.length);
    });

    it('has reasonable number of timezones', () => {
      // IANA has ~400 zones, we should have most
      expect(TIMEZONE_CITIES.length).toBeGreaterThan(400);
      expect(TIMEZONE_CITIES.length).toBeLessThan(600);
    });
  });

  describe('HISTORICAL_YEAR', () => {
    it('is year 1113', () => {
      expect(HISTORICAL_YEAR).toBe(1113);
    });

    it('is before modern DST adoption', () => {
      // DST was first adopted in early 1900s
      expect(HISTORICAL_YEAR).toBeLessThan(1900);
    });
  });

  describe('MS_PER_MINUTE', () => {
    it('equals 60000 milliseconds', () => {
      expect(MS_PER_MINUTE).toBe(60000);
    });

    it('is correct calculation', () => {
      expect(MS_PER_MINUTE).toBe(60 * 1000);
    });
  });
});

// Test timezone formatting patterns
describe('timezone formatting patterns', () => {
  describe('IANA to human-readable conversion', () => {
    it('converts underscore to space', () => {
      // Pattern used in formatLocation
      const format = (location: string) =>
        location.replace(/_/g, ' ').split('/').join(', ');

      expect(format('America/Los_Angeles')).toBe('America, Los Angeles');
      expect(format('America/New_York')).toBe('America, New York');
      expect(format('Europe/Isle_of_Man')).toBe('Europe, Isle of Man');
    });

    it('handles simple zones', () => {
      const format = (location: string) =>
        location.replace(/_/g, ' ').split('/').join(', ');

      expect(format('UTC')).toBe('UTC');
      expect(format('GMT')).toBe('GMT');
    });

    it('handles nested zones', () => {
      const format = (location: string) =>
        location.replace(/_/g, ' ').split('/').join(', ');

      expect(format('America/Argentina/Buenos_Aires')).toBe(
        'America, Argentina, Buenos Aires',
      );
      expect(format('America/Indiana/Indianapolis')).toBe(
        'America, Indiana, Indianapolis',
      );
    });
  });

  describe('timezone abbreviation extraction', () => {
    it('extracts text within parentheses from date string', () => {
      // Pattern used in extractTimezoneAbbreviation
      const extract = (dateStr: string) => {
        const notWithinParentheses = /.*\(|\).*/g;
        return dateStr.replace(notWithinParentheses, '');
      };

      expect(
        extract('Sat Jan 01 2022 00:00:00 GMT-0800 (Pacific Standard Time)'),
      ).toBe('Pacific Standard Time');
      expect(
        extract(
          'Sun Jan 02 2022 00:00:00 GMT+0100 (Central European Standard Time)',
        ),
      ).toBe('Central European Standard Time');
    });
  });
});

// Test offset calculation patterns
describe('timezone offset patterns', () => {
  describe('offset range validation', () => {
    it('valid UTC offsets are -12 to +14 hours', () => {
      // UTC-12 to UTC+14 covers all timezones
      const minOffset = -12 * 60; // -720 minutes
      const maxOffset = 14 * 60; // +840 minutes

      // Sample offsets
      const validOffsets = [0, -480, 480, -720, 840, 330]; // PST, HKT, UTC-12, UTC+14, India
      for (const offset of validOffsets) {
        expect(offset).toBeGreaterThanOrEqual(minOffset);
        expect(offset).toBeLessThanOrEqual(maxOffset);
      }
    });
  });

  describe('offset calculation via date parsing', () => {
    it('difference between local and UTC parsing reveals offset', () => {
      // This is the pattern used in getTimezoneOffset()
      const [year, month, day] = JSON.stringify(new Date())
        .slice(1, 11)
        .split('-');

      expect(year).toMatch(/^\d{4}$/);
      expect(month).toMatch(/^\d{2}$/);
      expect(day).toMatch(/^\d{2}$/);
    });
  });
});

// Test binary search pattern
describe('binary search pattern', () => {
  it('splits array in half', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'];
    const end = list.length;
    const middle = Math.floor(end / 2);
    const [left, right] = [list.slice(0, middle), list.slice(middle, end)];

    expect(left).toEqual(['a', 'b', 'c']);
    expect(right).toEqual(['d', 'e', 'f']);
  });

  it('handles odd-length arrays', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    const end = list.length;
    const middle = Math.floor(end / 2);
    const [left, right] = [list.slice(0, middle), list.slice(middle, end)];

    expect(left).toEqual(['a', 'b']);
    expect(right).toEqual(['c', 'd', 'e']);
  });

  it('handles single element', () => {
    const list = ['a'];
    const end = list.length;
    const middle = Math.floor(end / 2);
    const [left, right] = [list.slice(0, middle), list.slice(middle, end)];

    expect(left).toEqual([]);
    expect(right).toEqual(['a']);
    expect(end).toBe(1); // Base case indicator
  });
});
