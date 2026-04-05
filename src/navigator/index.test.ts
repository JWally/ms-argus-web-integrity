import { describe, it, expect } from 'vitest';
import {
  VALID_DEVICE_MEMORY,
  VALID_DO_NOT_TRACK,
  KNOWN_PLATFORMS,
  PERMISSION_NAMES,
  HIGH_ENTROPY_UA_VALUES,
} from './constants';

describe('navigator constants', () => {
  describe('VALID_DEVICE_MEMORY', () => {
    it('contains all valid device memory values', () => {
      const validValues = ['0.25', '0.5', '1', '2', '4', '8'];
      for (const value of validValues) {
        expect(VALID_DEVICE_MEMORY[value]).toBe(true);
      }
    });

    it('has exactly 6 valid values', () => {
      expect(Object.keys(VALID_DEVICE_MEMORY).length).toBe(6);
    });

    it('returns undefined for invalid values', () => {
      expect(VALID_DEVICE_MEMORY['16']).toBeUndefined();
      expect(VALID_DEVICE_MEMORY['3']).toBeUndefined();
      expect(VALID_DEVICE_MEMORY['0.1']).toBeUndefined();
    });

    it('validates actual device memory API output', () => {
      // navigator.deviceMemory returns bucketed values
      // These are the only valid buckets per spec
      const specBuckets = [0.25, 0.5, 1, 2, 4, 8];
      for (const bucket of specBuckets) {
        expect(VALID_DEVICE_MEMORY[String(bucket)]).toBe(true);
      }
    });
  });

  describe('VALID_DO_NOT_TRACK', () => {
    it('accepts "1" (enabled)', () => {
      expect(VALID_DO_NOT_TRACK['1']).toBe(true);
    });

    it('accepts "0" (disabled)', () => {
      expect(VALID_DO_NOT_TRACK['0']).toBe(true);
    });

    it('accepts null/undefined (unspecified)', () => {
      expect(VALID_DO_NOT_TRACK['null']).toBe(true);
      expect(VALID_DO_NOT_TRACK['undefined']).toBe(true);
      expect(VALID_DO_NOT_TRACK['unspecified']).toBe(true);
    });

    it('accepts boolean-like values', () => {
      expect(VALID_DO_NOT_TRACK['true']).toBe(true);
      expect(VALID_DO_NOT_TRACK['false']).toBe(true);
      expect(VALID_DO_NOT_TRACK['yes']).toBe(true);
      expect(VALID_DO_NOT_TRACK['no']).toBe(true);
    });

    it('has 9 valid values', () => {
      expect(Object.keys(VALID_DO_NOT_TRACK).length).toBe(9);
    });
  });

  describe('KNOWN_PLATFORMS', () => {
    it('contains Windows platform', () => {
      expect(KNOWN_PLATFORMS).toContain('win');
    });

    it('contains Linux platform', () => {
      expect(KNOWN_PLATFORMS).toContain('linux');
    });

    it('contains Mac platform', () => {
      expect(KNOWN_PLATFORMS).toContain('mac');
    });

    it('contains iOS devices', () => {
      expect(KNOWN_PLATFORMS).toContain('iphone');
      expect(KNOWN_PLATFORMS).toContain('ipad');
      expect(KNOWN_PLATFORMS).toContain('ipod');
    });

    it('contains Android platform', () => {
      expect(KNOWN_PLATFORMS).toContain('android');
    });

    it('contains ARM platform', () => {
      expect(KNOWN_PLATFORMS).toContain('arm');
    });

    it('contains X11 (Unix/Linux display)', () => {
      expect(KNOWN_PLATFORMS).toContain('x11');
    });

    it('has 10 known platforms', () => {
      expect(KNOWN_PLATFORMS.length).toBe(10);
    });

    it('all values are lowercase', () => {
      for (const platform of KNOWN_PLATFORMS) {
        expect(platform).toBe(platform.toLowerCase());
      }
    });
  });

  describe('PERMISSION_NAMES', () => {
    it('contains common permissions', () => {
      const commonPermissions = [
        'camera',
        'microphone',
        'geolocation',
        'notifications',
        'clipboard',
      ];
      for (const permission of commonPermissions) {
        expect(PERMISSION_NAMES).toContain(permission);
      }
    });

    it('contains sensor permissions', () => {
      const sensorPermissions = [
        'accelerometer',
        'gyroscope',
        'magnetometer',
        'ambient-light-sensor',
      ];
      for (const permission of sensorPermissions) {
        expect(PERMISSION_NAMES).toContain(permission);
      }
    });

    it('contains audio/video permissions', () => {
      expect(PERMISSION_NAMES).toContain('camera');
      expect(PERMISSION_NAMES).toContain('microphone');
      expect(PERMISSION_NAMES).toContain('display-capture');
    });

    it('contains hardware permissions', () => {
      expect(PERMISSION_NAMES).toContain('bluetooth');
      expect(PERMISSION_NAMES).toContain('nfc');
      expect(PERMISSION_NAMES).toContain('midi');
      expect(PERMISSION_NAMES).toContain('gamepad');
    });

    it('has 22 permissions', () => {
      expect(PERMISSION_NAMES.length).toBe(22);
    });

    it('all values are kebab-case or lowercase', () => {
      for (const permission of PERMISSION_NAMES) {
        expect(permission).toMatch(/^[a-z-]+$/);
      }
    });
  });

  describe('HIGH_ENTROPY_UA_VALUES', () => {
    it('contains platform info', () => {
      expect(HIGH_ENTROPY_UA_VALUES).toContain('platform');
      expect(HIGH_ENTROPY_UA_VALUES).toContain('platformVersion');
    });

    it('contains architecture info', () => {
      expect(HIGH_ENTROPY_UA_VALUES).toContain('architecture');
      expect(HIGH_ENTROPY_UA_VALUES).toContain('bitness');
    });

    it('contains device info', () => {
      expect(HIGH_ENTROPY_UA_VALUES).toContain('model');
    });

    it('contains version info', () => {
      expect(HIGH_ENTROPY_UA_VALUES).toContain('uaFullVersion');
    });

    it('has 6 high-entropy values', () => {
      expect(HIGH_ENTROPY_UA_VALUES.length).toBe(6);
    });

    it('values are camelCase', () => {
      for (const value of HIGH_ENTROPY_UA_VALUES) {
        expect(value).toMatch(/^[a-z][a-zA-Z]*$/);
      }
    });
  });
});

