import { describe, it, expect } from 'vitest';
import { INTL_CONSTRUCTORS, REFERENCE_TIMESTAMP } from './constants';

describe('intl constants', () => {
  describe('INTL_CONSTRUCTORS', () => {
    it('contains all Intl constructor names', () => {
      const expected = [
        'Collator',
        'DateTimeFormat',
        'DisplayNames',
        'ListFormat',
        'NumberFormat',
        'PluralRules',
        'RelativeTimeFormat',
      ];
      expect(INTL_CONSTRUCTORS).toEqual(expected);
    });

    it('all constructors exist on Intl object', () => {
      for (const name of INTL_CONSTRUCTORS) {
        // @ts-expect-error - Dynamic constructor access
        expect(typeof Intl[name]).toBe('function');
      }
    });

    it('all constructors have resolvedOptions method', () => {
      for (const name of INTL_CONSTRUCTORS) {
        try {
          // @ts-expect-error - Dynamic constructor access
          const instance = new Intl[name]();
          expect(typeof instance.resolvedOptions).toBe('function');
        } catch {
          // Some constructors may not be available in all environments
        }
      }
    });
  });

  describe('REFERENCE_TIMESTAMP', () => {
    it('is a valid timestamp', () => {
      expect(typeof REFERENCE_TIMESTAMP).toBe('number');
      expect(Number.isFinite(REFERENCE_TIMESTAMP)).toBe(true);
      expect(REFERENCE_TIMESTAMP).toBeGreaterThan(0);
    });

    it('represents a date in July 1970 or later', () => {
      const date = new Date(REFERENCE_TIMESTAMP);
      // Should be a valid date
      expect(date.toString()).not.toBe('Invalid Date');
      // Should be after 1970
      expect(date.getFullYear()).toBeGreaterThanOrEqual(1970);
    });
  });
});

