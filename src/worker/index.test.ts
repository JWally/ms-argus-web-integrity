import { describe, it, expect } from 'vitest';
import type { WorkerScopeData } from './index';

describe('worker types', () => {
  describe('WorkerScopeData interface', () => {
    it('can represent complete scope data', () => {
      const data: WorkerScopeData = {
        lied: false,
        lies: {
          proto: { 'Navigator.platform': ['prototype has been modified'] },
          os: 'Linux platform and Windows user agent do not match',
          engine: 'V8 JS runtime and SpiderMonkey user agent do not match',
          version:
            'userAgentData version 120 and user agent version 119 do not match',
          platformVersion: 'platform version is fake',
        },
        locale: 'en-US',
        systemCurrencyLocale: '1 US dollar',
        engineCurrencyLocale: '1 US dollar',
        localeEntropyIsTrusty: true,
        localeIntlEntropyIsTrusty: true,
        timezoneOffset: -480,
        timezoneLocation: 'America/Los_Angeles',
        deviceMemory: 8,
        hardwareConcurrency: 16,
        language: 'en-US',
        languages: 'en-US,en,fr',
        platform: 'Win32',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        webglRenderer: 'ANGLE (NVIDIA GeForce RTX 3080)',
        webglVendor: 'Google Inc. (NVIDIA)',
        userAgentData: {
          platform: 'Windows',
          platformVersion: '10.0.0',
          architecture: 'x86',
          bitness: '64',
          model: '',
          mobile: false,
          brands: ['Chrome'],
          brandsVersion: ['Chrome 120'],
        },
      };

      expect(data.lied).toBe(false);
      expect(data.lies.proto).toBeDefined();
      expect(data.lies.os).toContain('platform');
      expect(data.hardwareConcurrency).toBe(16);
      expect(data.userAgentData?.platform).toBe('Windows');
    });

    it('can represent minimal scope data', () => {
      const data: WorkerScopeData = {
        lied: false,
        lies: {},
        locale: 'en',
        engineCurrencyLocale: '$1',
        localeEntropyIsTrusty: true,
        localeIntlEntropyIsTrusty: true,
        timezoneOffset: 0,
        timezoneLocation: 'UTC',
        hardwareConcurrency: 2,
        language: 'en',
        languages: 'en',
        platform: 'Linux armv7l',
        userAgent: 'Mozilla/5.0',
      };

      expect(data.deviceMemory).toBeUndefined();
      expect(data.webglRenderer).toBeUndefined();
      expect(data.userAgentData).toBeUndefined();
    });

    it('can represent lied scope', () => {
      const data: WorkerScopeData = {
        lied: true,
        lies: {
          engine: 'engine mismatch detected',
        },
        locale: 'en-US',
        engineCurrencyLocale: '$1',
        localeEntropyIsTrusty: false,
        localeIntlEntropyIsTrusty: false,
        timezoneOffset: -300,
        timezoneLocation: 'America/New_York',
        hardwareConcurrency: 4,
        language: 'en-US',
        languages: 'en-US',
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0...',
      };

      expect(data.lied).toBe(true);
      expect(data.localeEntropyIsTrusty).toBe(false);
    });
  });

  it('validates required fields are present', () => {
    const requiredFields: (keyof WorkerScopeData)[] = [
      'lied',
      'lies',
      'locale',
      'engineCurrencyLocale',
      'localeEntropyIsTrusty',
      'localeIntlEntropyIsTrusty',
      'timezoneOffset',
      'timezoneLocation',
      'hardwareConcurrency',
      'language',
      'languages',
      'platform',
      'userAgent',
    ];

    const data: WorkerScopeData = {
      lied: false,
      lies: {},
      locale: 'en',
      engineCurrencyLocale: '$1',
      localeEntropyIsTrusty: true,
      localeIntlEntropyIsTrusty: true,
      timezoneOffset: 0,
      timezoneLocation: 'UTC',
      hardwareConcurrency: 4,
      language: 'en',
      languages: 'en',
      platform: 'Linux',
      userAgent: 'Mozilla/5.0',
    };

    for (const field of requiredFields) {
      expect(data[field]).toBeDefined();
    }
  });

  it('allows optional fields to be undefined', () => {
    const optionalFields: (keyof WorkerScopeData)[] = [
      'deviceMemory',
      'webglRenderer',
      'webglVendor',
      'userAgentData',
      'systemCurrencyLocale',
    ];

    const data: WorkerScopeData = {
      lied: false,
      lies: {},
      locale: 'en',
      engineCurrencyLocale: '$1',
      localeEntropyIsTrusty: true,
      localeIntlEntropyIsTrusty: true,
      timezoneOffset: 0,
      timezoneLocation: 'UTC',
      hardwareConcurrency: 4,
      language: 'en',
      languages: 'en',
      platform: 'Linux',
      userAgent: 'Mozilla/5.0',
    };

    for (const field of optionalFields) {
      expect(data[field]).toBeUndefined();
    }
  });
});
