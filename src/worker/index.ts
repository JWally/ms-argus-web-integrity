import { captureError } from '../errors';
import { createLieDetector, documentLie } from '../lies';
import {
  createTimer,
  queueEvent,
  getOS,
  getUserAgentPlatform,
  decryptUserAgent,
  JS_ENGINE,
  logTestResult,
  IS_WORKER_SCOPE,
  IS_BLINK,
  getReportedPlatform,
} from '../utils/helpers';

/** Timeout for worker operations in milliseconds */
const WORKER_TIMEOUT_MS = 1000;

/**
 * Inline worker script as a string for Blob URL creation.
 * This avoids the need for an external worker file (404 errors).
 * The script collects fingerprint data and posts it back to the main thread.
 */
const INLINE_WORKER_SCRIPT = `
const getUserAgentData = async (nav) => {
  if (!('userAgentData' in nav)) return;
  try {
    const data = await nav.userAgentData.getHighEntropyValues([
      'platform', 'platformVersion', 'architecture', 'bitness', 'model', 'uaFullVersion'
    ]);
    const { brands, mobile } = nav.userAgentData || {};
    const compressBrands = (b, v = false) => b.filter(o => !/Not/.test(o.brand)).map(o => o.brand + (v ? ' ' + o.version : ''));
    const removeChromium = (b) => b.length > 1 ? b.filter(x => !/Chromium/.test(x)) : b;
    if (!data.brands) data.brands = brands;
    data.brandsVersion = removeChromium(compressBrands(data.brands, true));
    data.brands = removeChromium(compressBrands(data.brands));
    if (!data.mobile) data.mobile = mobile;
    return Object.keys(data).sort().reduce((a, k) => (a[k] = data[k], a), {});
  } catch { return; }
};

const getWebglData = () => {
  try {
    // Two separate canvases required — a canvas can only have one context type
    const gl = new OffscreenCanvas(1, 1).getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    // WebGL2: Chrome 69+, Firefox 105+, Safari 17+ (Safari 16.4 returns null — handled)
    const gl2 = new OffscreenCanvas(1, 1).getContext('webgl2');
    const ext2 = gl2 && gl2.getExtension('WEBGL_debug_renderer_info');
    return {
      webglVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined,
      webglRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined,
      webgl2Vendor: ext2 ? gl2.getParameter(ext2.UNMASKED_VENDOR_WEBGL) : undefined,
      webgl2Renderer: ext2 ? gl2.getParameter(ext2.UNMASKED_RENDERER_WEBGL) : undefined,
    };
  } catch { return {}; }
};

const getLocale = () => {
  const ctors = ['Collator','DateTimeFormat','DisplayNames','ListFormat','NumberFormat','PluralRules','RelativeTimeFormat'];
  const locales = ctors.reduce((acc, name) => {
    try {
      const obj = new Intl[name]();
      if (obj) acc.push(obj.resolvedOptions().locale);
    } catch {}
    return acc;
  }, []);
  return [...new Set(locales)];
};

const computeTimezoneOffset = () => {
  const d = new Date();
  const date = d.getDate(), month = d.getMonth(), year = d.getFullYear();
  const fmt = n => String(n).padStart(2, '0');
  const dateStr = (month + 1) + '/' + fmt(date) + '/' + year;
  const utcStr = year + '-' + fmt(month + 1) + '-' + fmt(date);
  return Math.round((Date.parse(new Date(dateStr)) - new Date(utcStr).getTime()) / 60000);
};

const getWorkerData = async () => {
  const userAgentData = await getUserAgentData(navigator);
  const { webglVendor, webglRenderer, webgl2Vendor, webgl2Renderer } = getWebglData();
  const timezoneOffset = computeTimezoneOffset();
  const timezoneLocation = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = getLocale();
  const { hardwareConcurrency, language, languages, platform, userAgent, deviceMemory } = navigator;

  const lang = String(language).split(',')[0];
  let systemCurrencyLocale;
  try {
    systemCurrencyLocale = (1).toLocaleString(lang || undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'name', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  } catch {}
  const engineCurrencyLocale = (1).toLocaleString(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'name', minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return {
    lied: false,
    lies: {},
    locale: String(locale),
    systemCurrencyLocale,
    engineCurrencyLocale,
    localeEntropyIsTrusty: engineCurrencyLocale === systemCurrencyLocale,
    localeIntlEntropyIsTrusty: new Set(String(language).split(',')).has(String(locale)),
    timezoneOffset,
    timezoneLocation,
    deviceMemory,
    hardwareConcurrency,
    language,
    languages: String(languages),
    platform,
    userAgent,
    webglRenderer,
    webglVendor,
    webgl2Renderer,
    webgl2Vendor,
    userAgentData
  };
};

// Handle different worker types
if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('message', async (e) => {
    const data = await getWorkerData();
    e.source.postMessage(data);
  });
} else if (typeof SharedWorkerGlobalScope !== 'undefined' && self instanceof SharedWorkerGlobalScope) {
  self.addEventListener('connect', async (e) => {
    const port = e.ports[0];
    const data = await getWorkerData();
    port.postMessage(data);
  });
} else {
  // DedicatedWorker
  getWorkerData().then(data => self.postMessage(data));
}
`;

/**
 * Creates a Blob URL from the inline worker script.
 * SharedWorker and DedicatedWorker support Blob URLs.
 * ServiceWorker does NOT support Blob URLs (requires file URL on same origin).
 */
function createWorkerBlobUrl(): string {
  const blob = new Blob([INLINE_WORKER_SCRIPT], {
    type: 'application/javascript',
  });
  return URL.createObjectURL(blob);
}

