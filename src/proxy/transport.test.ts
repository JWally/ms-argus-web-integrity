import { describe, expect, it } from 'vitest';
import { scramblePayload } from './transport';

describe('proxy_v1 transport', () => {
  it('uses the reversible v3 Fibonacci scramble', () => {
    const json = JSON.stringify({ product: 'proxy_v1', value: 'héllo' });
    const token = '0123456789abcdef';
    const scrambled = scramblePayload(json, token);
    expect(scrambled).not.toBe(json);
    expect(scramblePayload(scrambled, token)).toBe(json);
  });
});
