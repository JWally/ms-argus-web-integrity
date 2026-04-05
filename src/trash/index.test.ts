import { describe, it, expect } from 'vitest';
import {
  gibberish,
  compressWebGLRenderer,
  getWebGLRendererParts,
  hardenWebGLRenderer,
  getWebGLRendererConfidence,
  proxyBehavior,
  trustInteger,
} from './index';

describe('trash module', () => {
  describe('gibberish()', () => {
    it('returns empty array for empty string', () => {
      expect(gibberish('')).toEqual([]);
    });

    it('returns empty array for valid product names', () => {
      expect(gibberish('NVIDIA GeForce RTX 3080')).toEqual([]);
      expect(gibberish('AMD Radeon RX 6800')).toEqual([]);
      expect(gibberish('Intel HD Graphics 630')).toEqual([]);
    });

    it('detects gibberish letter sequences in strict mode', () => {
      // Random string with unlikely letter combinations
      const result = gibberish('qxzfbqxz', { strict: true });
      expect(result.length).toBeGreaterThan(0);
    });

    it('detects unusual case patterns', () => {
      // aBCD pattern (lowercase followed by multiple uppercase)
      const result = gibberish('aBCDeFGH', { strict: true });
      expect(result.length).toBeGreaterThan(0);
    });

    it('allows whitelisted patterns like fx, mx, vm', () => {
      // These appear in legitimate GPU names
      expect(gibberish('GeForce FX 5200')).toEqual([]);
      expect(gibberish('GeForce MX 450')).toEqual([]);
      expect(gibberish('VirtualBox')).toEqual([]);
    });
  });

  describe('compressWebGLRenderer()', () => {
    it('returns undefined for empty input', () => {
      expect(compressWebGLRenderer('')).toBeUndefined();
    });

    it('removes ANGLE wrapper', () => {
      const result = compressWebGLRenderer(
        'ANGLE (NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0)',
      );
      expect(result).not.toContain('ANGLE');
      expect(result).not.toContain('Direct3D');
    });

    it('removes driver version info', () => {
      const result = compressWebGLRenderer('NVIDIA 528.49');
      expect(result).not.toMatch(/\d{3}\.\d{2}/);
    });

    it('normalizes model numbers to generic form', () => {
      // RTX 3080 -> RTX 3000s
      const result = compressWebGLRenderer('GeForce RTX 3080');
      expect(result).toContain('3');
      expect(result).toContain('s');
    });

    it('normalizes Ti variants and GB memory specs', () => {
      const result = compressWebGLRenderer('GeForce RTX 3080 Ti 12GB');
      // Normalizes model number to generic series (3080 -> 3000s)
      // Memory specs may be normalized or retained based on implementation
      expect(result).toBeDefined();
      expect(result).toContain('GeForce');
    });
  });

  describe('getWebGLRendererParts()', () => {
    it('returns empty string for unknown renderer', () => {
      expect(getWebGLRendererParts('Unknown GPU XYZ')).toBe('');
    });

    it('finds NVIDIA in renderer string', () => {
      const result = getWebGLRendererParts('NVIDIA GeForce GTX 1080');
      expect(result).toContain('NVIDIA');
      expect(result).toContain('GeForce');
    });

    it('finds AMD/Radeon in renderer string', () => {
      const result = getWebGLRendererParts('AMD Radeon RX 6800');
      expect(result).toContain('AMD');
      expect(result).toContain('Radeon');
    });

    it('finds Intel in renderer string', () => {
      const result = getWebGLRendererParts('Intel(R) UHD Graphics 630');
      expect(result).toContain('Intel');
    });

    it('finds ANGLE wrapper', () => {
      const result = getWebGLRendererParts('ANGLE (NVIDIA GeForce)');
      expect(result).toContain('ANGLE');
    });

    it('finds virtual machine indicators', () => {
      expect(getWebGLRendererParts('VMware SVGA 3D')).toContain('VMware');
      expect(getWebGLRendererParts('VirtualBox Graphics')).toContain(
        'VirtualBox',
      );
    });

    it('returns sorted, deduplicated parts', () => {
      const result = getWebGLRendererParts('NVIDIA NVIDIA GeForce');
      // Should not have duplicate NVIDIA
      const parts = result.split(', ');
      expect(parts.length).toBe(new Set(parts).size);
    });
  });

  describe('hardenWebGLRenderer()', () => {
    it('returns compressed form for known GPU', () => {
      const result = hardenWebGLRenderer('NVIDIA GeForce GTX 1080');
      expect(result).toBeDefined();
      expect(result).not.toContain('1080'); // Normalized away
    });

    it('returns original for unknown GPU', () => {
      const result = hardenWebGLRenderer('Random Fake GPU');
      expect(result).toBe('Random Fake GPU');
    });
  });

  describe('getWebGLRendererConfidence()', () => {
    it('returns undefined for empty renderer', () => {
      expect(getWebGLRendererConfidence('')).toBeUndefined();
    });

    it('returns high confidence for valid NVIDIA renderer', () => {
      const result = getWebGLRendererConfidence(
        'ANGLE (NVIDIA GeForce GTX 1080)',
      );
      expect(result).toBeDefined();
      expect(result!.confidence).toBe('high');
      expect(result!.grade).toBe('A');
      expect(result!.parts).toContain('NVIDIA');
    });

    it('returns low confidence for unknown renderer', () => {
      const result = getWebGLRendererConfidence('Fake Unknown GPU XYZ');
      expect(result).toBeDefined();
      expect(result!.confidence).toBe('low');
      expect(result!.grade).toBe('F');
    });

    it('warns about extra whitespace', () => {
      const result = getWebGLRendererConfidence('NVIDIA  GeForce'); // double space
      expect(result!.warnings).toContain('found extra spaces');
    });

    it('warns about broken ANGLE structure', () => {
      const result = getWebGLRendererConfidence('ANGLE NVIDIA GeForce'); // missing parens
      expect(result!.warnings).toContain('broken angle structure');
    });

    it('detects gibberish in renderer', () => {
      const result = getWebGLRendererConfidence('NVIDIA qxzfbq GeForce');
      expect(result!.gibbers.length).toBeGreaterThan(0);
    });
  });

  describe('proxyBehavior()', () => {
    it('returns true for functions', () => {
      expect(proxyBehavior(() => {})).toBe(true);
      expect(proxyBehavior(function () {})).toBe(true);
    });

    it('returns false for non-functions', () => {
      expect(proxyBehavior('string')).toBe(false);
      expect(proxyBehavior(123)).toBe(false);
      expect(proxyBehavior({})).toBe(false);
      expect(proxyBehavior(null)).toBe(false);
      expect(proxyBehavior(undefined)).toBe(false);
    });
  });

  describe('trustInteger()', () => {
    it('returns the value for valid integers', () => {
      expect(trustInteger('test', 42)).toBe(42);
      expect(trustInteger('test', 0)).toBe(0);
      expect(trustInteger('test', -5)).toBe(-5);
    });

    it('returns undefined for non-integers', () => {
      expect(trustInteger('test', 3.14)).toBeUndefined();
      expect(trustInteger('test', 'string')).toBeUndefined();
      expect(trustInteger('test', null)).toBeUndefined();
      expect(trustInteger('test', undefined)).toBeUndefined();
      expect(trustInteger('test', NaN)).toBeUndefined();
    });
  });
});
