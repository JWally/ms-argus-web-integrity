import { describe, it, expect } from 'vitest';
import {
  GHOST_STYLES,
  STACK_TRACE_PATTERNS,
  getKnownToStringFormats,
  API_SEARCH_TARGETS,
  VALID_ERROR_TYPES,
} from './constants';

describe('lies constants', () => {
  describe('GHOST_STYLES', () => {
    it('is a non-empty string', () => {
      expect(typeof GHOST_STYLES).toBe('string');
      expect(GHOST_STYLES.length).toBeGreaterThan(0);
    });

    it('positions element off-screen', () => {
      expect(GHOST_STYLES).toContain('left:-10000px');
    });

    it('hides element visibility', () => {
      expect(GHOST_STYLES).toContain('visibility: hidden');
    });

    it('covers full viewport', () => {
      expect(GHOST_STYLES).toContain('height: 100vh');
      expect(GHOST_STYLES).toContain('width: 100vw');
    });

    it('uses absolute positioning', () => {
      expect(GHOST_STYLES).toContain('position: absolute');
    });
  });

  describe('STACK_TRACE_PATTERNS', () => {
    it('has AT_FUNCTION regex', () => {
      expect(STACK_TRACE_PATTERNS.AT_FUNCTION).toBeInstanceOf(RegExp);
      expect(
        STACK_TRACE_PATTERNS.AT_FUNCTION.test('at Function.toString (native)'),
      ).toBe(true);
      expect(STACK_TRACE_PATTERNS.AT_FUNCTION.test('at Object.toString')).toBe(
        false,
      );
    });

    it('has AT_OBJECT regex', () => {
      expect(STACK_TRACE_PATTERNS.AT_OBJECT).toBeInstanceOf(RegExp);
      expect(
        STACK_TRACE_PATTERNS.AT_OBJECT.test('at Object.toString (native)'),
      ).toBe(true);
      expect(STACK_TRACE_PATTERNS.AT_OBJECT.test('at Function.toString')).toBe(
        false,
      );
    });

    it('has FUNCTION_INSTANCE regex', () => {
      expect(STACK_TRACE_PATTERNS.FUNCTION_INSTANCE).toBeInstanceOf(RegExp);
      expect(
        STACK_TRACE_PATTERNS.FUNCTION_INSTANCE.test(
          'at Function.[Symbol.hasInstance]',
        ),
      ).toBe(true);
      expect(
        STACK_TRACE_PATTERNS.FUNCTION_INSTANCE.test('at [Symbol.hasInstance]'),
      ).toBe(true);
    });

    it('has PROXY_INSTANCE regex', () => {
      expect(STACK_TRACE_PATTERNS.PROXY_INSTANCE).toBeInstanceOf(RegExp);
      expect(
        STACK_TRACE_PATTERNS.PROXY_INSTANCE.test(
          'at Proxy.[Symbol.hasInstance]',
        ),
      ).toBe(true);
      expect(
        STACK_TRACE_PATTERNS.PROXY_INSTANCE.test('at [Symbol.hasInstance]'),
      ).toBe(true);
    });

    it('has STRICT_MODE regex', () => {
      expect(STACK_TRACE_PATTERNS.STRICT_MODE).toBeInstanceOf(RegExp);
      expect(
        STACK_TRACE_PATTERNS.STRICT_MODE.test(
          "'caller' and 'arguments' are restricted in strict mode",
        ),
      ).toBe(true);
    });
  });

  describe('getKnownToStringFormats()', () => {
    it('returns object with standard format', () => {
      const formats = getKnownToStringFormats('toString');
      expect(formats['function toString() { [native code] }']).toBe(true);
    });

    it('returns object with getter format', () => {
      const formats = getKnownToStringFormats('deviceMemory');
      expect(formats['function get deviceMemory() { [native code] }']).toBe(
        true,
      );
    });

    it('returns object with Safari/WebKit format (newlines)', () => {
      const formats = getKnownToStringFormats('valueOf');
      expect(formats['function valueOf() {\n    [native code]\n}']).toBe(true);
    });

    it('returns object with anonymous function format', () => {
      const formats = getKnownToStringFormats('anyName');
      expect(formats['function () { [native code] }']).toBe(true);
    });

    it('returns 6 formats for any name', () => {
      const formats = getKnownToStringFormats('test');
      expect(Object.keys(formats).length).toBe(6);
    });

    it('handles various function names', () => {
      const names = ['getImageData', 'appendChild', 'platform', 'userAgent'];
      for (const name of names) {
        const formats = getKnownToStringFormats(name);
        expect(Object.keys(formats).length).toBe(6);
        expect(formats[`function ${name}() { [native code] }`]).toBe(true);
      }
    });
  });

  describe('API_SEARCH_TARGETS', () => {
    it('is an array', () => {
      expect(Array.isArray(API_SEARCH_TARGETS)).toBe(true);
    });

    it('has multiple API targets', () => {
      expect(API_SEARCH_TARGETS.length).toBeGreaterThan(30);
    });

    it('each target has api property', () => {
      for (const target of API_SEARCH_TARGETS) {
        expect(typeof target.api).toBe('string');
        expect(target.api.length).toBeGreaterThan(0);
      }
    });

    it('target is array or undefined', () => {
      for (const target of API_SEARCH_TARGETS) {
        expect(
          target.target === undefined || Array.isArray(target.target),
        ).toBe(true);
      }
    });

    it('ignore is array or undefined', () => {
      for (const target of API_SEARCH_TARGETS) {
        expect(
          target.ignore === undefined || Array.isArray(target.ignore),
        ).toBe(true);
      }
    });

    it('includes Function API first', () => {
      expect(API_SEARCH_TARGETS[0].api).toBe('Function');
      expect(API_SEARCH_TARGETS[0].target).toContain('toString');
    });

    it('includes critical fingerprinting APIs', () => {
      const criticalAPIs = [
        'CanvasRenderingContext2D',
        'Math',
        'Navigator',
        'Screen',
        'WebGLRenderingContext',
      ];

      const apiNames = API_SEARCH_TARGETS.map((t) => t.api);
      for (const api of criticalAPIs) {
        expect(apiNames).toContain(api);
      }
    });

    it('includes audio fingerprinting APIs', () => {
      const audioAPIs = ['AnalyserNode', 'AudioBuffer', 'BiquadFilterNode'];
      const apiNames = API_SEARCH_TARGETS.map((t) => t.api);
      for (const api of audioAPIs) {
        expect(apiNames).toContain(api);
      }
    });

    it('Navigator target includes critical properties', () => {
      const navigatorTarget = API_SEARCH_TARGETS.find(
        (t) => t.api === 'Navigator',
      );
      expect(navigatorTarget).toBeDefined();
      expect(navigatorTarget!.target).toContain('userAgent');
      expect(navigatorTarget!.target).toContain('platform');
      expect(navigatorTarget!.target).toContain('webdriver');
      expect(navigatorTarget!.target).toContain('deviceMemory');
      expect(navigatorTarget!.target).toContain('hardwareConcurrency');
    });

    it('Canvas target includes critical methods', () => {
      const canvasTarget = API_SEARCH_TARGETS.find(
        (t) => t.api === 'CanvasRenderingContext2D',
      );
      expect(canvasTarget).toBeDefined();
      expect(canvasTarget!.target).toContain('getImageData');
      expect(canvasTarget!.target).toContain('fillText');
      expect(canvasTarget!.target).toContain('measureText');
    });

    it('Math target includes all trig functions', () => {
      const mathTarget = API_SEARCH_TARGETS.find((t) => t.api === 'Math');
      expect(mathTarget).toBeDefined();
      // Note: asin is not included, only asinh (hyperbolic variant)
      const trigFunctions = [
        'sin',
        'cos',
        'tan',
        'acos',
        'atan',
        'sinh',
        'cosh',
        'tanh',
        'asinh',
      ];
      for (const fn of trigFunctions) {
        expect(mathTarget!.target).toContain(fn);
      }
    });

    it('Date target includes timezone methods', () => {
      const dateTarget = API_SEARCH_TARGETS.find((t) => t.api === 'Date');
      expect(dateTarget).toBeDefined();
      expect(dateTarget!.target).toContain('getTimezoneOffset');
      expect(dateTarget!.target).toContain('toLocaleString');
      expect(dateTarget!.target).toContain('toLocaleDateString');
    });

    it('includes WebGL 2 API', () => {
      const apiNames = API_SEARCH_TARGETS.map((t) => t.api);
      expect(apiNames).toContain('WebGL2RenderingContext');
    });

    it('includes iframe APIs', () => {
      const iframeTarget = API_SEARCH_TARGETS.find(
        (t) => t.api === 'HTMLIFrameElement',
      );
      expect(iframeTarget).toBeDefined();
      expect(iframeTarget!.target).toContain('contentDocument');
      expect(iframeTarget!.target).toContain('contentWindow');
    });
  });

  describe('VALID_ERROR_TYPES', () => {
    it('is an object', () => {
      expect(typeof VALID_ERROR_TYPES).toBe('object');
    });

    it('includes all standard error types', () => {
      const standardErrors = [
        'Error',
        'EvalError',
        'RangeError',
        'ReferenceError',
        'SyntaxError',
        'TypeError',
        'URIError',
      ];
      for (const errorType of standardErrors) {
        expect((VALID_ERROR_TYPES as Record<string, boolean>)[errorType]).toBe(
          true,
        );
      }
    });

    it('includes InternalError (Firefox)', () => {
      expect(VALID_ERROR_TYPES.InternalError).toBe(true);
    });

    it('includes DOM error types', () => {
      expect(VALID_ERROR_TYPES.InvalidStateError).toBe(true);
      expect(VALID_ERROR_TYPES.SecurityError).toBe(true);
    });

    it('has 10 valid error types', () => {
      expect(Object.keys(VALID_ERROR_TYPES).length).toBe(10);
    });

    it('all values are true', () => {
      for (const value of Object.values(VALID_ERROR_TYPES)) {
        expect(value).toBe(true);
      }
    });
  });
});

