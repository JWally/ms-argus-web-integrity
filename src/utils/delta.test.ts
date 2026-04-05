import { describe, it, expect } from 'vitest';
import { removeVolatile } from './delta';

describe('removeVolatile', () => {
  it('keeps identical primitives', () => {
    expect(removeVolatile(42, 42)).toBe(42);
    expect(removeVolatile('hello', 'hello')).toBe('hello');
    expect(removeVolatile(true, true)).toBe(true);
  });

  it('removes differing primitives', () => {
    expect(removeVolatile(42, 43)).toBeUndefined();
    expect(removeVolatile('a', 'b')).toBeUndefined();
    expect(removeVolatile(true, false)).toBeUndefined();
  });

  it('keeps identical arrays', () => {
    expect(removeVolatile([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('removes differing arrays', () => {
    expect(removeVolatile([1, 2, 3], [1, 2, 4])).toBeUndefined();
    expect(removeVolatile([1, 2], [1, 2, 3])).toBeUndefined();
  });

  it('recursively filters objects, keeping only stable keys', () => {
    const run1 = {
      stableKey: 'same',
      volatileKey: 'run1-value',
      nested: {
        stableNested: 100,
        volatileNested: 0.123456,
      },
    };
    const run2 = {
      stableKey: 'same',
      volatileKey: 'run2-value',
      nested: {
        stableNested: 100,
        volatileNested: 0.789012,
      },
    };

    const result = removeVolatile(run1, run2);
    expect(result).toEqual({
      stableKey: 'same',
      nested: {
        stableNested: 100,
      },
    });
  });

  it('returns undefined if all keys differ', () => {
    const result = removeVolatile({ a: 1 }, { a: 2 });
    expect(result).toBeUndefined();
  });

  it('handles null/undefined values', () => {
    expect(removeVolatile(null, null)).toBeNull();
    expect(removeVolatile(undefined, undefined)).toBeUndefined();
    expect(removeVolatile(null, 'something')).toBeUndefined();
    expect(removeVolatile('something', null)).toBeUndefined();
  });

  it('simulates real canvas2d delta detection', () => {
    const run1 = {
      dataURI: 'abc123',
      paintURI: 'def456',
      textMetricsSystemSum: 0.00423,
      emojiSet: ['a', 'b', 'c'],
      mods: { pixelImage: 'volatile1', pixels: 53 },
      lied: false,
    };
    const run2 = {
      dataURI: 'xyz789', // canvas randomized
      paintURI: 'ghi012', // canvas randomized
      textMetricsSystemSum: 0.00423, // stable
      emojiSet: ['a', 'b', 'c'], // stable
      mods: { pixelImage: 'volatile2', pixels: 49 }, // both volatile
      lied: false,
    };

    const result = removeVolatile(run1, run2);
    expect(result).toEqual({
      textMetricsSystemSum: 0.00423,
      emojiSet: ['a', 'b', 'c'],
      // mods dropped entirely since all its keys are volatile
      lied: false,
    });
  });

  it('drops empty nested objects', () => {
    const run1 = { nested: { a: 1 } };
    const run2 = { nested: { a: 2 } };
    // nested has no stable keys, so it should be dropped
    expect(removeVolatile(run1, run2)).toBeUndefined();
  });
});
