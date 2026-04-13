import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTopSameOriginWindow } from './top-window';

describe('getTopSameOriginWindow', () => {
  // happy-dom gives each test a real `window`. We build fake parent
  // chains by mutating window.parent for the duration of a test.
  const originalParent = window.parent;

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      value: originalParent,
      configurable: true,
      writable: true,
    });
  });

  it('returns window when already at top (window.parent === window)', () => {
    // happy-dom default: window.parent === window
    expect(window.parent).toBe(window);
    expect(getTopSameOriginWindow()).toBe(window);
  });

  it('walks up one level to same-origin parent', () => {
    const fakeParent = {
      parent: undefined as unknown as Window,
      location: { href: 'https://example.com/' },
    } as unknown as Window;
    // self-reference at top so the walk terminates
    (fakeParent as unknown as { parent: unknown }).parent = fakeParent;

    Object.defineProperty(window, 'parent', {
      value: fakeParent,
      configurable: true,
    });

    expect(getTopSameOriginWindow()).toBe(fakeParent);
  });

  it('walks up multiple levels to topmost same-origin', () => {
    const top = {
      parent: undefined as unknown as Window,
      location: { href: 'https://example.com/' },
    } as unknown as Window;
    (top as unknown as { parent: unknown }).parent = top;

    const middle = {
      parent: top,
      location: { href: 'https://example.com/middle' },
    } as unknown as Window;

    Object.defineProperty(window, 'parent', {
      value: middle,
      configurable: true,
    });

    expect(getTopSameOriginWindow()).toBe(top);
  });

  it('stops at cross-origin wall — returns deepest same-origin ancestor', () => {
    // A cross-origin window's .location access throws DOMException.
    // Simulate by making .location getter throw.
    const crossOrigin = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'location') {
            throw new DOMException('cross-origin', 'SecurityError');
          }
          if (prop === 'parent') return crossOrigin;
          return undefined;
        },
      },
    ) as unknown as Window;

    const sameOrigin = {
      parent: crossOrigin,
      location: { href: 'https://example.com/' },
    } as unknown as Window;

    Object.defineProperty(window, 'parent', {
      value: sameOrigin,
      configurable: true,
    });

    // Should walk to sameOrigin, try to walk past, hit SecurityError, stop.
    expect(getTopSameOriginWindow()).toBe(sameOrigin);
  });

  it('handles cross-origin at first hop — returns window', () => {
    const crossOrigin = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'location') {
            throw new DOMException('cross-origin', 'SecurityError');
          }
          if (prop === 'parent') return crossOrigin;
          return undefined;
        },
      },
    ) as unknown as Window;

    Object.defineProperty(window, 'parent', {
      value: crossOrigin,
      configurable: true,
    });

    // Cross-origin barrier at the very first hop — stay at window.
    expect(getTopSameOriginWindow()).toBe(window);
  });
});
