import { afterEach, describe, expect, it } from 'vitest';

import {
  getPristineRefs,
  resetPristineRefsForTesting,
} from './pristine-iframe';

describe('getPristineRefs', () => {
  afterEach(() => {
    resetPristineRefsForTesting();
  });

  it('returns the same singleton across calls', () => {
    const a = getPristineRefs();
    const b = getPristineRefs();
    expect(a).toBe(b);
  });

  it('exposes every PristineRefs field as a non-undefined value', () => {
    const refs = getPristineRefs();
    expect(typeof refs.stringify).toBe('function');
    expect(typeof refs.parse).toBe('function');
    expect(typeof refs.textEncode).toBe('function');
    expect(typeof refs.perfNow).toBe('function');
    expect(typeof refs.getRandomValues).toBe('function');
    expect(typeof refs.randomUUID).toBe('function');
    expect(typeof refs.lifted).toBe('boolean');
    // subtle / native sources can be null when lift fails (happy-dom).
    // Just confirm the keys exist on the returned object.
    expect('subtle' in refs).toBe(true);
    expect('getRandomValuesNativeSource' in refs).toBe(true);
    expect('randomUUIDNativeSource' in refs).toBe(true);
  });

  it('getRandomValues fills a Uint8Array (real RNG behavior)', () => {
    const refs = getPristineRefs();
    const buf = new Uint8Array(32);
    // Pre-condition: all zeros
    expect(buf.every((v) => v === 0)).toBe(true);
    refs.getRandomValues(buf);
    // Post-condition: at least one byte was set (collision probability
    // of all-zeros across 32 bytes is 2^-256).
    expect(buf.some((v) => v !== 0)).toBe(true);
  });

  it('randomUUID returns an RFC 4122 v4 shape', () => {
    const refs = getPristineRefs();
    const uuid = refs.randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('randomUUID produces unique values across calls', () => {
    const refs = getPristineRefs();
    const seen = new Set<string>();
    for (let i = 0; i < 16; i++) seen.add(refs.randomUUID());
    expect(seen.size).toBe(16);
  });

  it('captures a non-empty source text snapshot when refs are present', () => {
    const refs = getPristineRefs();
    // Real browsers expose `function getRandomValues() { [native code] }`;
    // happy-dom exposes a JS polyfill body. Either way the snapshot
    // must be a non-trivial string so the cross-realm comparison in
    // the status slice has something to compare against.
    if (refs.getRandomValuesNativeSource !== null) {
      expect(refs.getRandomValuesNativeSource.length).toBeGreaterThan(10);
    }
    if (refs.randomUUIDNativeSource !== null) {
      expect(refs.randomUUIDNativeSource.length).toBeGreaterThan(10);
    }
  });

  it('cross-realm source-text equals page-realm in unhooked state', () => {
    // The whole point of the cross-realm check: if neither the page
    // nor the iframe has been hooked, the two source texts agree.
    // A page-realm `Object.defineProperty` hook would break this
    // equality without touching the iframe — which is the attack we
    // want to detect.
    const refs = getPristineRefs();
    if (
      refs.getRandomValuesNativeSource !== null &&
      typeof crypto?.getRandomValues === 'function'
    ) {
      const pageSrc = Function.prototype.toString.call(crypto.getRandomValues);
      expect(pageSrc).toBe(refs.getRandomValuesNativeSource);
    }
  });

  it('lifted is true iff every primary ref was successfully captured', () => {
    const refs = getPristineRefs();
    // When lifted is true, every required ref must be non-null. When
    // false, at least one fell back to top-level — and the fallbacks
    // are still callable, just unhardened.
    if (refs.lifted) {
      expect(refs.subtle).not.toBeNull();
      expect(refs.getRandomValuesNativeSource).not.toBeNull();
    }
  });
});
