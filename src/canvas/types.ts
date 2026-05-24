/**
 * Canvas Fingerprinting Types
 */

/** Per-probe outcome — value plus an indicator if the canvas API errored. */
export interface CanvasProbe {
  /** md5-mini of the canvas output for this probe */
  hash: string;
  /** byte length of the source toDataURL string (entropy / capability indicator) */
  len: number;
}

/**
 * Canvas 2D rendering fingerprint — raw signals only.
 *
 * Mirrors FingerprintJS slot s17 (`{winding, geometry, text}`) plus an
 * emoji sub-pass and a font-width probe inspired by Castle's
 * `measureText('mmmmmmmmmmlli')` trick (Castle.md §3.3).
 *
 * Server-side analysis expected for:
 *   - canvas hash vs claimed-OS population baseline
 *   - hash stability across two consecutive runs (Brave / Safari RFP
 *     inject per-call noise — flag if `hash` floats but the bench
 *     reports the same browser)
 */
export interface CanvasFingerprint {
  /** Canvas 2D context available? false = severe lockdown or no DOM */
  contextAvailable: boolean;
  /** isPointInPath winding-rule probe (Chrome/Firefox/Safari differ) */
  winding: boolean;
  /**
   * Geometric primitive hash — gradient + arcs + shapes rasterized
   * without text. Captures GPU/anti-aliasing characteristics.
   */
  geometry: CanvasProbe;
  /**
   * Text rendering hash — fillText with multiple fonts + rare-script
   * glyphs (emoji 🗺️😀, Swedish åäö, Brahmi 𑀅, Tibetan ༀ, Burmese ဎ).
   * Captures system font rasterizer (FreeType / DirectWrite / CoreText).
   */
  text: CanvasProbe;
  /**
   * Emoji-only rendering hash — separated from `text` because hardware-
   * accelerated color font rasterization differs sharply per OS/GPU
   * and emoji fonts ship per-OS (Apple Color Emoji vs Segoe UI Emoji
   * vs Noto Color Emoji). High discriminating power.
   */
  emoji: CanvasProbe;
  /**
   * Castle's font-enumeration trick: width of `'mmmmmmmmmmlli'` for
   * each of {default, serif, sans, mono, cursive, fantasy} in a
   * fixed-size font. Same string fingerprints the font fallback chain
   * without enumerating individual fonts (which font-blockers detect).
   */
  fontWidths: Record<string, number>;
}
