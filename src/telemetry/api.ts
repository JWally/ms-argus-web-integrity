/**
 * Telemetry API Functions
 *
 * Submit fingerprint data to the Argus API.
 *
 * @module telemetry/api
 */

import type {
  TelemetryConfig,
  TelemetrySubmission,
  TelemetryResult,
  MatchResult,
} from './types';
import { buildPayload } from './payload';
import {
  detectApiBaseFromHostname,
  generateSessionId,
  supportsGzipCompression,
  gzipCompress,
} from './helpers';

export const SCHEMA_VERSION = '3.0.0';

/**
 * Submit fingerprint data to the Argus API.
 *
 * Returns the session ID for the caller to fetch results separately.
 *
 * @param data - Telemetry submission data including fingerprint and identifiers
 * @param config - Configuration for API endpoint and timeouts
 * @returns Result with session ID and timing info
 */
export async function submitTelemetry(
  data: TelemetrySubmission,
  config: TelemetryConfig,
): Promise<TelemetryResult> {
  const startTime = performance.now();
  const sessionId = data.sessionId || generateSessionId();

  const { baseDomain, timeout = 10000 } = config;

  const apiBase = detectApiBaseFromHostname(baseDomain);

  const result: TelemetryResult = {
    sessionId,
    submitted: false,
    timing: {
      submitMs: 0,
      totalMs: 0,
    },
  };

  try {
    const submission = buildPayload(data, sessionId);

    // Submit to API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      let response: Response;

      // AR-91: Send binary gzip if browser supports CompressionStream
      if (supportsGzipCompression()) {
        const jsonString = JSON.stringify(submission);
        const gzippedBytes = await gzipCompress(jsonString);

        response = await fetch(`${apiBase}/v1/collect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Encoding': 'gzip',
            'X-Argus-Schema-Version': SCHEMA_VERSION,
          },
          body: gzippedBytes as BodyInit,
          signal: controller.signal,
        });
      } else {
        // Fallback: send uncompressed JSON
        response = await fetch(`${apiBase}/v1/collect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Argus-Schema-Version': SCHEMA_VERSION,
          },
          body: JSON.stringify(submission),
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      if (response.status !== 204 && !response.ok) {
        throw new Error(
          `API returned ${response.status}: ${response.statusText}`,
        );
      }

      result.submitted = true;
      result.timing.submitMs = performance.now() - startTime;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw err;
    }
  } catch (err: any) {
    result.error = err.message || String(err);
  }

  result.timing.totalMs = performance.now() - startTime;
  return result;
}

/**
 * Poll GET /v1/session/{sessionId} until matching completes or timeout.
 *
 * The matching pipeline is async (SQS → matching-worker), so the session
 * starts as "pending" and transitions to "complete" or "degraded" once done.
 * Polls every 250ms, gives up after maxWaitMs (default 5000ms).
 *
 * @returns The full API response and parsed match result, or undefined on failure
 */
export async function fetchSessionResult(
  sessionId: string,
  apiBase: string,
  maxWaitMs = 5000,
): Promise<
  { matchResult: MatchResult; apiResponse: Record<string, unknown> } | undefined
> {
  const pollIntervalMs = 250;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${apiBase}/v1/session/${sessionId}`);

      if (resp.status === 404) {
        // Session not yet in cache — matching still in progress, keep polling
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        continue;
      }
      if (!resp.ok) return undefined;

       
      const data: Record<string, any> = await resp.json();

      // API returns nested structure: identifiers.device_id, analysis.status, etc.
      const matchResult: MatchResult = {
        session_id: data.identifiers?.session_id ?? sessionId,
        device_id: data.identifiers?.device_id ?? 'unknown',
        match_tier: data.analysis?.match_tier ?? -1,
        confidence: data.analysis?.confidence ?? 0,
        status: data.analysis?.status ?? 'complete',
      };

      if (matchResult.status !== 'pending') {
        return { matchResult, apiResponse: data };
      }

      // Still pending — wait before next poll
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Get human-readable label for a match tier.
 *
 * @param tier - Numeric match tier (-1 to 3)
 * @returns Display label describing the match tier
 */
export function getMatchTierLabel(tier: number): string {
  const labels: Record<string, string> = {
    '-1': 'New Device',
    '0': 'Cache Hit',
    '0.5': 'Tier 0.5 (Evercookie/PublicKey)',
    '1': 'Tier 1 (Hash Match)',
    '1.5': 'Tier 1.5 (SimHash Match)',
    '2': 'Tier 2 (Vector Match)',
    '3': 'Tier 3 (Soft Match)',
  };
  return labels[String(tier)] || `Tier ${tier}`;
}
