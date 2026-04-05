/**
 * Timing Utilities Module
 *
 * Performance measurement and timing helpers for fingerprint collection.
 * Provides consistent timing APIs across all fingerprint modules.
 *
 * @module utils/timing
 */

/**
 * Timer interface for measuring execution time.
 */
export interface Timer {
  /** Start/resume timing */
  start: () => number;
  /** Stop timing and return total elapsed time in ms */
  stop: () => number;
}

/**
 * Create a timer for measuring execution duration.
 * Supports pause/resume via multiple start/stop cycles.
 *
 * @returns Timer object with start() and stop() methods
 *
 * @example
 * const timer = createTimer();
 * timer.start();
 * // ... do work ...
 * const elapsed = timer.stop(); // returns ms
 */
export function createTimer(): Timer {
  let start = 0;
  const log: number[] = [];
  return {
    stop: () => {
      if (start) {
        log.push(performance.now() - start);
        return log.reduce((acc, n) => (acc += n), 0);
      }
      return start;
    },
    start: () => {
      start = performance.now();
      return start;
    },
  };
}

/**
 * Queue an event with optional delay, pausing timer during wait.
 * Useful for async fingerprint operations that need timing gaps.
 *
 * @param timer - Timer to pause during delay
 * @param delay - Delay in milliseconds (default: 0)
 * @returns Promise that resolves after delay
 */
export function queueEvent(timer: Timer, delay = 0): Promise<number | void> {
  timer.stop();
  return new Promise<number>((resolve) =>
    setTimeout(() => resolve(timer.start()), delay),
  ).catch((): void => {});
}

/**
 * Test result for logging.
 */
export interface TestResult {
  test: string;
  passed: boolean;
  time?: number;
}

/**
 * Performance logger interface.
 */
export interface PerformanceLogger {
  /** Log a test result with timing */
  logTestResult: (result: TestResult) => void;
  /** Get all logged results */
  getLog: () => Record<string, string>;
  /** Get total execution time */
  getTotal: () => number;
}

/**
 * Create a performance logger for tracking fingerprint test results.
 * Logs to console with color-coded pass/fail indicators.
 *
 * @returns PerformanceLogger instance
 */
export function createPerformanceLogger(): PerformanceLogger {
  const log: Record<string, string> = {};
  let total = 0;
  return {
    logTestResult: ({ test, passed, time = 0 }: TestResult) => {
      total += time;
      const timeString = `${time.toFixed(2)}ms`;
      log[test] = timeString;
      const color = passed ? '#4cca9f' : 'lightcoral';
      const result = passed ? 'passed' : 'failed';
      const symbol = passed ? '✔' : '-';
      return console.log(
        `%c${symbol}${time ? ` (${timeString})` : ''} ${test} ${result}`,
        `color:${color}`,
      );
    },
    getLog: () => log,
    getTotal: () => total,
  };
}

/** Shared performance logger instance */
export const performanceLogger = createPerformanceLogger();

/** Convenience export for logging test results */
export const { logTestResult } = performanceLogger;

/**
 * Race a promise against a timeout, returning undefined if slow/rejected.
 * Useful for fingerprint operations that may hang on some browsers.
 *
 * @param options - Configuration object
 * @param options.promise - Promise to race
 * @param options.responseType - Expected response constructor (for instanceof check)
 * @param options.limit - Timeout in ms (default: 1000)
 * @returns Promise result or undefined if timeout/rejected
 */
export async function getPromiseRaceFulfilled<T>({
  promise,
  responseType,
  limit = 1000,
}: {
  promise: Promise<T>;
  responseType: new (...args: unknown[]) => T;
  limit?: number;
}): Promise<T | undefined> {
  const slowPromise = new Promise((resolve) => setTimeout(resolve, limit));
  const response = await Promise.race([slowPromise, promise])
    .then((response) =>
      response instanceof responseType ? response : 'pending',
    )
    .catch(() => 'rejected');
  return response == 'rejected' || response == 'pending'
    ? undefined
    : (response as T);
}
