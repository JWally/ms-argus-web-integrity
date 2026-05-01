/**
 * Timing Module
 *
 * Collects timing signals useful for bot/integrity detection:
 *
 * - highPrecision / resolution: timer granularity reveals browser privacy settings
 *   (Firefox RFP → 100ms, Brave → ~0.1ms, Chrome → ~1ms). Mismatch with
 *   claimed browser is a spoof signal.
 *
 * - drift: delta between performance.now() and Date.now() over a short window.
 *   Date.now() can be patched; performance.now() cannot. Large drift indicates
 *   clock manipulation or a misbehaving VM clock.
 *
 * - tcpConnect / tlsHandshake: from PerformanceNavigationTiming. Non-zero
 *   values confirm a real remote TLS connection. Zero on a production HTTPS
 *   origin suggests a local proxy doing TLS termination.
 *
 * - navigationProtocol / resourceProtocols: nextHopProtocol from Resource
 *   Timing. Cross-validate with h2-probe sigint data — mismatch indicates a
 *   protocol-downgrading proxy.
 *
 * @module timing
 */

import { captureError } from '../errors';
import { hashMini } from '../utils/crypto';
import { createTimer, logTestResult } from '../utils/helpers';

export interface TimingFingerprint {
  /** crossOriginIsolated — requires COOP/COEP headers, rare in the wild */
  highPrecision: boolean;
  /** Smallest measurable performance.now() delta (ms): ~1 Chrome, ~100 Firefox RFP */
  resolution: number;
  /** |perfElapsed - dateElapsed| over a 50ms window — clock manipulation indicator */
  drift: number;
  /** TCP connection time from PerformanceNavigationTiming (ms) */
  tcpConnect: number;
  /** TLS handshake time from PerformanceNavigationTiming (ms), 0 if no TLS */
  tlsHandshake: number;
  /** nextHopProtocol for the page navigation ("h2", "http/1.1", etc.) */
  navigationProtocol: string;
  /** nextHopProtocol for each loaded resource — should all agree with navigation */
  resourceProtocols: string[];
  $hash: string;
}

function measureResolution(iterations = 100): number {
  let minDelta = Infinity;
  for (let i = 0; i < iterations; i++) {
    const t1 = performance.now();
    let t2 = t1;
    while (t2 === t1) t2 = performance.now();
    const delta = t2 - t1;
    if (delta < minDelta) minDelta = delta;
  }
  return Math.round(minDelta * 1000) / 1000;
}

function getNavigationTiming(): {
  tcpConnect: number;
  tlsHandshake: number;
  navigationProtocol: string;
} {
  try {
    const entries = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[];
    if (!entries.length)
      return { tcpConnect: 0, tlsHandshake: 0, navigationProtocol: '' };
    const nav = entries[0];
    return {
      tcpConnect: Math.round((nav.connectEnd - nav.connectStart) * 1000) / 1000,
      tlsHandshake:
        nav.secureConnectionStart > 0
          ? Math.round((nav.connectEnd - nav.secureConnectionStart) * 1000) /
            1000
          : 0,
      navigationProtocol: nav.nextHopProtocol ?? '',
    };
  } catch {
    return { tcpConnect: 0, tlsHandshake: 0, navigationProtocol: '' };
  }
}

function getResourceProtocols(): string[] {
  try {
    const entries = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    return entries.slice(0, 10).map((r) => r.nextHopProtocol ?? '');
  } catch {
    return [];
  }
}

export default async function getTimingFingerprint(): Promise<
  TimingFingerprint | undefined
> {
  try {
    const timer = createTimer();
    timer.start();

    const highPrecision =
      typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;

    const resolution = measureResolution();

    const t0perf = performance.now();
    const t0date = Date.now();

    await new Promise((r) => setTimeout(r, 50));

    const drift =
      Math.round(
        Math.abs(performance.now() - t0perf - (Date.now() - t0date)) * 1000,
      ) / 1000;

    const { tcpConnect, tlsHandshake, navigationProtocol } =
      getNavigationTiming();
    const resourceProtocols = getResourceProtocols();

    const result: TimingFingerprint = {
      highPrecision,
      resolution,
      drift,
      tcpConnect,
      tlsHandshake,
      navigationProtocol,
      resourceProtocols,
      $hash: hashMini({ resolution, drift, highPrecision }),
    };

    logTestResult({ time: timer.stop(), test: 'timing', passed: true });
    return result;
  } catch (error) {
    logTestResult({ test: 'timing', passed: false });
    captureError(error as Error);
    return undefined;
  }
}
