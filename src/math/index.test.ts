import { describe, it, expect, vi, afterEach } from 'vitest';
import getMathPrecision from './index';

describe('getMathPrecision', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a hash string and data array', () => {
    const result = getMathPrecision();
    expect(result).toBeDefined();
    expect(result!.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(result!.data).toHaveLength(8);
    expect(result!.lied).toBe(false);
  });

  it('returns consistent results across calls', () => {
    const a = getMathPrecision();
    const b = getMathPrecision();
    expect(a!.hash).toBe(b!.hash);
    expect(a!.data).toEqual(b!.data);
  });

  it('data contains numbers (not NaN for standard engines)', () => {
    const result = getMathPrecision();
    for (const val of result!.data) {
      expect(typeof val).toBe('number');
    }
  });

  it('detects tampering when Math function returns inconsistent results', () => {
    let callCount = 0;
    vi.spyOn(Math, 'asinh').mockImplementation(() => {
      callCount++;
      return callCount % 2 === 0 ? 1.111 : 2.222;
    });

    const result = getMathPrecision();
    expect(result).toBeDefined();
    expect(result!.lied).toBe(true);
  });
});