/**
 * Worker Scope Fingerprinting Module
 *
 * Collects fingerprint data from Web Workers, providing several key benefits
 * for fraud detection:
 *
 * 1. **Isolated Context**: Workers run in a separate global scope from the
 *    main window. This isolation means fingerprint protection extensions
 *    that modify the window object often fail to intercept worker APIs.
 *
 * 2. **Cross-Context Validation**: Comparing values between worker scope
 *    and window scope (platform, userAgent, hardwareConcurrency) detects
 *    inconsistent spoofing - a common sign of fingerprint manipulation.
 *
 * 3. **Parallel Worker Execution**: All three worker types (ServiceWorker,
 *    SharedWorker, DedicatedWorker) are spawned in parallel for faster
 *    collection and cross-worker comparison.
 *
 * 4. **Engine Detection**: The actual JS engine (V8/SpiderMonkey/JavaScriptCore)
 *    can be detected via runtime behavior. If this doesn't match the user
 *    agent's claimed browser, it's a strong spoof signal.
 *
 * ## Security Model
 *
 * Worker fingerprinting exploits a fundamental limitation: to spoof workers
 * effectively, an attacker must inject code that runs before our worker
 * spawns AND intercepts all the same APIs. Most browser extensions can't
 * do this reliably, making workers a robust fingerprinting vector.
 *
 * ## Collected Data
 *
 * - Navigator properties (userAgent, platform, deviceMemory, concurrency)
 * - UserAgentData high-entropy values (Chrome/Edge only)
 * - WebGL renderer and vendor (GPU identification)
 * - Timezone and locale information
 * - Prototype lie detection on WorkerNavigator
 *
 * @module worker
 */

/**
 * Worker type identifiers for parallel execution.
 * - main: Window/document context
 * - web: Dedicated Web Worker
 * - shared: SharedWorker
 * - service: ServiceWorker
 */
export type WorkerType = 'main' | 'web' | 'dedicated' | 'shared' | 'service';

/**
 * Result from a single worker type.
 */
export interface WorkerResult {
  type: WorkerType;
  name: string;
  data: WorkerScopeData | null;
  error?: string;
  durationMs: number;
}

/**
 * Comparison result between worker types.
 */
export interface WorkerComparison {
  /** All workers agree on this field */
  consistent: boolean;
  /** Fields that differ between workers */
  differences: WorkerDifference[];
  /** Which worker types succeeded */
  succeeded: WorkerType[];
  /** Which worker types failed */
  failed: WorkerType[];
}

/**
 * A single difference between worker results.
 */
export interface WorkerDifference {
  field: string;
  values: Partial<Record<WorkerType, unknown>>;
}

/**
 * Raw data collected from a worker scope.
 */
export interface WorkerScopeData {
  lied: boolean;
  lies: {
    proto?: Record<string, string[]>;
    os?: string;
    engine?: string;
    version?: string;
    platformVersion?: string;
  };
  locale: string;
  systemCurrencyLocale?: string;
  engineCurrencyLocale: string;
  localeEntropyIsTrusty: boolean;
  localeIntlEntropyIsTrusty: boolean;
  timezoneOffset: number;
  timezoneLocation: string;
  deviceMemory?: number;
  hardwareConcurrency: number;
  language: string;
  languages: string;
  platform: string;
  userAgent: string;
  webglRenderer?: string;
  webglVendor?: string;
  webgl2Renderer?: string;
  webgl2Vendor?: string;
  userAgentData?: Record<string, unknown>;
  system?: string;
  device?: string;
  userAgentVersion?: string;
  userAgentDataVersion?: string;
  userAgentEngine?: string;
  scopes?: Record<string, unknown>;
}

/**
 * Parallel worker execution results.
 */
export interface ParallelWorkerResults {
  /** Results from all worker types */
  workers: WorkerResult[];
  /** The best (first successful) worker result */
  best: WorkerResult | null;
  /** Cross-worker comparison */
  comparison: WorkerComparison;
  /** Total time to run all workers */
  totalDurationMs: number;
}

/**
 * Execution scope enum for distinguishing worker vs window context.
 */
export const enum Scope {
  WORKER = 0,
  WINDOW,
}

/** The type of worker that successfully spawned ("service", "shared", or "web"). */

/** The global scope name of the spawned worker. */
export let WORKER_TYPE = '';
export let WORKER_NAME = '';

/**
 * Spawns a worker and collects fingerprint data from its isolated context.
 *
 * This function runs INSIDE the worker scope. It collects:
 * - Navigator properties (userAgent, platform, deviceMemory, etc.)
 * - UserAgentData high-entropy values (if available)
 * - WebGL renderer info for GPU fingerprinting
 * - Timezone and locale information
 * - Prototype lie detection on WorkerNavigator APIs
 *
 * The collected data is posted back to the main thread via postMessage.
 *
 * @returns Worker scope data or undefined if in window context
 */
