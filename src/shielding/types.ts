/**
 * Shielding Detection Types
 *
 * Type definitions for privacy shield / fingerprint protection detection.
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
 * Shielding fingerprint result.
 *
 * Classifies the privacy posture and shielding tooling of the client:
 * which browser, which protection mode, which extension (server-side).
 * Used to contextualize other signals — e.g. screen lies in Brave strict
 * are expected noise; the same signal in plain Chrome is a hard bot indicator.
 */
export interface ShieldingFingerprint {
  /** Detected privacy browser: 'Brave' | 'Tor Browser' | 'Firefox' — null if none detected */
  privacy: 'Brave' | 'Tor Browser' | 'Firefox' | null;
  /** Detected security features — null if no privacy tool detected */
  security: BraveSecurityFeatures | FirefoxSecurityFeatures | null;
  /** Protection mode — null if no privacy tool detected */
  mode: 'allow' | 'standard' | 'strict' | 'safer' | 'resistFingerprinting' | null;
  /** JS engine: 'Blink' | 'Gecko' */
  engine: string;
  /**
   * Lie hash pattern across ~29 APIs — sent to server for extension identification.
   * Each extension (CanvasBlocker, JShelter, etc.) produces a unique hash signature.
   */
  extensionHashPattern?: Record<string, string>;
}
