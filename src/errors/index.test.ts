import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  captureError,
  attempt,
  caniuse,
  timer,
  errorsCaptured,
  getCapturedErrors,
} from './index';

describe('errors module', () => {
  beforeEach(() => {
    // Suppress console.error during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('captureError()', () => {
    it('returns undefined', () => {
      const result = captureError(new Error('test error'));
      expect(result).toBeUndefined();
    });

    it('captures Error type', () => {
      const errorsBefore = errorsCaptured.getErrors().length;
      captureError(new Error('test message with spaces'));
      const errorsAfter = errorsCaptured.getErrors();
      expect(errorsAfter.length).toBeGreaterThan(errorsBefore);
    });

    it('captures TypeError', () => {
      const errorsBefore = errorsCaptured.getErrors().length;
      captureError(new TypeError('type error message here'));
      const errorsAfter = errorsCaptured.getErrors();
      expect(errorsAfter.length).toBeGreaterThan(errorsBefore);
    });

    it('captures ReferenceError', () => {
      captureError(new ReferenceError('reference error with spaces'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBe('ReferenceError');
    });

    it('captures SyntaxError', () => {
      captureError(new SyntaxError('syntax error message here'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBe('SyntaxError');
    });

    it('captures RangeError', () => {
      captureError(new RangeError('range error with spaces'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBe('RangeError');
    });

    it('includes custom message when provided', () => {
      captureError(new Error('original message here'), 'custom context');
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedMessage).toContain('custom context');
    });

    it('ignores messages without inner spaces (noise filter)', () => {
      captureError(new Error('NoSpaces'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedMessage).toBeUndefined();
    });

    it('captures messages with inner spaces', () => {
      captureError(new Error('Has inner spaces'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedMessage).toBe('Has inner spaces');
    });

    it('sets trustedName to undefined for unknown error types', () => {
      // Create a custom error with non-standard name
      const customError = new Error('message with spaces');
      customError.name = 'CustomError';
      captureError(customError);
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBeUndefined();
    });

    it('captures URIError', () => {
      captureError(new URIError('uri error with spaces'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBe('URIError');
    });

    it('captures EvalError', () => {
      captureError(new EvalError('eval error with spaces'));
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBe('EvalError');
    });
  });

  describe('attempt()', () => {
    it('returns function result on success', () => {
      const result = attempt(() => 42);
      expect(result).toBe(42);
    });

    it('returns undefined on error', () => {
      const result = attempt(() => {
        throw new Error('test error with spaces');
      });
      expect(result).toBeUndefined();
    });

    it('captures error with custom message', () => {
      const errorsBefore = errorsCaptured.getErrors().length;
      attempt(() => {
        throw new Error('error with spaces');
      }, 'custom context');
      const errorsAfter = errorsCaptured.getErrors();
      expect(errorsAfter.length).toBeGreaterThan(errorsBefore);
    });

    it('handles async-like functions', () => {
      const result = attempt(() => Promise.resolve('async result'));
      expect(result).toBeInstanceOf(Promise);
    });

    it('handles null return', () => {
      const result = attempt(() => null);
      expect(result).toBeNull();
    });

    it('handles undefined return', () => {
      const result = attempt(() => undefined);
      expect(result).toBeUndefined();
    });

    it('handles complex return values', () => {
      const result = attempt(() => ({ a: 1, b: [2, 3] }));
      expect(result).toEqual({ a: 1, b: [2, 3] });
    });
  });

  describe('caniuse()', () => {
    it('returns value when function succeeds', () => {
      const result = caniuse(() => 'test value');
      expect(result).toBe('test value');
    });

    it('returns undefined when function throws', () => {
      const result = caniuse(() => {
        throw new Error('not available');
      });
      expect(result).toBeUndefined();
    });

    it('navigates object chain', () => {
      const obj = { level1: { level2: { value: 'deep' } } };
      const result = caniuse(() => obj, ['level1', 'level2', 'value']);
      expect(result).toBe('deep');
    });

    it('returns undefined if chain fails', () => {
      const obj = { level1: {} };
      const result = caniuse(() => obj, ['level1', 'level2', 'value']);
      expect(result).toBeUndefined();
    });

    it('calls method when method=true', () => {
      const obj = {
        greet: function () {
          return 'hello';
        },
      };
      const result = caniuse(() => obj, ['greet'], [], true);
      expect(result).toBe('hello');
    });

    it('calls method with args when provided', () => {
      const obj = {
        add: function (a: number, b: number) {
          return a + b;
        },
      };
      const result = caniuse(() => obj, ['add'], [2, 3], true);
      expect(result).toBe(5);
    });

    it('handles empty object chain', () => {
      const result = caniuse(() => 'direct value', []);
      expect(result).toBe('direct value');
    });

    it('handles array access in chain', () => {
      const obj = { items: ['a', 'b', 'c'] };
      const result = caniuse(() => obj, ['items', '1']);
      expect(result).toBe('b');
    });

    it('returns undefined when initial function returns undefined', () => {
      const result = caniuse(() => undefined, ['prop']);
      expect(result).toBeUndefined();
    });
  });

  describe('timer()', () => {
    it('returns a function', () => {
      const endTimer = timer();
      expect(typeof endTimer).toBe('function');
    });

    it('end function returns elapsed time', () => {
      const endTimer = timer();
      const elapsed = endTimer();
      expect(typeof elapsed).toBe('number');
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    it('logs start message when provided', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      timer('Starting timer');
      expect(consoleSpy).toHaveBeenCalledWith('Starting timer');
      consoleSpy.mockRestore();
    });

    it('logs end message when provided', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const endTimer = timer();
      endTimer('Ending timer');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('measures elapsed time', async () => {
      const endTimer = timer();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const elapsed = endTimer();
      expect(elapsed).toBeGreaterThan(0);
    });
  });

  describe('getCapturedErrors()', () => {
    it('returns object with data property', () => {
      const result = getCapturedErrors();
      expect(result).toHaveProperty('data');
    });

    it('data is an array', () => {
      const result = getCapturedErrors();
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('contains captured errors', () => {
      const initialCount = getCapturedErrors().data.length;
      captureError(new Error('new error with spaces'));
      const finalCount = getCapturedErrors().data.length;
      expect(finalCount).toBeGreaterThan(initialCount);
    });
  });

  describe('errorsCaptured', () => {
    it('has getErrors method', () => {
      expect(typeof errorsCaptured.getErrors).toBe('function');
    });

    it('getErrors returns array', () => {
      const errors = errorsCaptured.getErrors();
      expect(Array.isArray(errors)).toBe(true);
    });

    it('has captureError method', () => {
      expect(typeof errorsCaptured.captureError).toBe('function');
    });
  });
});

// Test error type patterns
describe('error type patterns', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('recognizes all standard error types', () => {
    const errorTypes = [
      Error,
      EvalError,
      RangeError,
      ReferenceError,
      SyntaxError,
      TypeError,
      URIError,
    ];

    for (const ErrorType of errorTypes) {
      const error = new ErrorType('message with spaces');
      captureError(error);
      const errors = errorsCaptured.getErrors();
      const lastError = errors[errors.length - 1];
      expect(lastError.trustedName).toBe(ErrorType.name);
    }
  });

  it('filters AOPR noise (messages without inner spaces)', () => {
    // AOPR = Automated Obfuscation Pattern Recognition
    // Single word error messages are likely noise
    captureError(new Error('SingleWord'));
    const errors = errorsCaptured.getErrors();
    const lastError = errors[errors.length - 1];
    expect(lastError.trustedMessage).toBeUndefined();
  });

  it('preserves meaningful multi-word messages', () => {
    captureError(new Error('This is a meaningful error'));
    const errors = errorsCaptured.getErrors();
    const lastError = errors[errors.length - 1];
    expect(lastError.trustedMessage).toBe('This is a meaningful error');
  });
});