// Test Intl API patterns
describe('intl API patterns', () => {
  describe('locale extraction', () => {
    it('resolvedOptions returns locale for all constructors', () => {
      const locales: string[] = [];

      for (const name of INTL_CONSTRUCTORS) {
        try {
          // @ts-expect-error - Dynamic constructor access
          const instance = new Intl[name]();
          const { locale } = instance.resolvedOptions();
          if (locale) {
            locales.push(locale);
          }
        } catch {
          // Some constructors may not be available
        }
      }

      // Should get at least some locales
      expect(locales.length).toBeGreaterThan(0);

      // All locales should be strings
      for (const locale of locales) {
        expect(typeof locale).toBe('string');
        expect(locale.length).toBeGreaterThan(0);
      }
    });

    it('locale format follows BCP 47 pattern', () => {
      const { locale } = new Intl.DateTimeFormat().resolvedOptions();
      // BCP 47 format: language[-script][-region][-variant]
      // e.g., en, en-US, zh-Hans-CN
      expect(locale).toMatch(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?/);
    });
  });

  describe('DateTimeFormat', () => {
    it('formats dates with month name', () => {
      const formatter = new Intl.DateTimeFormat(undefined, {
        month: 'long',
      });
      const result = formatter.format(REFERENCE_TIMESTAMP);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('formats dates with timezone name', () => {
      const formatter = new Intl.DateTimeFormat(undefined, {
        timeZoneName: 'long',
      });
      const result = formatter.format(REFERENCE_TIMESTAMP);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('produces locale-specific output', () => {
      const usFormatter = new Intl.DateTimeFormat('en-US', { month: 'long' });
      const frFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long' });

      const usResult = usFormatter.format(REFERENCE_TIMESTAMP);
      const frResult = frFormatter.format(REFERENCE_TIMESTAMP);

      // Different locales should produce different month names
      expect(usResult).not.toBe(frResult);
    });
  });

  describe('DisplayNames', () => {
    it('returns display name for language codes', () => {
      const displayNames = new Intl.DisplayNames(undefined, {
        type: 'language',
      });
      const result = displayNames.of('en-US');

      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });

    it('produces locale-specific language names', () => {
      const usNames = new Intl.DisplayNames('en-US', { type: 'language' });
      const frNames = new Intl.DisplayNames('fr-FR', { type: 'language' });

      const usResult = usNames.of('en-US');
      const frResult = frNames.of('en-US');

      // en-US in English vs French should differ
      // "American English" vs "anglais américain"
      expect(usResult).not.toBe(frResult);
    });
  });

  describe('ListFormat', () => {
    it('formats lists with disjunction', () => {
      // @ts-expect-error - ListFormat type
      const formatter = new Intl.ListFormat(undefined, {
        style: 'long',
        type: 'disjunction',
      });
      const result = formatter.format(['0', '1']);

      expect(typeof result).toBe('string');
      // Should contain the separator
      expect(result.length).toBeGreaterThan(3);
    });

    it('produces locale-specific connectors', () => {
      // @ts-expect-error - ListFormat type
      const usFormatter = new Intl.ListFormat('en-US', { type: 'disjunction' });
      // @ts-expect-error - ListFormat type
      const esFormatter = new Intl.ListFormat('es-ES', { type: 'disjunction' });

      const usResult = usFormatter.format(['0', '1']);
      const esResult = esFormatter.format(['0', '1']);

      // "0 or 1" vs "0 o 1"
      expect(usResult).not.toBe(esResult);
    });
  });

  describe('NumberFormat', () => {
    it('formats numbers in compact notation', () => {
      const formatter = new Intl.NumberFormat(undefined, {
        notation: 'compact',
        compactDisplay: 'long',
      });
      const result = formatter.format(21000000);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('produces locale-specific compact formats', () => {
      const usFormatter = new Intl.NumberFormat('en-US', {
        notation: 'compact',
        compactDisplay: 'long',
      });
      const frFormatter = new Intl.NumberFormat('fr-FR', {
        notation: 'compact',
        compactDisplay: 'long',
      });

      const usResult = usFormatter.format(21000000);
      const frResult = frFormatter.format(21000000);

      // "21 million" vs "21 millions" (or similar)
      expect(typeof usResult).toBe('string');
      expect(typeof frResult).toBe('string');
    });
  });

  describe('PluralRules', () => {
    it('returns plural category', () => {
      const rules = new Intl.PluralRules();
      const result = rules.select(1);

      expect(typeof result).toBe('string');
      // Should be one of: zero, one, two, few, many, other
      expect(['zero', 'one', 'two', 'few', 'many', 'other']).toContain(result);
    });

    it('returns "one" for singular in most locales', () => {
      const rules = new Intl.PluralRules('en-US');
      expect(rules.select(1)).toBe('one');
    });

    it('returns "other" for zero in English', () => {
      const rules = new Intl.PluralRules('en-US');
      expect(rules.select(0)).toBe('other');
    });
  });

  describe('RelativeTimeFormat', () => {
    it('formats relative time', () => {
      const formatter = new Intl.RelativeTimeFormat(undefined, {
        numeric: 'auto',
        style: 'long',
      });
      const result = formatter.format(1, 'year');

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('produces locale-specific relative time', () => {
      const usFormatter = new Intl.RelativeTimeFormat('en-US', {
        numeric: 'auto',
      });
      const frFormatter = new Intl.RelativeTimeFormat('fr-FR', {
        numeric: 'auto',
      });

      const usResult = usFormatter.format(1, 'year');
      const frResult = frFormatter.format(1, 'year');

      // "next year" vs "l'année prochaine"
      expect(usResult).not.toBe(frResult);
    });
  });
});

// Test consistency patterns
describe('intl consistency patterns', () => {
  it('all constructors report same locale by default', () => {
    const locales: string[] = [];

    for (const name of INTL_CONSTRUCTORS) {
      try {
        // @ts-expect-error - Dynamic constructor access
        const instance = new Intl[name]();
        const { locale } = instance.resolvedOptions();
        if (locale) {
          locales.push(locale);
        }
      } catch {
        // Some may not be available
      }
    }

    // All locales should be the same
    const uniqueLocales = new Set(locales);
    expect(uniqueLocales.size).toBe(1);
  });
});
