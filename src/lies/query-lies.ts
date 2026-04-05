/**
 * Query Lies - Core Lie Detection
 *
 * Comprehensive lie detection for a single API function. This is the heart
 * of lie detection - it runs 26 tests on a function to detect if it's been
 * modified, wrapped in a Proxy, or otherwise tampered.
 *
 * ## Test Categories:
 * 1. **Error Tests**: Functions should throw specific TypeErrors
 * 2. **toString Tests**: Should return "[native code]" format
 * 3. **Descriptor Tests**: Should have expected property descriptors
 * 4. **Prototype Tests**: Should follow expected prototype chain
 * 5. **Proxy Detection**: Advanced tests to detect Proxy wrappers
 *
 * @module lies/query-lies
 */

import { IS_BLINK, IS_WEBKIT, IS_GECKO } from '../utils/helpers';
import { STACK_TRACE_PATTERNS, getKnownToStringFormats } from './constants';
import {
  isTypeError,
  failsTypeError,
  failsWithError,
  hasValidStack,
  getRandomValues,
} from './error-traps';
import type { LieQueryConfig, LieQueryResult } from './types';

/** Random value for this session (used in prototype chain tests) */
const RAND = getRandomValues();

/** Whether Reflect API is available */
const HAS_REFLECT = 'Reflect' in self;

/**
 * Context for query lies injection (for testing).
 */
export interface QueryLiesContext {
  isBlink: boolean;
  isWebKit: boolean;
  isGecko: boolean;
}

/**
 * Default context using actual browser detection.
 */
export const defaultQueryLiesContext: QueryLiesContext = {
  isBlink: IS_BLINK,
  isWebKit: IS_WEBKIT,
  isGecko: IS_GECKO,
};

/**
 * Comprehensive lie detection for a single API function.
 *
 * @param config - Configuration with scope, function, and proto
 * @param context - Optional context for engine flags (for testing)
 * @returns Object with lied count and list of lie types
 */
