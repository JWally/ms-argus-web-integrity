/**
 * Lie Detection Types
 *
 * Type definitions for the lie detection system that identifies
 * API tampering, proxy wrapping, and other signs of automation.
 */

/**
 * Records of detected lies.
 * Key is the API name (e.g., "Navigator.userAgent"), value is array of lie types.
 */
export type LieRecords = Record<string, string[]>;

/**
 * Configuration for error trap testing.
 * Used to test if calling a function produces expected errors.
 */
export interface ErrorTrap {
  /** Function that should throw a TypeError */
  spawnErr: () => void;

  /** Optional function to validate the error stack trace */
  withStack?: (err: Error) => boolean;

  /** Optional cleanup function to run after test */
  final?: () => void;
}

/**
 * Result of querying a single API function for lies.
 */
export interface LieQueryResult {
  /** Number of lies detected (0 = no tampering detected) */
  lied: number;

  /** Array of lie type strings describing what was detected */
  lieTypes: string[];
}

/**
 * Configuration for the queryLies function.
 */
export interface LieQueryConfig {
  /** Window scope to test in (main window or iframe) */
  scope: Window & typeof globalThis;

  /** The API function to test for tampering */
  apiFunction: Function;

  /** The prototype object containing the function */
  proto: unknown;

  /** The constructor object (for special tests) */
  obj: unknown;

  /** Existing lie props to check for escalated testing */
  lieProps: Record<string, string[]>;
}

/**
 * Configuration for searching lies on an API.
 */
export interface SearchConfig {
  /** Specific properties to target (if undefined, search all) */
  target?: string[];

  /** Properties to ignore during search */
  ignore?: string[];
}

/**
 * Result from the main prototype lie detection.
 */
export interface PrototypeLiesResult {
  /** The lie detector instance for further queries */
  lieDetector: LieDetector;

  /** List of API names that have detected lies */
  lieList: string[];

  /** Detailed lie information by API name */
  lieDetail: LieRecords;

  /** Total count of lies across all APIs */
  lieCount: number;

  /** List of all API properties that were searched */
  propsSearched: string[];
}

/**
 * Interface for the lie detector instance.
 */
export interface LieDetector {
  /** Get all detected lies */
  getProps: () => Record<string, string[]>;

  /** Get list of all properties searched */
  getPropsSearched: () => string[];

  /** Search for lies on a given API */
  searchLies: (fn: () => unknown, config?: SearchConfig) => void;
}

/**
 * Result from plugin lie detection.
 */
export interface PluginLiesResult {
  /** Plugins that passed validation */
  validPlugins: Plugin[];

  /** MimeTypes that passed validation */
  validMimeTypes: MimeType[];

  /** List of lie types detected */
  lies: string[];
}

/**
 * Combined lies result.
 */
export interface LiesResult {
  /** All lie records */
  data: LieRecords;

  /** Total number of lies across all APIs */
  totalLies: number;
}

/**
 * Phantom iframe result.
 * The phantom iframe is used for isolated API testing.
 */
export interface PhantomIframe {
  /** The contentWindow of the nested iframe */
  iframeWindow: Window & typeof globalThis;

  /** The parent div element (for cleanup) */
  div?: HTMLDivElement;
}

/**
 * Lie records manager interface.
 */
export interface LieRecordsManager {
  /** Get all recorded lies */
  getRecords: () => LieRecords;

  /** Document a new lie */
  documentLie: (name: string, lie: string | string[]) => string[];
}
