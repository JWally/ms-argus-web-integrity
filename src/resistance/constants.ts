/**
 * Resistance Detection Constants
 *
 * Configuration for detecting privacy browsers and fingerprint protection modes.
 *
 * NOTE: Extension detection patterns have been moved server-side.
 * See TODO-server-side-analysis.md for the Extension Pattern Matching section.
 * The client sends `extensionHashPattern` with raw lie detection hashes,
 * and the server matches against known extension signatures.
 */

/**
 * Hash value indicating a feature is disabled or not present.
 */
export const DISABLED_HASH = 'c767712b';

/**
 * Firefox/Tor features to probe for privacy mode detection.
 *
 * When resistFingerprinting is enabled in Firefox/Tor, certain APIs
 * are disabled or return fake values. By probing these features,
 * we can detect privacy mode and distinguish Tor Browser from Firefox.
 *
 * Tor Browser specifically disables:
 * - RTCRtpTransceiver (WebRTC leak prevention)
 * - MediaDevices (camera/mic enumeration)
 * - Credential (credential management API)
 */
export const FIREFOX_PRIVACY_FEATURES = [
  'OfflineAudioContext', // dom.webaudio.enabled
  'WebGL2RenderingContext', // webgl.enable-webgl2
  'WebAssembly', // javascript.options.wasm (disabled in "safer" mode)
  'maxTouchPoints',
  'RTCRtpTransceiver', // Disabled in Tor
  'MediaDevices', // Disabled in Tor
  'Credential', // Disabled in Tor
] as const;

/**
 * Features that are disabled specifically in Tor Browser.
 * Used to distinguish Tor from Firefox with resistFingerprinting.
 */
export const TOR_DISABLED_FEATURES = new Set([
  'RTCRtpTransceiver',
  'MediaDevices',
  'Credential',
]);

/**
 * Timer precision detection sample count.
 * More samples provide higher confidence but increase detection time.
 */
export const TIMER_SAMPLE_COUNT = 10;
