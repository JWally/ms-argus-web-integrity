/**
 * Resistance Detection Types
 *
 * Type definitions for privacy/fingerprint resistance detection.
 */

/**
 * Detected security features for Brave browser.
 */
export interface BraveSecurityFeatures {
  FileSystemWritableFileStream: boolean;
  Serial: boolean;
  ReportingObserver: boolean;
}

/**
 * Detected security features for Firefox/Tor.
 */
export interface FirefoxSecurityFeatures {
  reduceTimerPrecision: boolean;
  OfflineAudioContext: boolean;
  WebGL2RenderingContext: boolean;
  WebAssembly: boolean;
  maxTouchPoints: boolean;
  RTCRtpTransceiver: boolean;
  MediaDevices: boolean;
  Credential: boolean;
}

/**
 * Timer precision measurement result.
 */
export interface TimerPrecisionResult {
  protection: boolean;
  delays: (string | number)[];
  precision: number | undefined;
  precisionValue: string | undefined;
}

/**
 * Hash values for prototype lie detection.
 */
export interface LieHashValues {
  contentDocumentHash: string;
  contentWindowHash: string;
  createElementHash: string;
  getElementByIdHash: string;
  appendHash: string;
  insertAdjacentElementHash: string;
  insertAdjacentHTMLHash: string;
  insertAdjacentTextHash: string;
  prependHash: string;
  replaceWithHash: string;
  appendChildHash: string;
  insertBeforeHash: string;
  replaceChildHash: string;
  getContextHash: string;
  toDataURLHash: string;
  toBlobHash: string;
  getImageDataHash: string;
  getByteFrequencyDataHash: string;
  getByteTimeDomainDataHash: string;
  getFloatFrequencyDataHash: string;
  getFloatTimeDomainDataHash: string;
  copyFromChannelHash: string;
  getChannelDataHash: string;
  hardwareConcurrencyHash: string;
  availHeightHash: string;
  availLeftHash: string;
  availTopHash: string;
  availWidthHash: string;
  colorDepthHash: string;
  pixelDepthHash: string;
}

/**
 * Resistance detection fingerprint result.
 */
export interface ResistanceFingerprint {
  /** Detected privacy tool/browser: 'Brave' | 'Tor Browser' | 'Firefox' */
  privacy: string | undefined;
  /** Detected security features */
  security: BraveSecurityFeatures | FirefoxSecurityFeatures | undefined;
  /** Privacy mode: 'allow' | 'standard' | 'strict' | 'safer' | 'resistFingerprinting' */
  mode: string | undefined;
  /**
   * Detected fingerprint resistance extension.
   * NOTE: Now computed server-side from extensionHashPattern.
   * Client always sets this to undefined.
   */
  extension: string | undefined;
  /** JS engine: 'Blink' | 'Gecko' */
  engine: string;
  /** Hash pattern for server-side extension detection */
  extensionHashPattern?: Record<string, string>;
}