export async function spawnWorker() {
  /** Safely executes a function, returning undefined on error. */
  const ask = (fn: () => any) => {
    try {
      return fn();
    } catch (e) {
      return;
    }
  };

  /** Detects prototype lies on WorkerNavigator properties. */
  function getWorkerPrototypeLies(scope: Window & typeof globalThis) {
    const lieDetector = createLieDetector(scope);
    const { searchLies } = lieDetector;

    searchLies(() => Function, {
      target: ['toString'],
      ignore: ['caller', 'arguments'],
    });
    // @ts-expect-error
    searchLies(() => WorkerNavigator, {
      target: [
        'deviceMemory',
        'hardwareConcurrency',
        'language',
        'languages',
        'platform',
        'userAgent',
      ],
    });
    // return lies list and detail
    const props = lieDetector.getProps();
    const propsSearched = lieDetector.getPropsSearched();
    return {
      lieDetector,
      lieList: Object.keys(props).sort(),
      lieDetail: props,
      lieCount: Object.keys(props).reduce(
        (acc, key) => acc + props[key].length,
        0,
      ),
      propsSearched,
    };
  }

  /**
   * Fetches high-entropy user agent data from NavigatorUAData API.
   * Returns sorted key-value object with brand and version info.
   */
  const getUserAgentData = async (navigator: any) => {
    if (!('userAgentData' in navigator)) {
      return;
    }
    const data = await navigator.userAgentData.getHighEntropyValues([
      'platform',
      'platformVersion',
      'architecture',
      'bitness',
      'model',
      'uaFullVersion',
    ]);
    const { brands, mobile } = navigator.userAgentData || {};
    /** Filters out "Not" brands and formats as name strings, optionally with version. */
    const compressedBrands = (brands: any[], captureVersion = false) =>
      brands
        .filter((obj: any) => !/Not/.test(obj.brand))
        .map(
          (obj: any) =>
            `${obj.brand}${captureVersion ? ` ${obj.version}` : ''}`,
        );
    /** Removes Chromium entries from brand list when multiple brands exist. */
    const removeChromium = (brands: any[]) =>
      brands.length > 1
        ? brands.filter((brand: any) => !/Chromium/.test(brand))
        : brands;

    // compress brands
    if (!data.brands) {
      data.brands = brands;
    }
    data.brandsVersion = compressedBrands(data.brands, true);
    data.brands = compressedBrands(data.brands);
    data.brandsVersion = removeChromium(data.brandsVersion);
    data.brands = removeChromium(data.brands);

    if (!data.mobile) {
      data.mobile = mobile;
    }
    const dataSorted = Object.keys(data)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = (data as any)[key];
        return acc;
      }, {});
    return dataSorted;
  };

  /**
   * Gets WebGL1 and WebGL2 vendor/renderer strings via OffscreenCanvas.
   * Two separate canvases required — a canvas can only have one context type.
   * WebGL2: Chrome 69+, Firefox 105+, Safari 17+ (Safari 16.4 returns null — handled).
   */
  const getWebglData = () =>
    ask(() => {
      // @ts-ignore
      const gl = new OffscreenCanvas(1, 1).getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      // @ts-ignore
      const gl2 = new OffscreenCanvas(1, 1).getContext('webgl2');
      const ext2 = gl2 && gl2.getExtension('WEBGL_debug_renderer_info');
      return {
        webglVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined,
        webglRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined,
        webgl2Vendor: ext2 ? gl2.getParameter(ext2.UNMASKED_VENDOR_WEBGL) : undefined,
        webgl2Renderer: ext2 ? gl2.getParameter(ext2.UNMASKED_RENDERER_WEBGL) : undefined,
      };
    });

  /**
   * Calculates timezone offset in minutes by comparing local and UTC date parsing.
   */
  const computeTimezoneOffset = () => {
    const date = new Date().getDate();
    const month = new Date().getMonth();
    // @ts-ignore
    const year = Date().split` `[3]; // current year
    /** Zero-pads single digit numbers to two characters. */
    const format = (n: any) => (('' + n).length == 1 ? `0${n}` : n);
    const dateString = `${month + 1}/${format(date)}/${year}`;
    const dateStringUTC = `${year}-${format(month + 1)}-${format(date)}`;
    // @ts-ignore
    const utc = Date.parse(new Date(dateString));
    const now = +new Date(dateStringUTC);
    return +((utc - now) / 60000).toFixed(0);
  };

  /**
   * Detects locale by querying resolved options from multiple Intl constructors.
   * Returns deduplicated list of locale strings.
   */
  const getLocale = () => {
    const constructors = [
      'Collator',
      'DateTimeFormat',
      'DisplayNames',
      'ListFormat',
      'NumberFormat',
      'PluralRules',
      'RelativeTimeFormat',
    ];
    const locale = constructors.reduce((acc: string[], name) => {
      try {
        const obj = new (Intl as any)[name]();
        if (!obj) {
          return acc;
        }
        const { locale } = obj.resolvedOptions() || {};
        return [...acc, locale];
      } catch (error) {
        return acc;
      }
    }, [] as string[]);

    return [...new Set(locale)];
  };

  /**
   * Main data collection function for the worker scope.
   * Gathers navigator, WebGL, timezone, locale, and prototype lie data.
   */
  const getWorkerData = async () => {
    const timer = createTimer();
    await queueEvent(timer);

    const userAgentData = await getUserAgentData(navigator).catch((error) =>
      console.error(error),
    );

    // webgl
    const { webglVendor, webglRenderer, webgl2Vendor, webgl2Renderer } = getWebglData() || {};

    // timezone & locale
    const timezoneOffset = computeTimezoneOffset();

    const timezoneLocation = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const locale = getLocale();

    // navigator
    const {
      hardwareConcurrency,
      language,
      languages,
      platform,
      userAgent,
      // @ts-expect-error
      deviceMemory,
    } = navigator || {};

    // prototype lies
    await queueEvent(timer);
    const {
      // lieDetector: lieProps,
      lieList,
      lieDetail,
      // lieCount,
      // propsSearched,
    } = getWorkerPrototypeLies(self); // execute and destructure the list and detail
    // const prototypeLies = JSON.parse(JSON.stringify(lieDetail))
    const protoLieLen = lieList.length;

    // match engine locale to system locale to determine if locale entropy is trusty
    let systemCurrencyLocale;
    const lang = ('' + language).split(',')[0];
    try {
      systemCurrencyLocale = (1).toLocaleString(lang || undefined, {
        style: 'currency',
        currency: 'USD',
        currencyDisplay: 'name',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    } catch (e) {}
    const engineCurrencyLocale = (1).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'name',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const localeEntropyIsTrusty = engineCurrencyLocale == systemCurrencyLocale;
    const localeIntlEntropyIsTrusty = new Set(('' + language).split(',')).has(
      '' + locale,
    );

    const { href, pathname } = self.location || {};
    const locationPathNameLie =
      !href ||
      !pathname ||
      !/^\/(docs|argus|public)|\/argus.js$/.test(pathname) ||
      !new RegExp(`${pathname}$`).test(href);

    return {
      lied: protoLieLen || +locationPathNameLie,
      lies: {
        proto: protoLieLen ? lieDetail : false,
      },
      locale: '' + locale,
      systemCurrencyLocale,
      engineCurrencyLocale,
      localeEntropyIsTrusty,
      localeIntlEntropyIsTrusty,
      timezoneOffset,
      timezoneLocation,
      deviceMemory,
      hardwareConcurrency,
      language,
      languages: '' + languages,
      platform,
      userAgent,
      webglRenderer,
      webglVendor,
      webgl2Renderer,
      webgl2Vendor,
      userAgentData,
    };
  };

  // Compute and communicate from worker scope
  /** Adds an event listener to the worker global scope. */
  const onEvent = (eventType: string, fn: (e: any) => any) =>
    addEventListener(eventType, fn);
  /** Collects worker data and sends it via postMessage to the given source. */
  const send = (source: any) => {
    return getWorkerData().then((data) => source.postMessage(data));
  };
  const gs = globalThis as any;
  if (IS_WORKER_SCOPE) {
    gs.ServiceWorkerGlobalScope
      ? onEvent('message', (e) => send(e.source))
      : gs.SharedWorkerGlobalScope
        ? onEvent('connect', (e) => send(e.ports[0]))
        : send(self); // DedicatedWorkerGlobalScope
  }

  return IS_WORKER_SCOPE ? Scope.WORKER : Scope.WINDOW;
}

/**
 * Collects worker scope fingerprint using parallel worker execution.
 *
 * Runs all worker types in parallel using inline Blob URLs:
 * 1. **SharedWorker** - Cross-tab sharing, uses Blob URL
 * 2. **DedicatedWorker** - Most compatible, uses Blob URL
 *
 * Note: ServiceWorker is skipped as it cannot use Blob URLs and requires
 * an external script file.
 *
 * After collecting worker data, performs cross-context validation:
 * - Compares platform, userAgent, hardwareConcurrency with window.navigator
 * - Validates OS in platform matches OS in userAgent
 * - Checks JS engine matches claimed browser
 * - Validates userAgentData version matches userAgent version
 * - Checks Windows platform version consistency
 *
 * @returns Worker scope fingerprint with lies detected, or empty object if all workers fail
 */
export default async function getBestWorkerScope() {
  try {
    const timer = createTimer();
    await queueEvent(timer);

    /** Safely executes a function, returning undefined on error. */
    const ask = <T>(fn: () => T): T | undefined => {
      try {
        return fn();
      } catch {
        return undefined;
      }
    };

    /** Checks if an object's prototype constructor matches the given name. */
    const hasConstructor = (x: unknown, name: string): boolean =>
      x != null &&
      (x as { __proto__: { constructor: { name: string } } }).__proto__
        .constructor.name === name;

    // Create Blob URL for inline worker script
    const blobUrl = createWorkerBlobUrl();

    /**
     * Spawns a DedicatedWorker via Blob URL and resolves with its fingerprint data.
     */
    const getDedicatedWorker = (): Promise<WorkerScopeData | null> =>
      new Promise((resolve) => {
        const giveUpOnWorker = setTimeout(
          () => resolve(null),
          WORKER_TIMEOUT_MS,
        );

        const webWorker = ask(() => new Worker(blobUrl));
        if (!hasConstructor(webWorker, 'Worker')) {
          clearTimeout(giveUpOnWorker);
          return resolve(null);
        }

        /** Resolves with worker data on successful message. */
        webWorker!.onmessage = (event) => {
          webWorker!.terminate();
          clearTimeout(giveUpOnWorker);
          resolve(event.data);
        };

        /** Resolves null on worker error. */
        webWorker!.onerror = () => {
          webWorker!.terminate();
          clearTimeout(giveUpOnWorker);
          resolve(null);
        };
      });

    /**
     * Spawns a SharedWorker via Blob URL and resolves with its fingerprint data.
     */
    const getSharedWorker = (): Promise<WorkerScopeData | null> =>
      new Promise((resolve) => {
        const giveUpOnWorker = setTimeout(
          () => resolve(null),
          WORKER_TIMEOUT_MS,
        );

        const sharedWorker = ask(() => new SharedWorker(blobUrl));
        if (!hasConstructor(sharedWorker, 'SharedWorker')) {
          clearTimeout(giveUpOnWorker);
          return resolve(null);
        }

        sharedWorker!.port.start();

        /** Resolves with shared worker data on port message. */
        sharedWorker!.port.onmessage = (event) => {
          sharedWorker!.port.close();
          clearTimeout(giveUpOnWorker);
          resolve(event.data);
        };

        /** Resolves null on shared worker error. */
        sharedWorker!.onerror = () => {
          sharedWorker!.port.close();
          clearTimeout(giveUpOnWorker);
          resolve(null);
        };
      });

    // Collect main window scope data — mirrors what the inline worker script collects
    const mainLang = String(navigator.language).split(',')[0];
    let mainSystemCurrencyLocale: string | undefined;
    try {
      mainSystemCurrencyLocale = (1).toLocaleString(mainLang || undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'name', minimumFractionDigits: 0, maximumFractionDigits: 0 });
    } catch {}
    const mainEngineCurrencyLocale = (1).toLocaleString(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'name', minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const mainTimezoneLocation = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const mainTimezoneOffset = (() => {
      const d = new Date();
      const date = d.getDate(), month = d.getMonth(), year = d.getFullYear();
      const fmt = (n: number) => String(n).padStart(2, '0');
      const dateStr = (month + 1) + '/' + fmt(date) + '/' + year;
      const utcStr = year + '-' + fmt(month + 1) + '-' + fmt(date);
      return Math.round((Date.parse(new Date(dateStr).toString()) - new Date(utcStr).getTime()) / 60000);
    })();
    const mainLocale = (() => {
      const ctors = ['Collator', 'DateTimeFormat', 'DisplayNames', 'ListFormat', 'NumberFormat', 'PluralRules', 'RelativeTimeFormat'] as const;
      const locales = ctors.reduce<string[]>((acc, name) => {
        try {
          const obj = new (Intl as any)[name]();
          if (obj) acc.push(obj.resolvedOptions().locale);
        } catch {}
        return acc;
      }, []);
      return String([...new Set(locales)]);
    })();
    const mainWebgl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null;
        const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
        // Two separate canvases — a canvas can only have one context type
        const gl2 = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
        const ext2 = gl2 && gl2.getExtension('WEBGL_debug_renderer_info');
        return {
          webglRenderer: ext ? gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined,
          webglVendor: ext ? gl!.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined,
          webgl2Renderer: ext2 ? gl2!.getParameter(ext2.UNMASKED_RENDERER_WEBGL) : undefined,
          webgl2Vendor: ext2 ? gl2!.getParameter(ext2.UNMASKED_VENDOR_WEBGL) : undefined,
        };
      } catch { return {}; }
    })();
    const mainUA = navigator.userAgent;
    const mainSystem = getOS(mainUA);
    const mainDecrypted = decryptUserAgent({ ua: mainUA, os: mainSystem, isBrave: false });
    const getMainVersion = (x: string) => (/\d+/.exec(x) || [])[0];
    // @ts-ignore
    const mainUserAgentData = navigator.userAgentData;
    const mainScope = {
      hardwareConcurrency: navigator.hardwareConcurrency,
      // @ts-ignore
      deviceMemory: navigator.deviceMemory,
      language: navigator.language,
      languages: String(navigator.languages),
      platform: navigator.platform,
      userAgent: mainUA,
      locale: mainLocale,
      systemCurrencyLocale: mainSystemCurrencyLocale,
      engineCurrencyLocale: mainEngineCurrencyLocale,
      localeEntropyIsTrusty: mainEngineCurrencyLocale === mainSystemCurrencyLocale,
      localeIntlEntropyIsTrusty: new Set(String(navigator.language).split(',')).has(mainLocale),
      timezoneOffset: mainTimezoneOffset,
      timezoneLocation: mainTimezoneLocation,
      ...mainWebgl,
      system: mainSystem,
      device: getUserAgentPlatform({ userAgent: mainUA }),
      userAgentVersion: getMainVersion(mainDecrypted),
      userAgentEngine: /safari/i.test(mainDecrypted) || /iphone|ipad/i.test(mainUA) ? 'JavaScriptCore'
        : /firefox/i.test(mainUA) ? 'SpiderMonkey'
        : /chrome/i.test(mainUA) ? 'V8'
        : undefined,
      ...(mainUserAgentData ? { userAgentData: mainUserAgentData } : {}),
    };

    // Run SharedWorker and DedicatedWorker in parallel
    // ServiceWorker cannot use Blob URLs - report as unavailable
    const [sharedResult, webResult] = await Promise.all([
      getSharedWorker().catch(() => null),
      getDedicatedWorker().catch(() => null),
    ]);

    // Clean up Blob URL
    URL.revokeObjectURL(blobUrl);

    // Check if ServiceWorker is supported (even though we can't use Blob URLs)
    const serviceWorkerSupported = 'serviceWorker' in navigator;

    // Store all scopes for the return payload
    // Each scope shows collected data or null if unavailable
    const allScopes = {
      main: mainScope,
      web: webResult,
      shared: sharedResult,
      service: serviceWorkerSupported ? 'unavailable' : null, // Can't use Blob URLs
    };

    // Use first successful result, preferring SharedWorker
    let workerScope: WorkerScopeData | null = null;
    if (sharedResult?.userAgent) {
      workerScope = sharedResult;
      WORKER_NAME = 'SharedWorkerGlobalScope';
      WORKER_TYPE = 'shared';
    } else if (webResult?.userAgent) {
      workerScope = webResult;
      WORKER_NAME = 'DedicatedWorkerGlobalScope';
      WORKER_TYPE = 'web';
    }

    // Return empty object if all workers failed (graceful degradation)
    if (!workerScope?.userAgent) {
      logTestResult({ test: 'worker', passed: false });
      return {
        lied: false,
        lies: {},
        localeEntropyIsTrusty: false,
        localeIntlEntropyIsTrusty: false,
        best: '' as 'shared' | 'web' | '',
        scopes: allScopes,
      };
    }
    workerScope.system = getOS(workerScope.userAgent);
    workerScope.device = getUserAgentPlatform({
      userAgent: workerScope.userAgent,
    });

    // detect lies
    const {
      system,
      userAgent,
      userAgentData,
      platform,
      deviceMemory,
      hardwareConcurrency,
    } = workerScope || {};

    // navigator lies
    // skip language and languages to respect valid engine language switching bug in Chrome
    // these are more likely navigator lies, so don't trigger lied worker scope
    const workerScopeMatchLie = 'does not match worker scope';
    if (platform != navigator.platform) {
      documentLie('Navigator.platform', workerScopeMatchLie);
    }
    if (userAgent != navigator.userAgent) {
      documentLie('Navigator.userAgent', workerScopeMatchLie);
    }
    if (
      hardwareConcurrency &&
      hardwareConcurrency != navigator.hardwareConcurrency
    ) {
      documentLie('Navigator.hardwareConcurrency', workerScopeMatchLie);
    }
    // @ts-ignore
    if (deviceMemory && deviceMemory != navigator.deviceMemory) {
      documentLie('Navigator.deviceMemory', workerScopeMatchLie);
    }

    // prototype lies
    if (workerScope.lies.proto) {
      const { proto } = workerScope.lies;
      const keys = Object.keys(proto);
      keys.forEach((key) => {
        const api = `WorkerGlobalScope.${key}`;
        const lies = proto[key];
        lies.forEach((lie) => documentLie(api, lie));
      });
    }

    // user agent os lie
    const [userAgentOS, platformOS] = getReportedPlatform(userAgent, platform);
    if (userAgentOS != platformOS) {
      workerScope.lied = true;
      workerScope.lies.os = `${platformOS} platform and ${userAgentOS} user agent do not match`;
      documentLie('WorkerGlobalScope', workerScope.lies.os);
    }

    // user agent engine lie
    const decryptedName = decryptUserAgent({
      ua: userAgent ?? '',
      os: system ?? '',
      isBrave: false, // default false since we are only looking for JS runtime and version
    });
    const userAgentEngine =
      /safari/i.test(decryptedName) || /iphone|ipad/i.test(userAgent)
        ? 'JavaScriptCore'
        : /firefox/i.test(userAgent)
          ? 'SpiderMonkey'
          : /chrome/i.test(userAgent)
            ? 'V8'
            : undefined;
    if (userAgentEngine != JS_ENGINE) {
      workerScope.lied = true;
      workerScope.lies.engine = `${JS_ENGINE} JS runtime and ${userAgentEngine} user agent do not match`;
      documentLie('WorkerGlobalScope', workerScope.lies.engine);
    }
    // user agent version lie
    /** Extracts the leading version number from a string. */
    const getVersion = (x: string) => (/\d+/.exec(x) || [])[0];
    const userAgentVersion = getVersion(decryptedName);
    const userAgentDataVersion = getVersion(
      userAgentData ? (userAgentData.uaFullVersion as string) || '' : '',
    );
    const versionSupported = userAgentDataVersion && userAgentVersion;
    const versionMatch = userAgentDataVersion == userAgentVersion;
    if (versionSupported && !versionMatch) {
      workerScope.lied = true;
      workerScope.lies.version = `userAgentData version ${userAgentDataVersion} and user agent version ${userAgentVersion} do not match`;
      documentLie('WorkerGlobalScope', workerScope.lies.version);
    }

    // platformVersion lie
    const FEATURE_CASE = IS_BLINK && CSS.supports('accent-color: initial');
    /**
     * Checks for Windows/macOS platform version inconsistency between
     * userAgentData.platformVersion and the reported device string.
     */
    const getPlatformVersionLie = (device: any, userAgentData: any) => {
      if (!/windows|mac/i.test(device) || !userAgentData?.platformVersion) {
        return false;
      }

      if (userAgentData.platform == 'macOS') {
        return FEATURE_CASE ? /_/.test(userAgentData.platformVersion) : false;
      }

      const reportedVersionNumber = (/windows ([\d|\.]+)/i.exec(device) ||
        [])[1];
      const windows10OrHigherReport = +reportedVersionNumber == 10;
      const { platformVersion } = userAgentData;
      const versionMap: Record<string, string> = {
        '6.1': '7',
        '6.2': '8',
        '6.3': '8.1',
        '10.0': '10',
      };
      const version = versionMap[platformVersion];
      if (!FEATURE_CASE && version) {
        return version != reportedVersionNumber;
      }

      const parts = platformVersion.split('.');
      if (parts.length != 3) return true;

      const windows10OrHigherPlatform = +parts[0] > 0;
      return (
        (windows10OrHigherPlatform && !windows10OrHigherReport) ||
        (!windows10OrHigherPlatform && windows10OrHigherReport)
      );
    };
    const windowsVersionLie = getPlatformVersionLie(
      workerScope.device,
      userAgentData,
    );
    if (windowsVersionLie) {
      workerScope.lied = true;
      workerScope.lies.platformVersion = `platform version is fake`;
      documentLie('WorkerGlobalScope', workerScope.lies.platformVersion);
    }

    // capture userAgent version
    workerScope.userAgentVersion = userAgentVersion;
    workerScope.userAgentDataVersion = userAgentDataVersion;
    workerScope.userAgentEngine = userAgentEngine;

    // Apply the same derived fields to the non-chosen worker scope so all
    // scopes are consistent. workerScope is a reference to the chosen result
    // (sharedResult or webResult), so compute for the other one if present.
    const otherScope = workerScope === sharedResult ? webResult : sharedResult;
    if (otherScope?.userAgent) {
      const otherSystem = getOS(otherScope.userAgent);
      otherScope.system = otherSystem;
      otherScope.device = getUserAgentPlatform({ userAgent: otherScope.userAgent });
      const otherDecrypted = decryptUserAgent({ ua: otherScope.userAgent, os: otherSystem, isBrave: false });
      const getVersion = (x: string) => (/\d+/.exec(x) || [])[0];
      otherScope.userAgentVersion = getVersion(otherDecrypted);
      otherScope.userAgentDataVersion = getVersion(
        otherScope.userAgentData ? (otherScope.userAgentData.uaFullVersion as string) || '' : '',
      );
      otherScope.userAgentEngine =
        /safari/i.test(otherDecrypted) || /iphone|ipad/i.test(otherScope.userAgent) ? 'JavaScriptCore'
        : /firefox/i.test(otherScope.userAgent) ? 'SpiderMonkey'
        : /chrome/i.test(otherScope.userAgent) ? 'V8'
        : undefined;
    }

    // Cross-scope consistency: compare web vs shared for new fields.
    // A spoofer that patches one worker type but not the other is caught here.
    if (sharedResult?.userAgent && webResult?.userAgent) {
      const crossFields: Array<keyof WorkerScopeData> = [
        'webgl2Renderer',
        'webgl2Vendor',
        'systemCurrencyLocale',
        'engineCurrencyLocale',
      ];
      for (const f of crossFields) {
        const a = sharedResult[f];
        const b = webResult[f];
        if (a !== undefined && b !== undefined && a !== b) {
          workerScope.lied = true;
          documentLie('WorkerGlobalScope', `${f} differs between shared and web worker`);
        }
      }
      // userAgentData is an object — compare via JSON
      if (sharedResult.userAgentData && webResult.userAgentData) {
        if (JSON.stringify(sharedResult.userAgentData) !== JSON.stringify(webResult.userAgentData)) {
          workerScope.lied = true;
          documentLie('WorkerGlobalScope', 'userAgentData differs between shared and web worker');
        }
      }
    }

    logTestResult({
      time: timer.stop(),
      test: `${WORKER_TYPE} worker`,
      passed: true,
    });
    return {
      lied: workerScope.lied,
      lies: workerScope.lies,
      localeEntropyIsTrusty: workerScope.localeEntropyIsTrusty,
      localeIntlEntropyIsTrusty: workerScope.localeIntlEntropyIsTrusty,
      best: WORKER_TYPE as 'shared' | 'web' | '',
      scopes: allScopes,
    };
  } catch (error) {
    logTestResult({ test: 'worker', passed: false });
    captureError(error as Error, 'workers failed or blocked by client');
    // Return empty data gracefully instead of undefined
    return {
      lied: false,
      lies: {},
      localeEntropyIsTrusty: false,
      localeIntlEntropyIsTrusty: false,
      best: '' as 'shared' | 'web' | '',
      scopes: {
        main: null,
        web: null,
        shared: null,
        service: null,
      },
    };
  }
}

