/**
 * External Data Loader
 *
 * Loads fingerprinting data from external JSON files.
 * This allows the main bundle to be smaller and data to be cached separately.
 */

/** Base path for data files - can be overridden */
let dataBasePath = '/data';

/** Cache for loaded data */
const dataCache: Map<string, unknown> = new Map();

/** Pending requests to avoid duplicate fetches */
const pendingRequests: Map<string, Promise<unknown>> = new Map();

/**
 * Set the base path for data files.
 * Call this before any data loading if using a custom path.
 */
export function setDataBasePath(path: string): void {
  dataBasePath = path.replace(/\/$/, ''); // Remove trailing slash
}

/**
 * Get the current data base path.
 */
export function getDataBasePath(): string {
  return dataBasePath;
}

/**
 * Load a JSON data file.
 * Results are cached to avoid redundant fetches.
 */
async function loadData<T>(filename: string): Promise<T> {
  const cacheKey = filename;

  // Return cached data if available
  if (dataCache.has(cacheKey)) {
    return dataCache.get(cacheKey) as T;
  }

  // Return pending request if one exists
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey) as Promise<T>;
  }

  // Create new request
  const request = fetch(`${dataBasePath}/${filename}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${filename}: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      dataCache.set(cacheKey, data);
      pendingRequests.delete(cacheKey);
      return data as T;
    })
    .catch((error) => {
      pendingRequests.delete(cacheKey);
      throw error;
    });

  pendingRequests.set(cacheKey, request);
  return request;
}

/**
 * Preload all data files.
 * Call this early to warm the cache.
 */
export async function preloadAllData(): Promise<void> {
  await Promise.all([
    loadFeaturesStable(),
    loadFeaturesEngineMaps(),
    loadTimezoneCities(),
    loadWebglGpuCapabilities(),
    loadWebglCapabilities(),
  ]);
}

// ============================================================================
// Features Data
// ============================================================================

export interface StableFeaturesData {
  Chrome?: {
    version: number;
    windowKeys: string;
    cssKeys: string;
    jsKeys?: string;
  };
  Firefox?: {
    version: number;
    windowKeys: string;
    cssKeys: string;
    jsKeys?: string;
  };
}

export interface EngineMapsData {
  blink: {
    js: Record<string, string[]>;
    css: Record<string, string[]>;
    win: Record<string, string[]>;
  };
  gecko: {
    js: Record<string, string[]>;
    css: Record<string, string[]>;
    win: Record<string, string[]>;
  };
}

/**
 * Load the stable browser features data.
 * Contains known window, CSS, and JS keys for Chrome and Firefox.
 *
 * @returns The stable features data for supported browsers.
 */
export async function loadFeaturesStable(): Promise<StableFeaturesData> {
  return loadData<StableFeaturesData>('features-stable.json');
}

/**
 * Load the engine feature maps data.
 * Contains per-version JS, CSS, and window key differences for Blink and Gecko engines.
 *
 * @returns The engine maps data for Blink and Gecko.
 */
export async function loadFeaturesEngineMaps(): Promise<EngineMapsData> {
  return loadData<EngineMapsData>('features-engine-maps.json');
}

// ============================================================================
// Timezone Data
// ============================================================================

/**
 * Load the list of timezone city names.
 * Used for timezone fingerprint validation.
 *
 * @returns An array of known timezone city strings.
 */
export async function loadTimezoneCities(): Promise<string[]> {
  return loadData<string[]>('timezone-cities.json');
}

// ============================================================================
// WebGL Data
// ============================================================================

/**
 * Load the list of known WebGL GPU capability strings.
 * Used for validating GPU renderer and vendor information.
 *
 * @returns An array of known GPU capability identifier strings.
 */
export async function loadWebglGpuCapabilities(): Promise<string[]> {
  return loadData<string[]>('webgl-gpu-capabilities.json');
}

/**
 * Load the list of known WebGL capability parameter values.
 * Used for validating WebGL context parameter ranges.
 *
 * @returns An array of numeric WebGL capability values.
 */
export async function loadWebglCapabilities(): Promise<number[]> {
  return loadData<number[]>('webgl-capabilities.json');
}

// ============================================================================
// Clear Cache (for testing)
// ============================================================================

/**
 * Clear all cached data and pending requests.
 * Primarily intended for use in tests to reset loader state.
 */
export function clearDataCache(): void {
  dataCache.clear();
  pendingRequests.clear();
}
