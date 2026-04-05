/**
 * Telemetry Module
 *
 * Handles submission of fingerprint data to the Argus API.
 * Session results should be fetched separately by the caller.
 *
 * @module telemetry
 */

// Types
export type {
  PayloadIdentifiers,
  PayloadHashes,
  PayloadDevice,
  PayloadSigint,
  ArgusPayload,
  TelemetryConfig,
  TelemetrySubmission,
  TelemetryResult,
  MatchResult,
} from './types';

// Payload builder
export { buildPayload } from './payload';

// API functions
export {
  SCHEMA_VERSION,
  submitTelemetry,
  fetchSessionResult,
  getMatchTierLabel,
} from './api';

// Helpers (exported for testing)
export {
  buildApiBase,
  detectStageFromHostname,
  detectApiBaseFromHostname,
  generateSessionId,
  supportsGzipCompression,
  gzipCompress,
} from './helpers';