/**
 * Fields to compare between worker results for consistency checking.
 */
const COMPARISON_FIELDS = [
  'platform',
  'userAgent',
  'hardwareConcurrency',
  'deviceMemory',
  'language',
  'languages',
  'timezoneOffset',
  'timezoneLocation',
  'locale',
  'systemCurrencyLocale',
  'engineCurrencyLocale',
  'webglRenderer',
  'webglVendor',
  'webgl2Renderer',
  'webgl2Vendor',
  'userAgentData',
] as const;

/**
 * Compares results from multiple worker types to detect inconsistencies.
 *
 * Inconsistencies between worker types are a strong signal of fingerprint
 * manipulation, as they indicate different spoofing was applied to different
 * worker contexts.
 *
 * @param results - Array of worker results to compare
 * @returns Comparison result with differences and consistency status
 */
function compareWorkerResults(results: WorkerResult[]): WorkerComparison {
  const succeeded = results.filter((r) => r.data !== null).map((r) => r.type);
  const failed = results.filter((r) => r.data === null).map((r) => r.type);

  // Need at least 2 successful workers to compare
  if (succeeded.length < 2) {
    return {
      consistent: true,
      differences: [],
      succeeded,
      failed,
    };
  }

  const differences: WorkerDifference[] = [];
  const successfulResults = results.filter((r) => r.data !== null);

  /** Serializes objects to JSON for stable equality comparison. Primitives pass through. */
  const serialize = (v: unknown): unknown =>
    v !== null && typeof v === 'object' ? JSON.stringify(v) : v;

  for (const field of COMPARISON_FIELDS) {
    const values: Record<WorkerType, unknown> = {} as Record<
      WorkerType,
      unknown
    >;
    let hasValue = false;
    let firstValue: unknown = undefined;
    let hasDifference = false;

    for (const result of successfulResults) {
      const raw = result.data?.[field as keyof WorkerScopeData];
      values[result.type] = raw;

      if (raw !== undefined) {
        const value = serialize(raw);
        if (!hasValue) {
          firstValue = value;
          hasValue = true;
        } else if (value !== firstValue) {
          hasDifference = true;
        }
      }
    }

    if (hasDifference) {
      differences.push({ field, values });
    }
  }

  return {
    consistent: differences.length === 0,
    differences,
    succeeded,
    failed,
  };
}

