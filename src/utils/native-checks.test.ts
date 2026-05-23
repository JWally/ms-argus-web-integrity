import { describe, it, expect } from 'vitest';

import {
  hasNonTrivialVariance,
  isNativeFn,
  isNativeMethodValidatesThis,
  isNativeSource,
  isNativeStaticThrowsOnArg,
} from './native-checks';

describe('isNativeFn', () => {
  it('returns true for engine-provided natives', () => {
    expect(isNativeFn(Math.random)).toBe(true);
    expect(isNativeFn(Date.now)).toBe(true);
    expect(isNativeFn(Object.getOwnPropertyNames)).toBe(true);
    expect(isNativeFn(Array.prototype.slice)).toBe(true);
  });

  it('returns false for user-defined functions', () => {
    expect(isNativeFn(() => 0)).toBe(false);
    expect(isNativeFn(function named() {})).toBe(false);
    expect(isNativeFn(async () => 0)).toBe(false);
  });

  it('returns false for non-function inputs', () => {
    expect(isNativeFn(null)).toBe(false);
    expect(isNativeFn(undefined)).toBe(false);
    expect(isNativeFn({})).toBe(false);
    expect(isNativeFn(42)).toBe(false);
    expect(isNativeFn('function(){}')).toBe(false);
  });

  it('is fooled by Proxy-on-native (the v5 attack the behavioral checks close)', () => {
    // V8 forwards Function.prototype.toString to a Proxy's target, so a
    // Proxy wrapping a real native reports `[native code]`. This is the
    // attack `isNativeMethodValidatesThis` and `isNativeStaticThrowsOnArg`
    // exist to catch — `isNativeFn` alone is necessary but not sufficient.
    const fakeRandom = new Proxy(Math.random, {
      apply() {
        return 0.5; // returns predictable value, breaks crypto
      },
    });
    expect(isNativeFn(fakeRandom)).toBe(true); // fooled — that's the point
  });
});

// Helpers — wrap a real native in a Proxy that overrides apply(). V8 forwards
// Function.prototype.toString to the proxy's target, so the wrapped value
// passes `isNativeFn` (the v5 attack the behavioral checks exist to close).
// happy-dom doesn't enforce V8's strict receiver/arg-validation TypeErrors on
// the real DOM/crypto natives, so we use Map.prototype.get (engine-level
// builtin) as the validates-this exemplar and exercise the helpers via
// Proxy-on-native — the same shape that catches real attackers.

