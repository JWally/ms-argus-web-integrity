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
  /**
   * Full navigation-timing breakdown (DataDome `nt_*` series).
   * HTTP-proxy-stacked sessions leak a distinctive signature even when
   * IP/canvas/audio/fonts look clean: nt_dns ≈ 0 + nt_tcp ≈ 0 +
   * nt_tls ≈ 3ms when the proxy's upstream has a warm session.
   * Server cross-check: nt_dns + nt_tcp + nt_tls < 5ms AND
   * nt_request > 500ms → HTTP proxy with high confidence.
   */
  navigationBreakdown: NavigationBreakdown;
  /**
   * performance.now() loop-variance bench (Castle pattern, 2,313 reads/token).
   * Tight loop of ~500 perf.now() calls; we capture min/max delta and
   * coefficient of variation. CDP step-debugging blows the variance
   * out; VM clocks have characteristic timing patterns.
   */
  perfLoop: PerfLoopBench;
  $hash: string;
}

/** Full PerformanceNavigationTiming phase breakdown in ms. */
export interface NavigationBreakdown {
  /** unloadEnd - unloadStart — previous-page unload */
  unload: number;
  /** redirectEnd - redirectStart — chained redirect time */
  redirect: number;
  /** fetchStart - workerStart — service worker startup (0 if none) */
  workerStart: number;
  /** domainLookupEnd - domainLookupStart — DNS resolution */
  dns: number;
  /** connectEnd - connectStart — TCP handshake (incl. TLS if any) */
  tcp: number;
  /** connectEnd - secureConnectionStart — TLS handshake portion */
  tls: number;
  /** responseStart - requestStart — server first-byte time */
  request: number;
  /** responseEnd - responseStart — server transmission */
  response: number;
  /** domInteractive - responseEnd — parsing to interactive */
  parse: number;
  /** domContentLoadedEventEnd - domContentLoadedEventStart — DCLE block */
  dcle: number;
  /** loadEventEnd - loadEventStart — load-handler block */
  load: number;
  /** transferSize, decodedBodySize, encodedBodySize as a compact triple */
  bytes: { t: number; d: number; e: number };
}

/** perf.now loop bench result (Castle-style timing entropy probe). */
export interface PerfLoopBench {
  /** Number of perf.now() reads executed */
  n: number;
  /** Minimum non-zero delta between consecutive reads (µs) */
  minDeltaUs: number;
  /** Maximum delta between consecutive reads (µs) */
  maxDeltaUs: number;
  /** Mean delta (µs) */
  meanDeltaUs: number;
  /** Coefficient of variation (stddev/mean) of deltas */
  cv: number;
  /** Total wall-clock time the loop occupied (ms) */
  totalMs: number;
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

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function getNavigationBreakdown(): NavigationBreakdown {
  const empty: NavigationBreakdown = {
    unload: 0,
    redirect: 0,
    workerStart: 0,
    dns: 0,
    tcp: 0,
    tls: 0,
    request: 0,
    response: 0,
    parse: 0,
    dcle: 0,
    load: 0,
    bytes: { t: 0, d: 0, e: 0 },
  };
  try {
    const entries = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[];
    if (!entries.length) return empty;
    const n = entries[0];
    return {
      unload: r3(n.unloadEventEnd - n.unloadEventStart),
      redirect: r3(n.redirectEnd - n.redirectStart),
      workerStart: r3(n.workerStart > 0 ? n.fetchStart - n.workerStart : 0),
      dns: r3(n.domainLookupEnd - n.domainLookupStart),
      tcp: r3(n.connectEnd - n.connectStart),
      tls: r3(
        n.secureConnectionStart > 0
          ? n.connectEnd - n.secureConnectionStart
          : 0,
      ),
      request: r3(n.responseStart - n.requestStart),
      response: r3(n.responseEnd - n.responseStart),
      parse: r3(n.domInteractive - n.responseEnd),
      dcle: r3(n.domContentLoadedEventEnd - n.domContentLoadedEventStart),
      load: r3(n.loadEventEnd - n.loadEventStart),
      bytes: {
        t: n.transferSize ?? 0,
        d: n.decodedBodySize ?? 0,
        e: n.encodedBodySize ?? 0,
      },
    };
  } catch {
    return empty;
  }
}

/**
 * Castle-style perf.now() loop variance bench. ~500 perf.now() reads
 * in a tight loop; capture inter-read deltas. CDP step-debugging
 * inflates the variance; deterministic VM clocks (older replay
 * engines) show characteristic patterns.
 */
function getPerfLoop(iterations = 500): PerfLoopBench {
  const empty: PerfLoopBench = {
    n: 0,
    minDeltaUs: 0,
    maxDeltaUs: 0,
    meanDeltaUs: 0,
    cv: 0,
    totalMs: 0,
  };
  try {
    const t0 = performance.now();
    const samples: number[] = new Array(iterations);
    samples[0] = performance.now();
    for (let i = 1; i < iterations; i++) {
      samples[i] = performance.now();
    }
    const total = performance.now() - t0;

    const deltas: number[] = [];
    let minD = Infinity;
    let maxD = -Infinity;
    let sum = 0;
    for (let i = 1; i < samples.length; i++) {
      const d = (samples[i] - samples[i - 1]) * 1000; // µs
      if (d > 0) {
        deltas.push(d);
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
        sum += d;
      }
    }
    if (deltas.length === 0) return empty;
    const mean = sum / deltas.length;
    let varSum = 0;
    for (const d of deltas) varSum += (d - mean) ** 2;
    const stddev = Math.sqrt(varSum / deltas.length);
    // Clamp to DDB-safe range — a backgrounded tab can produce huge
    // maxDelta values if perf.now() jumps while the loop was suspended.
    const safe = (n: number): number => {
      if (!Number.isFinite(n)) return 0;
      if (n > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
      if (n < Number.MIN_SAFE_INTEGER) return Number.MIN_SAFE_INTEGER;
      return n;
    };
    return {
      n: iterations,
      minDeltaUs: r3(safe(minD === Infinity ? 0 : minD)),
      maxDeltaUs: r3(safe(maxD === -Infinity ? 0 : maxD)),
      meanDeltaUs: r3(safe(mean)),
      cv: mean > 0 ? r3(safe(stddev / mean)) : 0,
      totalMs: r3(safe(total)),
    };
  } catch {
    return empty;
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
    const navigationBreakdown = getNavigationBreakdown();
    const perfLoop = getPerfLoop();

    const result: TimingFingerprint = {
      highPrecision,
      resolution,
      drift,
      tcpConnect,
      tlsHandshake,
      navigationProtocol,
      resourceProtocols,
      navigationBreakdown,
      perfLoop,
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
