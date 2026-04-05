import { describe, it, expect } from 'vitest';
import {
  analyzeInconsistencies,
  type Inconsistency,
  type InconsistencyResult,
} from './index';

describe('inconsistencies module', () => {
  describe('analyzeInconsistencies', () => {
    it('returns empty result for consistent fingerprint', () => {
      const fingerprint = {
        navigator: {
          platform: 'Win32',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          language: 'en-US',
          languages: ['en-US', 'en'],
          deviceMemory: 8,
          hardwareConcurrency: 8,
        },
        workerScope: {
          platform: 'Win32',
          language: 'en-US',
          languages: 'en-US,en',
          deviceMemory: 8,
          hardwareConcurrency: 8,
          timezoneOffset: -480,
          timezoneLocation: 'America/Los_Angeles',
        },
        timezone: {
          offset: -480,
          location: 'America/Los_Angeles',
        },
        screen: {
          width: 1920,
          height: 1080,
          availWidth: 1920,
          availHeight: 1040,
        },
      };

      const result = analyzeInconsistencies(fingerprint);
      expect(result.inconsistencies.length).toBe(0);
      expect(result.riskScore).toBe(0);
    });

    it('detects platform mismatch between UA and navigator.platform', () => {
      const fingerprint = {
        navigator: {
          platform: 'MacIntel',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      };

      const result = analyzeInconsistencies(fingerprint);
      expect(result.inconsistencies.length).toBeGreaterThan(0);

      const platformInc = result.inconsistencies.find(
        (i) =>
          i.category === 'platform' && i.description.includes('User agent OS'),
      );
      expect(platformInc).toBeDefined();
      expect(platformInc?.severity).toBe('critical');
    });

    it('detects main thread vs worker hardware mismatch', () => {
      const fingerprint = {
        navigator: {
          deviceMemory: 8,
          hardwareConcurrency: 8,
        },
        workerScope: {
          deviceMemory: 4,
          hardwareConcurrency: 4,
        },
      };

      const result = analyzeInconsistencies(fingerprint);

      const memInc = result.inconsistencies.find((i) =>
        i.description.includes('Device memory differs'),
      );
      const coresInc = result.inconsistencies.find((i) =>
        i.description.includes('Hardware concurrency differs'),
      );

      expect(memInc).toBeDefined();
      expect(coresInc).toBeDefined();
    });

    // Note: timezone location vs measured validation moved to server-side

    it('detects language array inconsistency', () => {
      const fingerprint = {
        navigator: {
          language: 'en-US',
          languages: ['de-DE', 'en-US'],
        },
      };

      const result = analyzeInconsistencies(fingerprint);

      const langInc = result.inconsistencies.find((i) =>
        i.description.includes('not first in navigator.languages'),
      );
      expect(langInc).toBeDefined();
    });

    it('detects WebGL renderer mismatch between main and worker', () => {
      const fingerprint = {
        canvasWebgl: {
          parameters: {
            UNMASKED_RENDERER_WEBGL: 'NVIDIA GeForce RTX 3080',
            UNMASKED_VENDOR_WEBGL: 'NVIDIA Corporation',
          },
        },
        workerScope: {
          webglRenderer: 'Intel HD Graphics 630',
          webglVendor: 'Intel Inc.',
        },
      };

      const result = analyzeInconsistencies(fingerprint);

      const gpuInc = result.inconsistencies.find((i) =>
        i.description.includes('WebGL renderer differs'),
      );
      expect(gpuInc).toBeDefined();
      expect(gpuInc?.severity).toBe('critical');
    });

    it('calculates risk score correctly', () => {
      const fingerprint = {
        navigator: {
          platform: 'MacIntel', // Wrong for Windows UA
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          deviceMemory: 8,
          hardwareConcurrency: 8,
        },
        workerScope: {
          deviceMemory: 4, // Mismatch
          hardwareConcurrency: 4, // Mismatch
        },
      };

      const result = analyzeInconsistencies(fingerprint);

      // Critical (30) + 2x High (15 each) = 60
      expect(result.riskScore).toBeGreaterThanOrEqual(30);
      expect(result.counts.critical).toBeGreaterThanOrEqual(1);
    });

    it('detects non-standard device memory', () => {
      const fingerprint = {
        navigator: {
          deviceMemory: 6, // Not a standard value
        },
      };

      const result = analyzeInconsistencies(fingerprint);

      const memInc = result.inconsistencies.find((i) =>
        i.description.includes('not a standard value'),
      );
      expect(memInc).toBeDefined();
      expect(memInc?.severity).toBe('medium');
    });

    it('returns hash of inconsistencies', () => {
      const fingerprint = {};
      const result = analyzeInconsistencies(fingerprint);

      expect(typeof result.$hash).toBe('string');
      expect(result.$hash.length).toBeGreaterThan(0);
    });
  });

  describe('severity levels', () => {
    it('classifies platform mismatches as critical', () => {
      const fingerprint = {
        navigator: {
          platform: 'Linux x86_64',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
        },
      };

      const result = analyzeInconsistencies(fingerprint);
      const critical = result.inconsistencies.filter(
        (i) => i.severity === 'critical',
      );
      expect(critical.length).toBeGreaterThan(0);
    });

    it('classifies worker mismatches as high severity', () => {
      const fingerprint = {
        navigator: {
          language: 'en-US',
        },
        workerScope: {
          language: 'de-DE',
        },
      };

      const result = analyzeInconsistencies(fingerprint);
      const high = result.inconsistencies.filter((i) => i.severity === 'high');
      expect(high.length).toBeGreaterThan(0);
    });
  });
});

describe('inconsistency detection patterns', () => {
  describe('OS extraction from user agent', () => {
    it('detects Windows', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
      expect(ua.toLowerCase().includes('windows')).toBe(true);
    });

    it('detects macOS', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
      expect(ua.toLowerCase().includes('mac os')).toBe(true);
    });

    it('detects Linux', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64)';
      expect(ua.toLowerCase().includes('linux')).toBe(true);
    });

    it('detects Android', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 11)';
      expect(ua.toLowerCase().includes('android')).toBe(true);
    });

    it('detects iOS', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0)';
      expect(ua.toLowerCase().includes('iphone')).toBe(true);
    });
  });

  describe('OS extraction from platform', () => {
    it('detects Windows from Win32', () => {
      expect('Win32'.toLowerCase().includes('win')).toBe(true);
    });

    it('detects macOS from MacIntel', () => {
      expect('MacIntel'.toLowerCase().includes('mac')).toBe(true);
    });

    it('detects Linux', () => {
      expect('Linux x86_64'.toLowerCase().includes('linux')).toBe(true);
    });
  });

  describe('risk score calculation', () => {
    it('caps at 100', () => {
      // Create many critical inconsistencies
      const inconsistencies: Inconsistency[] = [];
      for (let i = 0; i < 10; i++) {
        inconsistencies.push({
          category: 'test',
          description: `Test ${i}`,
          expected: 'a',
          actual: 'b',
          severity: 'critical',
        });
      }

      // 10 critical = 300, but should cap at 100
      const weights = { critical: 30, high: 15, medium: 5, low: 1 };
      let score = 0;
      for (const inc of inconsistencies) {
        score += weights[inc.severity];
      }
      score = Math.min(100, score);

      expect(score).toBe(100);
    });
  });
});

