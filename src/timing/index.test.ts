import { describe, it, expect, vi, beforeEach } from 'vitest';
import getTimingFingerprint from './index';

describe('timing module', () => {
  beforeEach(() => {
    vi.stubGlobal('crossOriginIsolated', false);
  });

  it('returns timing fingerprint', async () => {
    const result = await getTimingFingerprint();

    expect(result).toBeDefined();
    expect(result?.highPrecision).toBe(false);
    expect(typeof result?.resolution).toBe('number');
    expect(typeof result?.drift).toBe('number');
    expect(typeof result?.tcpConnect).toBe('number');
    expect(typeof result?.tlsHandshake).toBe('number');
    expect(typeof result?.navigationProtocol).toBe('string');
    expect(Array.isArray(result?.resourceProtocols)).toBe(true);
    expect(typeof result?.$hash).toBe('string');
  });

  it('resolution is non-negative', async () => {
    const result = await getTimingFingerprint();
    expect(result?.resolution).toBeGreaterThanOrEqual(0);
    expect(result?.resolution).toBeLessThanOrEqual(200);
  });

  it('drift is small for well-behaved clocks', async () => {
    const result = await getTimingFingerprint();
    expect(result?.drift).toBeLessThan(100);
  });

  it('highPrecision true when crossOriginIsolated', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    const result = await getTimingFingerprint();
    expect(result?.highPrecision).toBe(true);
  });

  it('hash is defined', async () => {
    const result = await getTimingFingerprint();
    expect(result?.$hash).toBeDefined();
    expect(result?.$hash.length).toBeGreaterThan(0);
  });
});
