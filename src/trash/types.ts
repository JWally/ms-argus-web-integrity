/**
 * Trash/Validation Module Types
 *
 * Type definitions for suspicious value detection and WebGL validation.
 */

/**
 * A collected trash value entry.
 */
export interface TrashEntry {
  /** Name/source of the suspicious value */
  name: string;
  /** The suspicious value or description */
  value: unknown;
}

/**
 * WebGL renderer confidence assessment.
 */
export interface RendererConfidence {
  /** Known GPU parts found in the renderer string */
  parts: string;
  /** Warnings about the renderer string (spacing, structure issues) */
  warnings: string[];
  /** Detected gibberish sequences */
  gibbers: string;
  /** Overall confidence level */
  confidence: 'high' | 'moderate' | 'low';
  /** Letter grade (A/C/F) */
  grade: 'A' | 'C' | 'F';
}

/**
 * Trash collection result.
 */
export interface TrashResult {
  /** All collected trash entries */
  trashBin: TrashEntry[];
}
