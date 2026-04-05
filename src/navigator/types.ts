/**
 * Navigator Fingerprinting Types
 *
 * Type definitions for navigator data collection.
 */

/**
 * Plugin information extracted from navigator.plugins.
 */
export interface PluginInfo {
  name: string;
  description: string;
  filename: string;
  version?: string;
}

/**
 * User-Agent Client Hints data.
 * https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData
 */
export interface UserAgentData {
  brands?: string[];
  brandsVersion?: string[];
  mobile?: boolean;
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  uaFullVersion?: string;
}

/**
 * Permission states grouped by state type.
 */
export interface PermissionStates {
  granted?: string[];
  denied?: string[];
  prompt?: string[];
  unknown?: string[];
}

/**
 * WebGPU adapter information.
 */
export interface WebGpuInfo {
  adapterInfo: (string | undefined)[];
  limits: Record<string, number>;
}

/**
 * Parsed User-Agent information.
 */
export interface ParsedUserAgent {
  browser?: string;
  version?: string;
  os?: string;
  device?: string;
}

/**
 * Complete navigator fingerprint result.
 */
export interface NavigatorFingerprint {
  /** Operating system platform (e.g., "Win32", "Linux x86_64") */
  platform: string | undefined;

  /** Detected OS from user agent parsing */
  system: string | undefined;

  /** Parsed user agent details */
  userAgentParsed: ParsedUserAgent | string | undefined;

  /** Device type from user agent */
  device: string | undefined;

  /** Raw user agent string */
  userAgent: string | undefined;

  /** Whether UA has post-reduction format */
  uaPostReduction: boolean;

  /** App version string */
  appVersion: string | undefined;

  /** Device memory in GB (0.25, 0.5, 1, 2, 4, 8) */
  deviceMemory: number | undefined;

  /** Do Not Track preference */
  doNotTrack: string | null | undefined;

  /** Global Privacy Control preference */
  globalPrivacyControl: string | undefined;

  /** Number of logical CPU cores */
  hardwareConcurrency: number | undefined;

  /** Language(s) preference string */
  language: string | undefined;

  /** Maximum simultaneous touch points */
  maxTouchPoints: number | null | undefined;

  /** Browser vendor string */
  vendor: string | undefined;

  /** Registered MIME types */
  mimeTypes: string[] | undefined;

  /** OS/CPU description (Firefox only) */
  oscpu: string | undefined;

  /** Installed browser plugins */
  plugins: PluginInfo[] | undefined;

  /** Navigator prototype property names */
  properties: string[] | undefined;

  /** User-Agent Client Hints (high entropy) */
  userAgentData: UserAgentData | undefined;

  /** Bluetooth availability */
  bluetoothAvailability: boolean | undefined;

  /** Permission states for various APIs */
  permissions: PermissionStates | undefined;

  /** WebGPU adapter information */
  webgpu: WebGpuInfo | undefined;

  /** Attribution Reporting API / Private Click Measurement support */
  attributionSupport:
    | { supported: boolean; variant: 'chromium' | 'safari' | 'none' }
    | undefined;

  /** Network Information API data (Chromium only) */
  networkInformation:
    | {
        rtt: number | undefined;
        downlink: number | undefined;
        effectiveType: string | undefined;
        saveData: boolean | undefined;
        type: string | undefined;
      }
    | undefined;

  /** Whether tampering was detected */
  lied: boolean;
}