export function queryLies(
  { scope, apiFunction, proto, obj, lieProps }: LieQueryConfig,
  context: QueryLiesContext = defaultQueryLiesContext,
): LieQueryResult {
  if (typeof apiFunction !== 'function') {
    return { lied: 0, lieTypes: [] };
  }

  const { isBlink, isWebKit, isGecko } = context;
  const name = apiFunction.name.replace(/get\s/, '');
  const objName = (obj as { name?: string })?.name;
  const nativeProto = Object.getPrototypeOf(apiFunction);

  // Build initial lie detection tests
  let lies: Record<string, boolean> = {
    // Test 1: Accessing prototype[name] should throw TypeError for certain objects
    ['failed illegal error']:
      !!obj &&
      failsTypeError({
        spawnErr: () =>
          (obj as { prototype: Record<string, unknown> }).prototype[name],
      }),

    // Test 2: Screen/Navigator properties shouldn't have own property descriptors
    ['failed undefined properties']:
      !!obj &&
      /^(screen|navigator)$/i.test(objName || '') &&
      !!(
        Object.getOwnPropertyDescriptor(
          self[(objName?.toLowerCase() || '') as 'screen' | 'navigator'],
          name,
        ) ||
        (HAS_REFLECT &&
          Reflect.getOwnPropertyDescriptor(
            self[(objName?.toLowerCase() || '') as 'screen' | 'navigator'],
            name,
          ))
      ),

    // Test 3: Calling with wrong context should throw TypeError
    ['failed call interface error']: failsTypeError({
      spawnErr: () => {
        // @ts-expect-error - Testing invalid usage
        new apiFunction();
        apiFunction.call(proto);
      },
    }),

    // Test 4: Apply with wrong context should throw TypeError
    ['failed apply interface error']: failsTypeError({
      spawnErr: () => {
        // @ts-expect-error - Testing invalid usage
        new apiFunction();
        apiFunction.apply(proto);
      },
    }),

    // Test 5: Constructor call should throw TypeError
    ['failed new instance error']: failsTypeError({
      // @ts-expect-error - Testing invalid usage
      spawnErr: () => new apiFunction(),
    }),

    // Test 6: Class extension should throw TypeError (Blink only)
    // Chrome throws when extending non-constructable native methods; Firefox and Safari do not.
    // NOTE: Must use `new (class extends fn)()` (not a class declaration) to prevent Terser from
    // removing the class as an "unused declaration". A class expression inside `new` is always
    // preserved by minifiers since constructor calls are always considered side-effectful.
    ['failed class extends error']:
      !isWebKit &&
      !isGecko &&
      failsTypeError({
        // @ts-expect-error - Testing invalid usage
        spawnErr: () => void new (class extends apiFunction {})(),
      }),

    // Test 7: Setting null prototype and calling toString should throw
    ['failed null conversion error']: failsTypeError({
      spawnErr: () => Object.setPrototypeOf(apiFunction, null).toString(),
      final: () => Object.setPrototypeOf(apiFunction, nativeProto),
    }),

    // Test 8: toString() should return known native code format
    ['failed toString']:
      !getKnownToStringFormats(name)[
        scope.Function.prototype.toString.call(apiFunction)
      ] ||
      !getKnownToStringFormats('toString')[
        scope.Function.prototype.toString.call(apiFunction.toString)
      ],

    // Test 9: Native functions shouldn't have a prototype property
    ['failed "prototype" in function']: 'prototype' in apiFunction,

    // Test 10: Native functions shouldn't have arguments/caller/prototype descriptors
    ['failed descriptor']: !!(
      Object.getOwnPropertyDescriptor(apiFunction, 'arguments') ||
      Reflect.getOwnPropertyDescriptor(apiFunction, 'arguments') ||
      Object.getOwnPropertyDescriptor(apiFunction, 'caller') ||
      Reflect.getOwnPropertyDescriptor(apiFunction, 'caller') ||
      Object.getOwnPropertyDescriptor(apiFunction, 'prototype') ||
      Reflect.getOwnPropertyDescriptor(apiFunction, 'prototype') ||
      Object.getOwnPropertyDescriptor(apiFunction, 'toString') ||
      Reflect.getOwnPropertyDescriptor(apiFunction, 'toString')
    ),

    // Test 11: Native functions shouldn't have own properties beyond length/name
    ['failed own property']: !!(
      apiFunction.hasOwnProperty('arguments') ||
      apiFunction.hasOwnProperty('caller') ||
      apiFunction.hasOwnProperty('prototype') ||
      apiFunction.hasOwnProperty('toString')
    ),

    // Test 12: Descriptor keys should only be length,name
    ['failed descriptor keys']:
      Object.keys(Object.getOwnPropertyDescriptors(apiFunction))
        .sort()
        .toString() !== 'length,name',

    // Test 13: Own property names should only be length,name
    ['failed own property names']:
      Object.getOwnPropertyNames(apiFunction).sort().toString() !==
      'length,name',

    // Test 14: Reflect.ownKeys should only return length,name
    ['failed own keys names']:
      HAS_REFLECT &&
      Reflect.ownKeys(apiFunction).sort().toString() !== 'length,name',

    // Test 15-16: Proxy detection via Object.create and toString
    ['failed object toString error']:
      failsTypeError({
        spawnErr: () => Object.create(apiFunction).toString(),
        withStack: (err) =>
          isBlink && !hasValidStack(err, STACK_TRACE_PATTERNS.AT_FUNCTION),
      }) ||
      failsTypeError({
        spawnErr: () => Object.create(new Proxy(apiFunction, {})).toString(),
        withStack: (err) =>
          isBlink && !hasValidStack(err, STACK_TRACE_PATTERNS.AT_OBJECT),
      }),

    // Test 17: Arguments/caller access should fail in strict mode (Gecko)
    ['failed at incompatible proxy error']: failsTypeError({
      spawnErr: () => {
        apiFunction.arguments;
        apiFunction.caller;
      },
      withStack: (err) =>
        isGecko && !hasValidStack(err, STACK_TRACE_PATTERNS.STRICT_MODE, 0),
    }),

    // Test 18: toString's arguments/caller should also fail
    ['failed at toString incompatible proxy error']: failsTypeError({
      spawnErr: () => {
        apiFunction.toString.arguments;
        apiFunction.toString.caller;
      },
      withStack: (err) =>
        isGecko && !hasValidStack(err, STACK_TRACE_PATTERNS.STRICT_MODE, 0),
    }),

    // Test 19: Circular prototype should cause recursion error
    ['failed at too much recursion error']: failsTypeError({
      spawnErr: () => {
        Object.setPrototypeOf(
          apiFunction,
          Object.create(apiFunction),
        ).toString();
      },
      final: () => Object.setPrototypeOf(apiFunction, nativeProto),
    }),
  };

  // Advanced Proxy Detection
  // Only run these expensive tests if we've already detected issues
  // or if this is a critical function like toString
  const detectProxies =
    name === 'toString' ||
    !!lieProps['Function.toString'] ||
    !!lieProps['Permissions.query'];

  if (detectProxies) {
    const proxy1 = new Proxy(apiFunction, {});
    const proxy2 = new Proxy(apiFunction, {});
    const proxy3 = new Proxy(apiFunction, {});

    lies = {
      ...lies,
      // Test 20: __proto__ modification should work differently for proxies
      ['failed at too much recursion __proto__ error']: !failsTypeError({
        spawnErr: () => {
          // @ts-expect-error - Testing invalid usage
          apiFunction.__proto__ = proxy1;
          // @ts-expect-error - Testing invalid usage
          apiFunction++;
        },
        final: () => Object.setPrototypeOf(apiFunction, nativeProto),
      }),

      // Test 21: Proxy chain cycle detection
      ['failed at chain cycle error']: !failsTypeError({
        spawnErr: () => {
          Object.setPrototypeOf(proxy1, Object.create(proxy1)).toString();
        },
        final: () => Object.setPrototypeOf(proxy1, nativeProto),
      }),

      // Test 22: Proxy __proto__ cycle detection
      ['failed at chain cycle __proto__ error']: !failsTypeError({
        spawnErr: () => {
          // @ts-expect-error - Testing invalid usage
          proxy2.__proto__ = proxy2;
          // @ts-expect-error - Testing invalid usage
          proxy2++;
        },
        final: () => Object.setPrototypeOf(proxy2, nativeProto),
      }),

      // Test 23: Reflect.setPrototypeOf behavior
      ['failed at reflect set proto']:
        HAS_REFLECT &&
        failsTypeError({
          spawnErr: () => {
            Reflect.setPrototypeOf(apiFunction, Object.create(apiFunction));
            RAND in apiFunction;
            throw new TypeError();
          },
          final: () => Object.setPrototypeOf(apiFunction, nativeProto),
        }),

      // Test 24: Proxy should behave differently with Reflect.setPrototypeOf
      ['failed at reflect set proto proxy']:
        HAS_REFLECT &&
        !failsTypeError({
          spawnErr: () => {
            Reflect.setPrototypeOf(proxy3, Object.create(proxy3));
            RAND in proxy3;
          },
          final: () => Object.setPrototypeOf(proxy3, nativeProto),
        }),

      // Test 25: instanceof checks have different stack traces for proxies (Blink)
      ['failed at instanceof check error']:
        isBlink &&
        (failsTypeError({
          spawnErr: () => {
            apiFunction instanceof apiFunction;
          },
          withStack: (err) =>
            !hasValidStack(err, STACK_TRACE_PATTERNS.FUNCTION_INSTANCE),
        }) ||
          failsTypeError({
            spawnErr: () => {
              const proxy = new Proxy(apiFunction, {});
              proxy instanceof proxy;
            },
            withStack: (err) =>
              !hasValidStack(err, STACK_TRACE_PATTERNS.PROXY_INSTANCE),
          })),

      // Test 26: defineProperty behavior (Blink)
      ['failed at define properties']:
        isBlink &&
        HAS_REFLECT &&
        failsWithError(() => {
          Object.defineProperty(apiFunction, '', {
            configurable: true,
          }).toString();
          Reflect.deleteProperty(apiFunction, '');
        }),
    };
  }

  // Collect all failed tests
  const lieTypes = Object.keys(lies).filter((key) => !!lies[key]);
  return { lied: lieTypes.length, lieTypes };
}
