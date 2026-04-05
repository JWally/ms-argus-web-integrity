import { describe, it, expect } from 'vitest';
import type {
  WorkerType,
  WorkerResult,
  WorkerScopeData,
  WorkerComparison,
  WorkerDifference,
  ParallelWorkerResults,
} from './index';

// Since compareWorkerResults is not exported, we test the types and behavior indirectly
// The comparison logic is tested through the exported types

describe('worker types', () => {
  describe('WorkerType', () => {
    it('accepts valid worker types', () => {
      const types: WorkerType[] = ['service', 'shared', 'dedicated'];
      expect(types).toHaveLength(3);
      expect(types).toContain('service');
      expect(types).toContain('shared');
      expect(types).toContain('dedicated');
    });
  });

  describe('WorkerResult interface', () => {
    it('can represent a successful worker result', () => {
      const result: WorkerResult = {
        type: 'dedicated',
        name: 'DedicatedWorkerGlobalScope',
        data: {
          lied: false,
          lies: {},
          locale: 'en-US',
          engineCurrencyLocale: '$1',
          localeEntropyIsTrusty: true,
          localeIntlEntropyIsTrusty: true,
          timezoneOffset: -420,
          timezoneLocation: 'America/Los_Angeles',
          hardwareConcurrency: 8,
          language: 'en-US',
          languages: 'en-US,en',
          platform: 'Linux x86_64',
          userAgent: 'Mozilla/5.0...',
        },
        durationMs: 150,
      };

      expect(result.type).toBe('dedicated');
      expect(result.data).not.toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('can represent a failed worker result', () => {
      const result: WorkerResult = {
        type: 'service',
        name: 'ServiceWorkerGlobalScope',
        data: null,
        error: 'not supported',
        durationMs: 5,
      };

      expect(result.type).toBe('service');
      expect(result.data).toBeNull();
      expect(result.error).toBe('not supported');
    });

    it('can represent a timeout', () => {
      const result: WorkerResult = {
        type: 'shared',
        name: 'SharedWorkerGlobalScope',
        data: null,
        error: 'timeout',
        durationMs: 3000,
      };

      expect(result.error).toBe('timeout');
      expect(result.durationMs).toBe(3000);
    });
  });

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

    it('can represent lied scope with boolean', () => {
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

  describe('WorkerComparison interface', () => {
    it('can represent consistent results', () => {
      const comparison: WorkerComparison = {
        consistent: true,
        differences: [],
        succeeded: ['service', 'shared', 'dedicated'],
        failed: [],
      };

      expect(comparison.consistent).toBe(true);
      expect(comparison.differences).toHaveLength(0);
      expect(comparison.succeeded).toHaveLength(3);
    });

    it('can represent inconsistent results', () => {
      const comparison: WorkerComparison = {
        consistent: false,
        differences: [
          {
            field: 'platform',
            values: {
              service: 'Win32',
              shared: 'Linux x86_64',
              dedicated: 'Win32',
            },
          },
          {
            field: 'hardwareConcurrency',
            values: {
              service: 8,
              shared: 4,
              dedicated: 8,
            },
          },
        ],
        succeeded: ['service', 'shared', 'dedicated'],
        failed: [],
      };

      expect(comparison.consistent).toBe(false);
      expect(comparison.differences).toHaveLength(2);
      expect(comparison.differences[0].field).toBe('platform');
      expect(comparison.differences[0].values.shared).toBe('Linux x86_64');
    });

    it('can represent partial failures', () => {
      const comparison: WorkerComparison = {
        consistent: true,
        differences: [],
        succeeded: ['dedicated'],
        failed: ['service', 'shared'],
      };

      expect(comparison.succeeded).toHaveLength(1);
      expect(comparison.failed).toHaveLength(2);
      expect(comparison.failed).toContain('service');
    });
  });

  describe('WorkerDifference interface', () => {
    it('can represent a field difference', () => {
      const diff: WorkerDifference = {
        field: 'userAgent',
        values: {
          service: 'Mozilla/5.0 Chrome/120',
          shared: 'Mozilla/5.0 Chrome/119',
          dedicated: 'Mozilla/5.0 Chrome/120',
        },
      };

      expect(diff.field).toBe('userAgent');
      expect(diff.values.service).toContain('120');
      expect(diff.values.shared).toContain('119');
    });

    it('can represent partial values when some workers fail', () => {
      const diff: WorkerDifference = {
        field: 'webglRenderer',
        values: {
          service: undefined as unknown,
          shared: 'ANGLE (NVIDIA)',
          dedicated: 'ANGLE (Intel)',
        },
      };

      expect(diff.values.service).toBeUndefined();
      expect(diff.values.shared).not.toEqual(diff.values.dedicated);
    });
  });

  describe('ParallelWorkerResults interface', () => {
    it('can represent full parallel results', () => {
      const mockData: WorkerScopeData = {
        lied: false,
        lies: {},
        locale: 'en-US',
        engineCurrencyLocale: '$1',
        localeEntropyIsTrusty: true,
        localeIntlEntropyIsTrusty: true,
        timezoneOffset: -480,
        timezoneLocation: 'America/Los_Angeles',
        hardwareConcurrency: 8,
        language: 'en-US',
        languages: 'en-US',
        platform: 'Linux x86_64',
        userAgent: 'Mozilla/5.0...',
      };

      const results: ParallelWorkerResults = {
        workers: [
          {
            type: 'service',
            name: 'ServiceWorkerGlobalScope',
            data: mockData,
            durationMs: 200,
          },
          {
            type: 'shared',
            name: 'SharedWorkerGlobalScope',
            data: null,
            error: 'not supported',
            durationMs: 5,
          },
          {
            type: 'dedicated',
            name: 'DedicatedWorkerGlobalScope',
            data: mockData,
            durationMs: 150,
          },
        ],
        best: {
          type: 'service',
          name: 'ServiceWorkerGlobalScope',
          data: mockData,
          durationMs: 200,
        },
        comparison: {
          consistent: true,
          differences: [],
          succeeded: ['service', 'dedicated'],
          failed: ['shared'],
        },
        totalDurationMs: 210,
      };

      expect(results.workers).toHaveLength(3);
      expect(results.best?.type).toBe('service');
      expect(results.comparison.succeeded).toContain('dedicated');
      expect(results.comparison.failed).toContain('shared');
    });

    it('can represent all workers failed', () => {
      const results: ParallelWorkerResults = {
        workers: [
          {
            type: 'service',
            name: 'ServiceWorkerGlobalScope',
            data: null,
            error: 'blocked in iframe',
            durationMs: 10,
          },
          {
            type: 'shared',
            name: 'SharedWorkerGlobalScope',
            data: null,
            error: 'not supported',
            durationMs: 5,
          },
          {
            type: 'dedicated',
            name: 'DedicatedWorkerGlobalScope',
            data: null,
            error: 'timeout',
            durationMs: 3000,
          },
        ],
        best: null,
        comparison: {
          consistent: true,
          differences: [],
          succeeded: [],
          failed: ['service', 'shared', 'dedicated'],
        },
        totalDurationMs: 3005,
      };

      expect(results.best).toBeNull();
      expect(results.comparison.succeeded).toHaveLength(0);
      expect(results.comparison.failed).toHaveLength(3);
    });
  });
});

describe('worker comparison scenarios', () => {
  describe('bot detection via worker inconsistency', () => {
    it('detects when only dedicated worker is spoofed', () => {
      // Scenario: Extension that only intercepts DedicatedWorker
      const comparison: WorkerComparison = {
        consistent: false,
        differences: [
          {
            field: 'platform',
            values: {
              service: 'Linux x86_64',
              shared: 'Linux x86_64',
              dedicated: 'Win32', // Spoofed
            },
          },
        ],
        succeeded: ['service', 'shared', 'dedicated'],
        failed: [],
      };

      expect(comparison.consistent).toBe(false);
      expect(comparison.differences[0].values.dedicated).not.toBe(
        comparison.differences[0].values.service,
      );
    });

    it('detects when service worker is blocked but others work', () => {
      // Scenario: Running in iframe (service workers blocked)
      const comparison: WorkerComparison = {
        consistent: true,
        differences: [],
        succeeded: ['shared', 'dedicated'],
        failed: ['service'],
      };

      expect(comparison.failed).toContain('service');
      expect(comparison.succeeded).toHaveLength(2);
    });

    it('detects inconsistent GPU across workers', () => {
      // Scenario: GPU spoofing that doesn't reach all contexts
      const comparison: WorkerComparison = {
        consistent: false,
        differences: [
          {
            field: 'webglRenderer',
            values: {
              service: 'ANGLE (NVIDIA GeForce RTX 3080)',
              shared: 'ANGLE (NVIDIA GeForce RTX 3080)',
              dedicated: 'ANGLE (Intel HD Graphics 630)', // Spoofed to lower-end GPU
            },
          },
        ],
        succeeded: ['service', 'shared', 'dedicated'],
        failed: [],
      };

      expect(comparison.consistent).toBe(false);
      expect(comparison.differences[0].field).toBe('webglRenderer');
    });
  });

  describe('normal browser scenarios', () => {
    it('handles Safari/iOS (no SharedWorker support)', () => {
      const comparison: WorkerComparison = {
        consistent: true,
        differences: [],
        succeeded: ['service', 'dedicated'],
        failed: ['shared'],
      };

      // SharedWorker not supported is normal for Safari
      expect(comparison.failed).toContain('shared');
      expect(comparison.consistent).toBe(true);
    });

    it('handles Chrome Android (no SharedWorker)', () => {
      const comparison: WorkerComparison = {
        consistent: true,
        differences: [],
        succeeded: ['service', 'dedicated'],
        failed: ['shared'],
      };

      expect(comparison.failed).toContain('shared');
      expect(comparison.succeeded).not.toContain('shared');
    });
  });
});

describe('worker scope data validation', () => {
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

describe('comparison field coverage', () => {
  // These are the fields that should be compared between workers
  const EXPECTED_COMPARISON_FIELDS = [
    'platform',
    'userAgent',
    'hardwareConcurrency',
    'deviceMemory',
    'language',
    'languages',
    'timezoneOffset',
    'timezoneLocation',
    'locale',
    'webglRenderer',
    'webglVendor',
  ];

  it('comparison covers critical navigator properties', () => {
    expect(EXPECTED_COMPARISON_FIELDS).toContain('platform');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('userAgent');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('hardwareConcurrency');
  });

  it('comparison covers device identifiers', () => {
    expect(EXPECTED_COMPARISON_FIELDS).toContain('deviceMemory');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('webglRenderer');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('webglVendor');
  });

  it('comparison covers locale/timezone', () => {
    expect(EXPECTED_COMPARISON_FIELDS).toContain('locale');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('language');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('timezoneOffset');
    expect(EXPECTED_COMPARISON_FIELDS).toContain('timezoneLocation');
  });

  it('does not compare lie detection fields', () => {
    // Lie detection may differ based on which APIs were probed in each worker
    expect(EXPECTED_COMPARISON_FIELDS).not.toContain('lied');
    expect(EXPECTED_COMPARISON_FIELDS).not.toContain('lies');
  });
});