describe('isNativeMethodValidatesThis', () => {
  it('returns true for engine-level natives that validate this', () => {
    // Map.prototype.get is a V8 builtin enforced in both V8 itself and
    // happy-dom's runtime (vs DOM methods which happy-dom stubs loosely).
    // Real native: Map.prototype.get.call({}, 'k') → TypeError.
    expect(isNativeMethodValidatesThis(Map.prototype.get)).toBe(true);
    expect(isNativeMethodValidatesThis(Set.prototype.has)).toBe(true);
    expect(isNativeMethodValidatesThis(WeakMap.prototype.get)).toBe(true);
  });

  it('returns false when called on a non-method native (no this validation)', () => {
    // Math.random / Date.now don't validate this — `.call({})` returns
    // normally, so this check correctly identifies them as not-this-validators.
    expect(isNativeMethodValidatesThis(Math.random)).toBe(false);
    expect(isNativeMethodValidatesThis(Date.now)).toBe(false);
  });

  it('catches a permissive Proxy apply trap (the v5 attack)', () => {
    // Wrap a real this-validating native. The proxy reports [native code]
    // (V8 forwards toString) but its apply trap returns a value without
    // re-implementing the receiver-validation TypeError that the real
    // binding would throw.
    let counter = 0;
    const fakeMapGet = new Proxy(Map.prototype.get, {
      apply() {
        return ++counter;
      },
    });
    expect(isNativeFn(fakeMapGet)).toBe(true); // toString trick survives
    expect(isNativeMethodValidatesThis(fakeMapGet)).toBe(false); // behavior tells
  });

  it('returns true when an apply trap faithfully replicates the TypeError (v6-shape attack)', () => {
    // The v6 attack — apply trap re-implements the this-validation. This
    // check alone can't tell them apart, but each behavioral signature
    // the attacker has to fake raises the cost wall. Cross-clock + use-site
    // checks at multiple APIs stack the cost.
    const fakeMapGet = new Proxy(Map.prototype.get, {
      apply(target, thisArg, args) {
        if (!(thisArg instanceof Map)) {
          throw new TypeError(
            'Method Map.prototype.get called on incompatible receiver',
          );
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    expect(isNativeMethodValidatesThis(fakeMapGet)).toBe(true); // attacker now faking behavior too
  });

  it('returns false for non-functions', () => {
    expect(isNativeMethodValidatesThis(null)).toBe(false);
    expect(isNativeMethodValidatesThis({})).toBe(false);
    expect(isNativeMethodValidatesThis(undefined)).toBe(false);
  });
});

describe('isNativeStaticThrowsOnArg', () => {
  it('returns true for native that throws TypeError on the bad arg', () => {
    // Use a real native that consistently throws TypeError on an invalid
    // argument across V8 and happy-dom: Number.parseInt isn't it (returns
    // NaN), but `Object.defineProperty(null, ...)` throws TypeError —
    // engine-level enforced.
    expect(isNativeStaticThrowsOnArg(Object.defineProperty, null)).toBe(true);
    // `Reflect.ownKeys(non-object)` throws TypeError.
    expect(isNativeStaticThrowsOnArg(Reflect.ownKeys, 42)).toBe(true);
  });

  it('catches a Proxy that returns without throwing (the v5 attack on a static)', () => {
    // Wrap a real native; permissive apply trap silently returns instead of
    // throwing the arg-validation TypeError. This is the attack shape that
    // a tampered crypto.getRandomValues would have.
    const fakeRng = new Proxy(Object.defineProperty, {
      apply(_t, _this, [arg]) {
        return arg; // doesn't throw on null target
      },
    });
    expect(isNativeFn(fakeRng)).toBe(true); // shape passes
    expect(isNativeStaticThrowsOnArg(fakeRng, null)).toBe(false); // behavior fails
  });

  it('returns false for non-functions', () => {
    expect(isNativeStaticThrowsOnArg(null, {})).toBe(false);
    expect(isNativeStaticThrowsOnArg(undefined, {})).toBe(false);
    expect(isNativeStaticThrowsOnArg('not a fn', {})).toBe(false);
  });

  it('returns false when the function throws something other than TypeError', () => {
    // RangeError, SyntaxError, plain Error — none qualify. Only TypeError
    // confirms the engine's argument-validation path actually ran.
    const throwsRangeError = (): never => {
      throw new RangeError('nope');
    };
    expect(isNativeStaticThrowsOnArg(throwsRangeError, {})).toBe(false);
  });
});

describe('isNativeSource', () => {
  it('matches the `[native code]` shape across whitespace variants', () => {
    expect(isNativeSource('function name() { [native code] }')).toBe(true);
    expect(isNativeSource('function bound name() {\n  [native code]\n}')).toBe(
      true,
    );
    expect(isNativeSource('function () {[native code]}')).toBe(true);
  });

  it('rejects user-defined function source text', () => {
    expect(isNativeSource('function () { return 1; }')).toBe(false);
    expect(isNativeSource('() => 0')).toBe(false);
    expect(isNativeSource('')).toBe(false);
  });
});

describe('hasNonTrivialVariance', () => {
  it('returns true for Math.random (real uniform RNG)', () => {
    expect(hasNonTrivialVariance(Math.random)).toBe(true);
  });

  it('returns false for a stubbed constant', () => {
    expect(hasNonTrivialVariance(() => 0.5)).toBe(false);
    expect(hasNonTrivialVariance(() => 0)).toBe(false);
  });

  it('returns false when output exits [0, 1)', () => {
    // Above 1 → fails the range check
    expect(hasNonTrivialVariance(() => 1.5)).toBe(false);
    // Negative → fails range check
    expect(hasNonTrivialVariance(() => -0.1)).toBe(false);
    // Exactly 1 → not in [0, 1) per spec
    expect(hasNonTrivialVariance(() => 1)).toBe(false);
  });

  it('returns false for non-number or non-finite output', () => {
    expect(
      hasNonTrivialVariance((() => 'oops') as unknown as () => number),
    ).toBe(false);
    expect(hasNonTrivialVariance(() => Infinity)).toBe(false);
    expect(hasNonTrivialVariance(() => NaN)).toBe(false);
  });

  it('returns false if the function throws', () => {
    expect(
      hasNonTrivialVariance(() => {
        throw new Error('rng broken');
      }),
    ).toBe(false);
  });

  it('returns true for a synthetic spread above the variance floor', () => {
    // Generate a deterministic pseudo-uniform sequence with non-trivial spread.
    let i = 0;
    const seq = (): number => {
      i = (i + 1) % 32;
      return i / 32; // 0/32, 1/32, ..., 31/32 — uniform-ish on [0, 1)
    };
    expect(hasNonTrivialVariance(seq)).toBe(true);
  });
});
