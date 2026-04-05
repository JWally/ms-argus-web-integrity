/**
 * Telemetry module types
 */

import type { IntegrityResult } from '../integrity';
import type { SigintData } from '../utils/sigint';
import type { CryptoKeys } from '../utils/get-crypto-id';
import type { EvercookieData } from '../utils/evercookie';

// ============================================================================
// Payload Types
// ============================================================================

export interface PayloadIdentifiers {
  session_id: string;
  evercookie_id?: string;
  public_key?: string;
  /** Ground truth data for test validation (e.g., BrowserStack capabilities) */
  ground_truth?: GroundTruth;
  /** Arbitrary metadata forwarded from script-tag query params / caller config */
  metadata?: Record<string, string>;
}

/**
 * Ground truth data for test validation.
 * Populated from URL params when running in test environments (e.g., BrowserStack).
 */
export interface GroundTruth {
  /** Browser name (e.g., "Chrome", "Firefox", "Safari") */
  browser?: string;
  /** Browser version (e.g., "120", "latest") */
  browser_version?: string;
  /** OS name (e.g., "Windows", "OS X", "iOS", "Android") */
  os?: string;
  /** OS version (e.g., "11", "Sonoma", "18") */
  os_version?: string;
  /** Device name for mobile (e.g., "iPhone 16 Pro", "Samsung Galaxy S24") */
  device?: string;
  /** Test run identifier for grouping multiple runs */
  test_run?: string;
}

/**
 * Hashes section - stable, fuzzy, plus all module hashes from loose
 */
export interface PayloadHashes {
  stable: string;
  fuzzy: string;
  [moduleKey: string]: string; // Dynamic module hashes (canvas2d, canvasWebgl, etc.)
}

/**
 * Device section - full loose fingerprint data
 */
export type PayloadDevice = Record<string, unknown>;

/**
 * Sigint section - network intelligence data
 */
export type PayloadSigint = Record<string, unknown>;

export interface ArgusPayload {
  identifiers: PayloadIdentifiers;
  hashes: PayloadHashes;
  device: PayloadDevice;
  deltaReport?: Record<string, string[]>;
  sigint?: PayloadSigint;
  buildId?: string;
}

// ============================================================================
// Config & Submission Types
// ============================================================================

export interface TelemetryConfig {
  /** Base domain for API (e.g., "argus.pw") */
  baseDomain: string;
  /** Stage prefix (e.g., "dev-jw-", "qa-", "" for prod) */
  stagePrefix?: string;
  /** Tenant ID for multi-tenant deployments */
  tenantId?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
}

export interface TelemetrySubmission {
  fingerprint: IntegrityResult;
  sigint?: SigintData;
  evercookie?: EvercookieData;
  cryptoId?: CryptoKeys;
  /** Arbitrary key-value metadata forwarded into the payload (e.g., URL query params) */
  metadata?: Record<string, string>;
  /** Explicit session ID — if provided, used instead of auto-generating one */
  sessionId?: string;
}

// ============================================================================
// Result Types
// ============================================================================

/** Match result returned by GET /v1/session/{sessionId} */
export interface MatchResult {
  session_id: string;
  device_id: string;
  match_tier: number;
  confidence: number;
  status: 'pending' | 'complete' | 'degraded';
}

export interface TelemetryResult {
  /** Session ID to use for fetching results from GET /v1/session/{sessionId} */
  sessionId: string;
  /** Whether the fingerprint was successfully submitted */
  submitted: boolean;
  /** Error message if submission failed */
  error?: string;
  /** Timing information */
  timing: {
    submitMs: number;
    totalMs: number;
  };
  /** Match result from GET /v1/session/{sessionId} — present when polling succeeded */
  matchResult?: MatchResult;
  /** Full raw API response from GET /v1/session/{sessionId} */
   
  apiResponse?: Record<string, any>;
}
