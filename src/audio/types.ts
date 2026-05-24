/**
 * Audio Fingerprinting Types
 */

/**
 * Web Audio fingerprint.
 *
 * Two orthogonal entropy sources:
 *
 * 1. `sampleSum` — classic OfflineAudioContext rendered-sample sum
 *    (fpjs s21). Discriminates DSP precision per CPU+OS but collapses
 *    to noise on Safari (WebKit RFP injects per-session perturbation).
 *
 * 2. `nodeConstants` — ~45 declarative AudioParam properties read
 *    statically from the audio node classes. ENGINE CONSTANTS, not
 *    rendered samples — Safari's output noise does NOT perturb them.
 *    Stable per (engine, version), discriminates across engines and
 *    versions cleanly. The Safari-immune entropy source.
 *
 * Server-side analysis:
 *   - sampleSum vs claimed-OS distribution (population check)
 *   - nodeConstants vs known (browser, version) reference table
 *   - sampleSum stability across two runs (Brave/Safari = unstable)
 */
export interface AudioFingerprint {
  /** OfflineAudioContext was instantiable in this realm */
  available: boolean;
  /** Sum of rendered samples in a fixed range — fpjs s21 equivalent. NaN if unavailable. */
  sampleSum: number;
  /** Final compressor reduction in dB after rendering. NaN if unavailable. */
  compressorReduction: number;
  /**
   * Engine-constant dictionary read from AudioParam .defaultValue /
   * .minValue / .maxValue on AnalyserNode / DynamicsCompressorNode /
   * OscillatorNode / BiquadFilterNode / GainNode. Safari-noise-immune.
   */
  nodeConstants: Record<string, number>;
  /** True if rendering threw — possibly indicates blocked audio context. */
  renderingFailed: boolean;
}