/**
 * Spawns all three worker types in parallel and compares their results.
 *
 * This function provides several advantages over the sequential fallback approach:
 *
 * 1. **Speed**: All workers start simultaneously, reducing total wait time
 * 2. **Complete data**: Get results from all available worker types
 * 3. **Cross-validation**: Compare results to detect inconsistent spoofing
 * 4. **Resilience**: Even if one worker fails, others may succeed
 *
 * ## Bot Detection Signal
 *
 * If results differ between worker types, it's a strong indicator of:
 * - Partial fingerprint protection (only some contexts are spoofed)
 * - Extension-based spoofing that can't reach all worker types
 * - Inconsistent browser automation setup
 *
 * @param scriptSource - Path to the worker script (default: './creep.js')
 * @returns Parallel execution results with comparison data
 *
 * @example
 * ```typescript
 * const results = await getAllWorkerScopes();
 *
 * // Check if all workers agree
 * if (!results.comparison.consistent) {
 *   console.warn('Worker inconsistency detected:', results.comparison.differences);
 * }
 *
 * // Get data from fastest successful worker
 * const bestData = results.best?.data;
 * ```
 */
export async function getAllWorkerScopes(
  scriptSource = './creep.js',
): Promise<ParallelWorkerResults> {
  const startTime = performance.now();

  /** Safely executes a function, returning undefined on error. */
  const ask = <T>(fn: () => T): T | undefined => {
    try {
      return fn();
    } catch {
      return undefined;
    }
  };

  /** Checks if an object's prototype constructor matches the given name. */
  const hasConstructor = (x: unknown, name: string): boolean =>
    x != null &&
    (x as { __proto__: { constructor: { name: string } } }).__proto__
      .constructor.name === name;

  /**
   * Spawns a DedicatedWorker and collects its fingerprint data.
   */
  const getDedicatedWorker = (): Promise<WorkerResult> => {
    const workerStart = performance.now();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          type: 'web',
          name: 'DedicatedWorkerGlobalScope',
          data: null,
          error: 'timeout',
          durationMs: performance.now() - workerStart,
        });
      }, WORKER_TIMEOUT_MS);

      const worker = ask(() => new Worker(scriptSource));
      if (!hasConstructor(worker, 'Worker')) {
        clearTimeout(timeout);
        resolve({
          type: 'web',
          name: 'DedicatedWorkerGlobalScope',
          data: null,
          error: 'not supported',
          durationMs: performance.now() - workerStart,
        });
        return;
      }

      /** Resolves with dedicated worker data on successful message. */
      worker!.onmessage = (event: MessageEvent) => {
        worker!.terminate();
        clearTimeout(timeout);
        resolve({
          type: 'web',
          name: 'DedicatedWorkerGlobalScope',
          data: event.data,
          durationMs: performance.now() - workerStart,
        });
      };

      /** Resolves with error result on dedicated worker failure. */
      worker!.onerror = (error: ErrorEvent) => {
        worker!.terminate();
        clearTimeout(timeout);
        resolve({
          type: 'web',
          name: 'DedicatedWorkerGlobalScope',
          data: null,
          error: error.message,
          durationMs: performance.now() - workerStart,
        });
      };
    });
  };

  /**
   * Spawns a SharedWorker and collects its fingerprint data.
   */
  const getSharedWorker = (): Promise<WorkerResult> => {
    const workerStart = performance.now();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          type: 'shared',
          name: 'SharedWorkerGlobalScope',
          data: null,
          error: 'timeout',
          durationMs: performance.now() - workerStart,
        });
      }, WORKER_TIMEOUT_MS);

      const worker = ask(() => new SharedWorker(scriptSource));
      if (!hasConstructor(worker, 'SharedWorker')) {
        clearTimeout(timeout);
        resolve({
          type: 'shared',
          name: 'SharedWorkerGlobalScope',
          data: null,
          error: 'not supported',
          durationMs: performance.now() - workerStart,
        });
        return;
      }

      worker!.port.start();

      /** Resolves with shared worker data on port message. */
      worker!.port.onmessage = (event: MessageEvent) => {
        worker!.port.close();
        clearTimeout(timeout);
        resolve({
          type: 'shared',
          name: 'SharedWorkerGlobalScope',
          data: event.data,
          durationMs: performance.now() - workerStart,
        });
      };

      /** Resolves with error result on shared worker failure. */
      worker!.onerror = (error: ErrorEvent) => {
        worker!.port.close();
        clearTimeout(timeout);
        resolve({
          type: 'shared',
          name: 'SharedWorkerGlobalScope',
          data: null,
          error: error.message,
          durationMs: performance.now() - workerStart,
        });
      };
    });
  };

  /**
   * Registers a ServiceWorker and collects its fingerprint data.
   */
  const getServiceWorker = (): Promise<WorkerResult> => {
    const workerStart = performance.now();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          type: 'service',
          name: 'ServiceWorkerGlobalScope',
          data: null,
          error: 'timeout',
          durationMs: performance.now() - workerStart,
        });
      }, WORKER_TIMEOUT_MS);

      if (!ask(() => navigator.serviceWorker?.register)) {
        clearTimeout(timeout);
        resolve({
          type: 'service',
          name: 'ServiceWorkerGlobalScope',
          data: null,
          error: 'not supported',
          durationMs: performance.now() - workerStart,
        });
        return;
      }

      navigator.serviceWorker
        .register(scriptSource)
        .then((registration) => {
          if (!hasConstructor(registration, 'ServiceWorkerRegistration')) {
            clearTimeout(timeout);
            resolve({
              type: 'service',
              name: 'ServiceWorkerGlobalScope',
              data: null,
              error: 'registration failed',
              durationMs: performance.now() - workerStart,
            });
            return;
          }

          return navigator.serviceWorker.ready.then((readyRegistration) => {
            readyRegistration.active?.postMessage(undefined);

            /** Resolves with service worker data on message from active worker. */
            navigator.serviceWorker.onmessage = (event: MessageEvent) => {
              readyRegistration.unregister();
              clearTimeout(timeout);
              resolve({
                type: 'service',
                name: 'ServiceWorkerGlobalScope',
                data: event.data,
                durationMs: performance.now() - workerStart,
              });
            };
          });
        })
        .catch((error: Error) => {
          clearTimeout(timeout);
          resolve({
            type: 'service',
            name: 'ServiceWorkerGlobalScope',
            data: null,
            error: error.message,
            durationMs: performance.now() - workerStart,
          });
        });
    });
  };

  // Run all workers in parallel
  const workers = await Promise.all([
    getServiceWorker(),
    getSharedWorker(),
    getDedicatedWorker(),
  ]);

  // Find the best (first successful) result in priority order
  const best = workers.find((w) => w.data !== null) ?? null;

  // Update global state for backwards compatibility
  if (best) {
    WORKER_TYPE = best.type;
    WORKER_NAME = best.name;
  }

  // Compare results across worker types
  const comparison = compareWorkerResults(workers);

  const totalDurationMs = performance.now() - startTime;

  logTestResult({
    time: totalDurationMs,
    test: 'parallel workers',
    passed: best !== null,
  });

  return {
    workers,
    best,
    comparison,
    totalDurationMs,
  };
}
