/**
 * Worker Scope Fingerprinting Types
 *
 * Type definitions for web worker-based fingerprint collection.
 */

import type { RendererConfidence } from '../trash/types';

/**
 * User agent data from Navigator.userAgentData API.
 */
export interface UserAgentData {
  /** Browser brands (e.g., ["Chrome", "Chromium"]) */
  brands: string[];
  /** Brands with version numbers */
  brandsVersion: string[];
  /** Whether running on mobile device */
  mobile: boolean;
  /** Operating system platform */
  platform: string;
  /** Full OS platform version */
  platformVersion: string;
  /** CPU architecture (e.g., "x86", "arm") */
  architecture: string;
  /** System bitness ("32" or "64") */
  bitness: string;
  /** Device model (mainly for mobile) */
  model: string;
  /** Full user agent version string */
  uaFullVersion: string;
}

/**
 * Detected lies in worker scope.
 */
export interface WorkerScopeLies {
  /** OS mismatch between platform and user agent */
  os?: string;
  /** JS engine mismatch between runtime and user agent */
  engine?: string;
  /** Version mismatch between userAgentData and user agent */
  version?: string;
  /** Platform version inconsistency */
  platformVersion?: string;
  /** Prototype lies detected (keyed by property name) */
  proto?: Record<string, string[]>;
}

/**
 * GPU information with confidence assessment.
 */
export interface WorkerGPUInfo extends Partial<RendererConfidence> {
  /** Compressed/normalized GPU renderer string */
  compressedGPU: string | undefined;
}

/**
 * Worker scope fingerprint result.
 */
export interface WorkerScopeFingerprint {
  /** Full user agent string */
  userAgent: string;
  /** User agent data API results (Chrome/Edge only) */
  userAgentData?: UserAgentData;
  /** Navigator platform string */
  platform: string;
  /** Device memory in GB (if available) */
  deviceMemory?: number;
  /** Logical processor count */
  hardwareConcurrency: number;
  /** Detected operating system */
  system: string;
  /** Device type from UA parsing */
  device: string;
  /** Timezone offset in minutes */
  timezoneOffset: number;
  /** Timer granularity in milliseconds */
  timezoneOffsetMeasured: number;
  /** Number of supported locales */
  localeNumberLength: number;
  /** WebGL renderer string */
  webglRenderer: string;
  /** WebGL vendor string */
  webglVendor: string;
  /** GPU confidence and compression info */
  gpu: WorkerGPUInfo;
  /** Whether user agent shows post-reduction format */
  uaPostReduction: boolean;
  /** Extracted version from user agent */
  userAgentVersion: string;
  /** Version from userAgentData API */
  userAgentDataVersion: string;
  /** Detected JS engine (V8, SpiderMonkey, JavaScriptCore) */
  userAgentEngine: string;
  /** Whether any lies were detected */
  lied?: boolean;
  /** Details of detected lies */
  lies: WorkerScopeLies;
}
