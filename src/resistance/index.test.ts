import { describe, it, expect } from 'vitest';
import {
  DISABLED_HASH,
  FIREFOX_PRIVACY_FEATURES,
  TOR_DISABLED_FEATURES,
  TIMER_SAMPLE_COUNT,
} from './constants';

describe('resistance constants', () => {
  describe('DISABLED_HASH', () => {
    it('is 8-character hex string', () => {
      expect(DISABLED_HASH).toMatch(/^[0-9a-f]{8}$/);
    });

    it('is c767712b', () => {
      expect(DISABLED_HASH).toBe('c767712b');
    });
  });

  // NOTE: EXTENSION_PATTERNS and EXTENSION_MIN_LIES moved server-side
  // See TODO-server-side-analysis.md for extension detection requirements

  describe('FIREFOX_PRIVACY_FEATURES', () => {
    it('is an array of feature names', () => {
      expect(Array.isArray(FIREFOX_PRIVACY_FEATURES)).toBe(true);
      expect(FIREFOX_PRIVACY_FEATURES.length).toBeGreaterThan(0);

      for (const feature of FIREFOX_PRIVACY_FEATURES) {
        expect(typeof feature).toBe('string');
      }
    });

    it('includes audio and WebGL features', () => {
      expect(FIREFOX_PRIVACY_FEATURES).toContain('OfflineAudioContext');
      expect(FIREFOX_PRIVACY_FEATURES).toContain('WebGL2RenderingContext');
    });

    it('includes WebAssembly for safer mode detection', () => {
      expect(FIREFOX_PRIVACY_FEATURES).toContain('WebAssembly');
    });
  });

  describe('TOR_DISABLED_FEATURES', () => {
    it('is a Set of disabled feature names', () => {
      expect(TOR_DISABLED_FEATURES).toBeInstanceOf(Set);
      expect(TOR_DISABLED_FEATURES.size).toBeGreaterThan(0);
    });

    it('contains Tor-specific disabled APIs', () => {
      // Tor Browser disables these for WebRTC/device protection
      expect(TOR_DISABLED_FEATURES.has('RTCRtpTransceiver')).toBe(true);
      expect(TOR_DISABLED_FEATURES.has('MediaDevices')).toBe(true);
      expect(TOR_DISABLED_FEATURES.has('Credential')).toBe(true);
    });

    it('is subset of FIREFOX_PRIVACY_FEATURES', () => {
      for (const feature of TOR_DISABLED_FEATURES) {
        expect(FIREFOX_PRIVACY_FEATURES).toContain(feature);
      }
    });
  });

  describe('TIMER_SAMPLE_COUNT', () => {
    it('is 10 samples', () => {
      expect(TIMER_SAMPLE_COUNT).toBe(10);
    });

    it('is reasonable for precision detection', () => {
      // Should be enough samples to detect rounding patterns
      expect(TIMER_SAMPLE_COUNT).toBeGreaterThanOrEqual(5);
      expect(TIMER_SAMPLE_COUNT).toBeLessThanOrEqual(20);
    });
  });
});

// Test detection patterns
describe('resistance detection patterns', () => {
  describe('timer precision detection', () => {
    it('baseline date number extraction works', () => {
      const now = Date.now();
      const lastDigit = +('' + now).slice(-1);

      expect(lastDigit).toBeGreaterThanOrEqual(0);
      expect(lastDigit).toBeLessThanOrEqual(9);
    });

    it('regex for trailing digits works', () => {
      const baseNumber = 0;
      const regex = new RegExp(`${baseNumber}+$`);

      expect(regex.test('1234560')).toBe(true);
      expect(regex.test('1234500')).toBe(true);
      expect(regex.test('1234000')).toBe(true);
      expect(regex.test('1234567')).toBe(false);
    });

    it('can detect constant trailing digits', () => {
      // Simulated rounded timestamps (what Firefox resistFingerprinting produces)
      const roundedSamples = [
        '1704000000000',
        '1704000000000',
        '1704000000000',
      ];
      const normalSamples = ['1704000000123', '1704000000456', '1704000000789'];

      const roundedLastChars = roundedSamples.map((s) => s.slice(-1));
      const normalLastChars = normalSamples.map((s) => s.slice(-1));

      // Rounded should have all same last digits
      expect(roundedLastChars.every((c) => c === roundedLastChars[0])).toBe(
        true,
      );

      // Normal should have varying last digits
      const uniqueNormal = new Set(normalLastChars);
      expect(uniqueNormal.size).toBeGreaterThan(1);
    });
  });

  describe('Brave browser detection', () => {
    it('feature detection pattern for window APIs', () => {
      // These APIs are used to detect Brave protection modes
      const features = {
        FileSystemWritableFileStream: 'FileSystemWritableFileStream' in window,
        Serial: 'Serial' in window,
        ReportingObserver: 'ReportingObserver' in window,
      };

      // All should be booleans
      expect(typeof features.FileSystemWritableFileStream).toBe('boolean');
      expect(typeof features.Serial).toBe('boolean');
      expect(typeof features.ReportingObserver).toBe('boolean');
    });
  });

  describe('Firefox/Tor feature detection', () => {
    it('feature detection for Firefox privacy APIs', () => {
      const features = {
        OfflineAudioContext: 'OfflineAudioContext' in window,
        WebGL2RenderingContext: 'WebGL2RenderingContext' in window,
        WebAssembly: 'WebAssembly' in window,
        maxTouchPoints: 'maxTouchPoints' in navigator,
        RTCRtpTransceiver: 'RTCRtpTransceiver' in window,
        MediaDevices: 'MediaDevices' in window,
        Credential: 'Credential' in window,
      };

      // All should be booleans
      for (const [key, value] of Object.entries(features)) {
        expect(typeof value).toBe('boolean');
      }
    });
  });

  describe('extension hash pattern building', () => {
    it('strips Hash suffix from keys', () => {
      const hash = {
        contentDocumentHash: '0b637a33',
        contentWindowHash: '37e2f32e',
        getContextHash: '081d6d1b',
      };

      const pattern: Record<string, string> = {};
      for (const [key, value] of Object.entries(hash)) {
        if (value !== DISABLED_HASH) {
          pattern[key.replace('Hash', '')] = value;
        }
      }

      expect(pattern).toHaveProperty('contentDocument');
      expect(pattern).toHaveProperty('contentWindow');
      expect(pattern).toHaveProperty('getContext');
      expect(pattern).not.toHaveProperty('contentDocumentHash');
    });

    it('excludes disabled features', () => {
      const hash = {
        contentDocumentHash: '0b637a33',
        contentWindowHash: DISABLED_HASH,
        getContextHash: '081d6d1b',
      };

      const pattern: Record<string, string> = {};
      for (const [key, value] of Object.entries(hash)) {
        if (value !== DISABLED_HASH) {
          pattern[key.replace('Hash', '')] = value;
        }
      }

      expect(pattern).toHaveProperty('contentDocument');
      expect(pattern).not.toHaveProperty('contentWindow');
      expect(pattern).toHaveProperty('getContext');
    });
  });
});

// NOTE: Extension hash matching tests moved server-side
// See TODO-server-side-analysis.md for extension detection requirements