// Test pattern matching behavior
describe('lies detection patterns', () => {
  describe('native function detection', () => {
    it('can validate native toString format', () => {
      const formats = getKnownToStringFormats('toString');
      const nativeToString = 'function toString() { [native code] }';
      expect(formats[nativeToString]).toBe(true);
    });

    it('rejects non-native toString format', () => {
      const formats = getKnownToStringFormats('toString');
      const spoofedToString = 'function toString() { return "spoofed"; }';
      expect(formats[spoofedToString]).toBeUndefined();
    });

    it('handles getter properties', () => {
      const formats = getKnownToStringFormats('deviceMemory');
      const getterFormat = 'function get deviceMemory() { [native code] }';
      expect(formats[getterFormat]).toBe(true);
    });
  });

  describe('stack trace detection', () => {
    it('detects Function.toString in stack', () => {
      const stack = `Error
    at Function.toString (<anonymous>)
    at detectLies (lies.js:123)`;
      expect(STACK_TRACE_PATTERNS.AT_FUNCTION.test(stack)).toBe(true);
    });

    it('detects Proxy.hasInstance in stack', () => {
      const stack = `Error
    at Proxy.[Symbol.hasInstance] (<anonymous>)
    at instanceCheck (lies.js:456)`;
      expect(STACK_TRACE_PATTERNS.PROXY_INSTANCE.test(stack)).toBe(true);
    });

    it('detects strict mode error message', () => {
      const message =
        "'caller' and 'arguments' are restricted function properties in strict mode code";
      expect(STACK_TRACE_PATTERNS.STRICT_MODE.test(message)).toBe(true);
    });
  });

  describe('API target validation', () => {
    it('can find target by API name', () => {
      const findTarget = (apiName: string) =>
        API_SEARCH_TARGETS.find((t) => t.api === apiName);

      expect(findTarget('Navigator')).toBeDefined();
      expect(findTarget('Math')).toBeDefined();
      expect(findTarget('NonExistent')).toBeUndefined();
    });

    it('can check if property is targeted', () => {
      const isTargeted = (apiName: string, prop: string) => {
        const target = API_SEARCH_TARGETS.find((t) => t.api === apiName);
        if (!target) return false;
        if (target.target === undefined) return true;
        return target.target.includes(prop);
      };

      expect(isTargeted('Navigator', 'userAgent')).toBe(true);
      expect(isTargeted('Navigator', 'nonExistent')).toBe(false);
      expect(isTargeted('Screen', 'width')).toBe(true); // undefined target = all props
    });

    it('can check if property is ignored', () => {
      const isIgnored = (apiName: string, prop: string) => {
        const target = API_SEARCH_TARGETS.find((t) => t.api === apiName);
        if (!target || !target.ignore) return false;
        return target.ignore.includes(prop);
      };

      expect(isIgnored('Function', 'caller')).toBe(true);
      expect(isIgnored('Function', 'arguments')).toBe(true);
      expect(isIgnored('Function', 'toString')).toBe(false);
      expect(isIgnored('HTMLElement', 'onmouseenter')).toBe(true);
    });
  });

  describe('error type validation', () => {
    it('validates standard JavaScript errors', () => {
      const standardErrors = [
        Error,
        TypeError,
        RangeError,
        ReferenceError,
        SyntaxError,
      ];
      for (const ErrorType of standardErrors) {
        const error = new ErrorType('test');
        expect((VALID_ERROR_TYPES as Record<string, boolean>)[error.name]).toBe(
          true,
        );
      }
    });

    it('validates by name string', () => {
      const isValidError = (name: string) =>
        (VALID_ERROR_TYPES as Record<string, boolean>)[name] === true;

      expect(isValidError('TypeError')).toBe(true);
      expect(isValidError('CustomError')).toBe(false);
      expect(isValidError('InvalidStateError')).toBe(true);
    });
  });
});