// Test validation patterns
describe('navigator validation patterns', () => {
  describe('platform validation', () => {
    it('can validate navigator.platform values', () => {
      const testPlatforms = [
        { platform: 'Win32', expected: true },
        { platform: 'Linux x86_64', expected: true },
        { platform: 'MacIntel', expected: true },
        { platform: 'iPhone', expected: true },
        { platform: 'Android', expected: true },
        { platform: 'Unknown', expected: false },
      ];

      for (const { platform, expected } of testPlatforms) {
        const isKnown = KNOWN_PLATFORMS.some((p) =>
          platform.toLowerCase().includes(p),
        );
        expect(isKnown).toBe(expected);
      }
    });
  });

  describe('device memory validation', () => {
    it('validates common device memory values', () => {
      // Common real-world values
      expect(VALID_DEVICE_MEMORY['4']).toBe(true);
      expect(VALID_DEVICE_MEMORY['8']).toBe(true);
      expect(VALID_DEVICE_MEMORY['2']).toBe(true);
    });

    it('rejects non-standard values', () => {
      // Values that would indicate tampering
      expect(VALID_DEVICE_MEMORY['12']).toBeUndefined();
      expect(VALID_DEVICE_MEMORY['32']).toBeUndefined();
      expect(VALID_DEVICE_MEMORY['1.5']).toBeUndefined();
    });
  });
});
