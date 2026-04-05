/**
 * Error Capture Module
 *
 * Provides utilities for capturing, sanitizing, and collecting errors
 * during fingerprint operations without crashing the main execution.
 *
 * Functions:
 * - `captureError`: Log and store sanitized error info
 * - `attempt`: Execute a function with automatic error capture
 * - `caniuse`: Safely check API availability via property chain
 * - `timer`: Create a performance timer for profiling
 * - `getCapturedErrors`: Retrieve all captured errors
 *
 * @module errors
 */

interface CapturedError {
  trustedName: string | undefined;
  trustedMessage: string | undefined;
}

/**
 * Creates an error capturing system that collects and sanitizes encountered errors.
 *
 * @returns Object with `getErrors()` and `captureError()` methods
 */
const createErrorsCaptured = () => {
  const errors: CapturedError[] = [];
  return {
    getErrors: () => errors,
    /** Captures and sanitizes an error, storing its trusted name and message. */
    captureError: (error: Error, customMessage = '') => {
      const type: Record<string, boolean> = {
        Error: true,
        EvalError: true,
        InternalError: true,
        RangeError: true,
        ReferenceError: true,
        SyntaxError: true,
        TypeError: true,
        URIError: true,
        InvalidStateError: true,
        SecurityError: true,
      };
      const hasInnerSpace = (s: string) => /.+(\s).+/g.test(s); // ignore AOPR noise
      console.error(error); // log error to educate
      const { name, message } = error;
      const trustedMessage = !hasInnerSpace(message)
        ? undefined
        : !customMessage
          ? message
          : `${message} [${customMessage}]`;
      const trustedName = type[name] ? name : undefined;
      errors.push({ trustedName, trustedMessage });
      return undefined;
    },
  };
};
const errorsCaptured = createErrorsCaptured();
const { captureError } = errorsCaptured;

/**
 * Attempts to execute a function, capturing any thrown error instead of propagating it.
 * @param fn - The function to execute.
 * @param customMessage - An optional custom message to attach to any captured error.
 * @returns The return value of fn, or undefined if an error was captured.
 */
const attempt = <T>(fn: () => T, customMessage = ''): T | undefined => {
  try {
    return fn();
  } catch (error) {
    if (customMessage) {
      return captureError(error as Error, customMessage);
    }
    return captureError(error as Error);
  }
};

/**
 * Safely checks whether an API is available by traversing an object property chain, optionally invoking it as a method.
 * @param fn - A function that returns the root API object to test.
 * @param objChainList - An array of property names to traverse on the API object.
 * @param args - Arguments to pass if invoking the resolved chain as a method.
 * @param method - Whether to invoke the resolved chain as a method via apply.
 * @returns The resolved value, the method call result, or undefined if any step fails.
 */
const caniuse = (
  fn: () => unknown,
  objChainList: string[] = [],
  args: unknown[] = [],
  method = false,
) => {
  let api;
  try {
    api = fn();
  } catch (error) {
    return undefined;
  }
  let i;
  const len = objChainList.length;
   
  let chain: any = api;
  try {
    for (i = 0; i < len; i++) {
      const obj = objChainList[i];
      chain = chain[obj];
    }
  } catch (error) {
    return undefined;
  }
  return method && args.length
    ? chain.apply(api, args)
    : method && !args.length
      ? chain.apply(api)
      : chain;
};

/**
 * Creates a performance timer that measures elapsed time between start and end.
 * @param logStart - An optional message to log when the timer starts.
 * @returns A function that, when called, returns the elapsed time in milliseconds and optionally logs it.
 */
const timer = (logStart?: string) => {
  logStart && console.log(logStart);
  let start = 0;
  try {
    start = performance.now();
  } catch (error) {
    captureError(error as Error);
  }
  /** Stops the timer and returns elapsed milliseconds. */
  return (logEnd?: string) => {
    let end = 0;
    try {
      end = performance.now() - start;
      logEnd && console.log(`${logEnd}: ${end / 1000} seconds`);
      return end;
    } catch (error) {
      captureError(error as Error);
      return 0;
    }
  };
};

/**
 * Retrieves all captured errors wrapped in a data property.
 * @returns An object containing the array of captured errors.
 */
const getCapturedErrors = () => ({ data: errorsCaptured.getErrors() });

export {
  captureError,
  attempt,
  caniuse,
  timer,
  errorsCaptured,
  getCapturedErrors,
};