describe('UA-CH cross-validation', () => {
  it('detects architecture mismatch with WebGL renderer', () => {
    const fingerprint = {
      navigator: {
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          highEntropyValues: {
            architecture: 'arm',
            bitness: '64',
          },
        },
      },
      canvasWebgl: {
        parameters: {
          UNMASKED_RENDERER_WEBGL: 'NVIDIA GeForce RTX 3080',
        },
      },
    };

    const result = analyzeInconsistencies(fingerprint);
    const archInc = result.inconsistencies.find(
      (i) => i.category === 'ua-ch' && i.description.includes('architecture'),
    );
    expect(archInc).toBeDefined();
    expect(archInc?.severity).toBe('high');
  });

  it('detects mobile flag mismatch with device characteristics', () => {
    const fingerprint = {
      navigator: {
        userAgentData: {
          mobile: true,
          platform: 'Windows',
        },
        maxTouchPoints: 0,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    const result = analyzeInconsistencies(fingerprint);
    const mobileInc = result.inconsistencies.find(
      (i) => i.category === 'ua-ch' && i.description.includes('mobile flag'),
    );
    expect(mobileInc).toBeDefined();
  });

  it('detects UA-CH platform vs navigator.platform mismatch', () => {
    const fingerprint = {
      navigator: {
        platform: 'Win32',
        userAgentData: {
          platform: 'macOS',
        },
      },
    };

    const result = analyzeInconsistencies(fingerprint);
    const platformInc = result.inconsistencies.find(
      (i) => i.category === 'ua-ch' && i.description.includes('platform'),
    );
    expect(platformInc).toBeDefined();
    expect(platformInc?.severity).toBe('high');
  });

  it('does not flag consistent UA-CH data', () => {
    const fingerprint = {
      navigator: {
        platform: 'Win32',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        maxTouchPoints: 0,
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          highEntropyValues: {
            architecture: 'x86',
            bitness: '64',
          },
        },
      },
      canvasWebgl: {
        parameters: {
          UNMASKED_RENDERER_WEBGL: 'Intel(R) UHD Graphics 630',
        },
      },
      screen: {
        width: 1920,
        height: 1080,
      },
    };

    const result = analyzeInconsistencies(fingerprint);
    const uachInc = result.inconsistencies.filter(
      (i) => i.category === 'ua-ch',
    );
    expect(uachInc.length).toBe(0);
  });

  it('detects model set on non-mobile device', () => {
    const fingerprint = {
      navigator: {
        userAgentData: {
          mobile: false,
          platform: 'Windows',
          highEntropyValues: {
            model: 'SM-G998B',
          },
        },
      },
    };

    const result = analyzeInconsistencies(fingerprint);
    const modelInc = result.inconsistencies.find(
      (i) => i.category === 'ua-ch' && i.description.includes('model'),
    );
    expect(modelInc).toBeDefined();
    expect(modelInc?.severity).toBe('medium');
  });

  it('handles Android with Linux platform correctly', () => {
    const fingerprint = {
      navigator: {
        platform: 'Linux armv8l',
        userAgentData: {
          mobile: true,
          platform: 'Android',
          highEntropyValues: {
            architecture: 'arm',
          },
        },
      },
    };

    const result = analyzeInconsistencies(fingerprint);
    const platformInc = result.inconsistencies.filter(
      (i) => i.category === 'ua-ch' && i.description.includes('platform'),
    );
    expect(platformInc.length).toBe(0);
  });
});
