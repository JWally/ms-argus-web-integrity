/**
 * Telemetry Helper Functions
 *
 * URL detection, session ID generation, and gzip compression utilities
 * for the telemetry submission system.
 *
 * @module telemetry/helpers
 */

import type { TelemetryConfig } from './types';

/**
 * Build API base URL from config.
 *
 * @param config - Telemetry configuration with base domain and stage prefix
 * @returns Full API base URL (e.g., "https://api-dev.argus.pw")
 */
export function buildApiBase(config: TelemetryConfig): string {
  const { baseDomain, stagePrefix = '' } = config;
  const stage = stagePrefix.replace(/-$/, '');
  return stage
    ? `https://api-${stage}.${baseDomain}`
    : `https://api.${baseDomain}`;
}

/**
 * Auto-detect stage from current hostname.
 *
 * @example
 * // static-dev-jw.argus.pw -> 'dev-jw-'
 * // static.argus.pw -> '' (prod)
 *
 * @returns Stage prefix with trailing dash, or empty string for prod
 */
export function detectStageFromHostname(): string {
  if (typeof window === 'undefined') return '';
  const hostname = window.location?.hostname || '';
  const match = hostname.match(/^static-([^.]+)\./);
  if (match) return match[1] + '-';
  if (hostname.startsWith('static.')) return '';
  return 'dev-jw-'; // Default to dev
}

/**
 * Auto-detect API base URL from hostname.
 *
 * @param baseDomain - Base domain for API (e.g., "argus.pw")
 * @returns Full API base URL derived from current hostname
 */
export function detectApiBaseFromHostname(baseDomain: string): string {
  if (typeof window === 'undefined') {
    return `https://api.${baseDomain}`;
  }

  const hostname = window.location?.hostname || '';

  // If on argus.pw subdomain, derive API base from hostname
  if (hostname.includes('argus.pw')) {
    const hostParts = hostname.split('.');
    let stage = hostParts.length > 2 ? hostParts[0] : '';
    // Strip static- or demo- prefix to get the stage name
    if (stage.startsWith('static-')) {
      stage = stage.replace('static-', '');
    } else if (stage.startsWith('demo-')) {
      stage = stage.replace('demo-', '');
    } else if (stage === 'static' || stage === 'demo') {
      stage = '';
    }
    return stage ? `https://api-${stage}.argus.pw` : `https://api.argus.pw`;
  }

  // Otherwise use config
  const stagePrefix = detectStageFromHostname();
  const stage = stagePrefix.replace(/-$/, '');
  return stage
    ? `https://api-${stage}.${baseDomain}`
    : `https://api.${baseDomain}`;
}

/**
 * Generate unique session ID.
 *
 * @returns Session ID in format "demo-{timestamp}-{random}"
 */
export function generateSessionId(): string {
  return 'demo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
}

/**
 * Check if browser supports CompressionStream API for gzip.
 * Chrome 80+, Firefox 113+, Safari 16.4+
 *
 * @returns True if CompressionStream is available
 */
export function supportsGzipCompression(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/**
 * Gzip compress a string and return as Uint8Array.
 * Uses browser's CompressionStream API.
 *
 * @param data - String data to compress
 * @returns Compressed data as raw binary bytes
 */
export async function gzipCompress(data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(data);

  const compressionStream = new CompressionStream('gzip');
  const writer = compressionStream.writable.getWriter();
  writer.write(inputBytes);
  writer.close();

  const compressedStream = compressionStream.readable;
  const reader = compressedStream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks into single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}
