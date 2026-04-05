/**
 * Lie Detector Factory
 *
 * Creates a lie detector instance for searching APIs for tampering.
 * The detector maintains state about which APIs have been tested and
 * what lies were found.
 *
 * @module lies/detector
 */

import { documentLie } from './records';
import {
  queryLies,
  type QueryLiesContext,
  defaultQueryLiesContext,
} from './query-lies';
import type { LieDetector, LieQueryResult, SearchConfig } from './types';

/**
 * Dependencies for lie detector (for testing/DI).
 */
export interface LieDetectorDeps {
  /** Function to document detected lies */
  documentLie: (name: string, lie: string | string[]) => string[];
  /** Function to query lies on an API function */
  queryLies: typeof queryLies;
  /** Context for browser engine detection */
  queryLiesContext?: QueryLiesContext;
}

/**
 * Default dependencies using actual implementations.
 */
export const defaultLieDetectorDeps: LieDetectorDeps = {
  documentLie,
  queryLies,
  queryLiesContext: defaultQueryLiesContext,
};

/**
 * Creates a lie detector instance for searching APIs.
 *
 * The detector maintains state about which APIs have been tested and
 * what lies were found. It provides a searchLies method to test
 * specific APIs.
 *
 * @param scope - Window scope to test in
 * @param deps - Optional dependencies for testing
 * @returns Lie detector instance
 */
export function createLieDetector(
  scope: Window & typeof globalThis,
  deps: LieDetectorDeps = defaultLieDetectorDeps,
): LieDetector {
  const { documentLie: docLie, queryLies: query, queryLiesContext } = deps;

  /** Checks if an API object is defined and truthy. */
  const isSupported = (obj: unknown) => typeof obj !== 'undefined' && !!obj;
  const props: Record<string, string[]> = {}; // lie list and detail
  const propsSearched: string[] = []; // list of properties searched

  return {
    /**
     * Returns the record of detected lies, keyed by API name.
     *
     * @returns Map of API names to their detected lie type strings
     */
    getProps: () => props,
    /**
     * Returns the list of API property names that have been searched.
     *
     * @returns Array of API name strings that were tested
     */
    getPropsSearched: () => propsSearched,
    /**
     * Searches an API object for lies by testing each of its properties.
     *
     * Iterates over the properties of the object returned by `fn`, running
     * lie detection queries on each function or getter. Detected lies are
     * documented and stored in the internal props record.
     *
     * @param fn - Factory function that returns the API object to test
     * @param config - Optional configuration to target or ignore specific properties
     */
    searchLies: (fn: () => unknown, config?: SearchConfig): void => {
      const { target, ignore } = config || {};
      let obj: { prototype?: unknown; name?: string };

      // Check if API is blocked or not supported
      try {
        obj = fn() as typeof obj;
        if (!isSupported(obj)) {
          return;
        }
      } catch (error) {
        return;
      }

      const interfaceObject = obj.prototype ? obj.prototype : obj;

      // Get all property names to test
      [
        ...new Set([
          ...Object.getOwnPropertyNames(interfaceObject),
          ...Object.keys(interfaceObject),
        ]),
      ]
        .sort()
        .forEach((name) => {
          // Skip constructor and filtered properties
          const skip =
            name === 'constructor' ||
            (target && !new Set(target).has(name)) ||
            (ignore && new Set(ignore).has(name));
          if (skip) return;

          // Build API name string
          const objectNameString = /\s(.+)\]/;
          const apiName = `${
            obj.name
              ? obj.name
              : objectNameString.test(String(obj))
                ? objectNameString.exec(String(obj))?.[1]
                : undefined
          }.${name}`;

          propsSearched.push(apiName);

          try {
            const proto = obj.prototype ? obj.prototype : obj;
            let res: LieQueryResult;

            // Try to test as a function first
            try {
              const apiFunction = (proto as Record<string, unknown>)[name];
              if (typeof apiFunction === 'function') {
                res = query(
                  {
                    scope,
                    apiFunction: apiFunction as Function,
                    proto,
                    obj: null,
                    lieProps: props,
                  },
                  queryLiesContext,
                );
                if (res.lied) {
                  docLie(apiName, res.lieTypes);
                  props[apiName] = res.lieTypes;
                  return;
                }
                return;
              }
              // Handle invalid values (not function, not constant)
              if (
                name !== 'name' &&
                name !== 'length' &&
                name[0] !== name[0].toUpperCase()
              ) {
                const lie = ['failed descriptor.value undefined'];
                docLie(apiName, lie);
                props[apiName] = lie;
                return;
              }
            } catch (error) {
              // Function access failed, try getter
            }

            // Test as getter function
            const descriptor = Object.getOwnPropertyDescriptor(
              proto as object,
              name,
            );
            if (!descriptor?.get) return;

            res = query(
              {
                scope,
                apiFunction: descriptor.get,
                proto,
                obj, // Send obj for special tests
                lieProps: props,
              },
              queryLiesContext,
            );

            if (res.lied) {
              docLie(apiName, res.lieTypes);
              props[apiName] = res.lieTypes;
            }
          } catch (error) {
            const lie = 'failed prototype test execution';
            docLie(apiName, lie);
            props[apiName] = [lie];
          }
        });
    },
  };
}
