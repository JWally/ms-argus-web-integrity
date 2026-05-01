import { captureError } from '../errors';
import { documentLie } from '../lies';
import {
  createTimer,
  queueEvent,
  JS_ENGINE,
  logTestResult,
  IS_BLINK,
  getReportedPlatform,
} from '../utils/helpers';
import {
  computeTimezoneOffset,
  getLocaleString,
  getCurrencyLocales,
  getMainWebgl,
  getConnection,
  getPermissions,
  getStorageEstimate,
  getMediaCapabilities,
} from './collect';
import { enrichScope } from './enrich';
import type { WorkerScopeData } from './types';

export type { WorkerScopeData } from './types';

/** Timeout for worker operations in milliseconds */
const WORKER_TIMEOUT_MS = 1000;

/**
 * Inline worker script as a string for Blob URL creation.
 * This avoids the need for an external worker file (404 errors).
 * The script collects fingerprint data and posts it back to the main thread.
 *
 * NOTE: This is self-contained — Blob workers cannot import modules.
 * The collection logic here mirrors src/worker/collect.ts. Changes to
 * collected fields must be synced manually between the two.
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

const getConnection = () => {
  try {
    const c = navigator.connection;
    if (!c) return null;
    return { downlink: c.downlink, effectiveType: c.effectiveType, rtt: c.rtt, saveData: c.saveData };
  } catch { return null; }
};

const getPermissions = async () => {
  try {
    if (!navigator.permissions) return null;
    const names = ['notifications', 'push', 'persistent-storage', 'screen-wake-lock'];
    const results = {};
    for (const name of names) {
      try { results[name] = (await navigator.permissions.query({ name })).state; } catch {}
    }
    return results;
  } catch { return null; }
};

const getStorageEstimate = async () => {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const { quota, usage } = await navigator.storage.estimate();
    return { quota, usage };
  } catch { return null; }
};

const getMediaCapabilities = async () => {
  try {
    if (!navigator.mediaCapabilities) return null;
    const configs = [
      { type: 'file', video: { contentType: 'video/webm; codecs="vp8"', width: 1920, height: 1080, bitrate: 2000000, framerate: 30 } },
      { type: 'file', video: { contentType: 'video/webm; codecs="vp9"', width: 1920, height: 1080, bitrate: 2000000, framerate: 30 } },
      { type: 'file', audio: { contentType: 'audio/webm; codecs="opus"', channels: 2, bitrate: 128000, samplerate: 48000 } },
    ];
    const results = {};
    for (const cfg of configs) {
      try {
        const key = cfg.video ? cfg.video.contentType : cfg.audio.contentType;
        const r = await navigator.mediaCapabilities.decodingInfo(cfg);
        results[key] = { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
      } catch {}
    }
    return results;
  } catch { return null; }
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

  // Additional WorkerNavigator properties
  const connection = getConnection();
  const permissions = await getPermissions();
  const storageEstimate = await getStorageEstimate();
  const mediaCapabilities = await getMediaCapabilities();

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
    userAgentData,
    // Extended navigator properties
    appVersion: navigator.appVersion,
    product: navigator.product,
    onLine: navigator.onLine,
    globalPrivacyControl: navigator.globalPrivacyControl,
    // Navigator property count — immune to extensions (workers don't run extensions).
    // Changes per browser version as APIs are added to WorkerNavigator.
    // Walk the prototype chain since properties live on WorkerNavigator.prototype, not the instance.
    navigatorPropertyCount: (() => {
      const seen = new Set();
      let obj = navigator;
      while (obj && obj !== Object.prototype) {
        for (const k of Object.getOwnPropertyNames(obj)) seen.add(k);
        obj = Object.getPrototypeOf(obj);
      }
      return seen.size;
    })(),
    // Async probes
    connection,
    permissions,
    storageEstimate,
    mediaCapabilities,
  };
};

// Handle different worker types
if (typeof SharedWorkerGlobalScope !== 'undefined' && self instanceof SharedWorkerGlobalScope) {
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
 */
function createWorkerBlobUrl(): string {
  return URL.createObjectURL(
    new Blob([INLINE_WORKER_SCRIPT], { type: 'application/javascript' }),
  );
}

/**
 * Spawns a worker via Blob URL and resolves with its fingerprint data.
 */
function spawnBlobWorker(
  blobUrl: string,
  kind: 'dedicated' | 'shared',
): Promise<WorkerScopeData | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), WORKER_TIMEOUT_MS);
    const done = (result: WorkerScopeData | null) => {
      clearTimeout(timeout);
      resolve(result);
    };

    try {
      if (kind === 'shared') {
        const w = new SharedWorker(blobUrl);
        w.port.start();
        w.port.onmessage = (e) => {
          w.port.close();
          done(e.data);
        };
        w.onerror = () => {
          w.port.close();
          done(null);
        };
      } else {
        const w = new Worker(blobUrl);
        w.onmessage = (e) => {
          w.terminate();
          done(e.data);
        };
        w.onerror = () => {
          w.terminate();
          done(null);
        };
      }
    } catch {
      done(null);
    }
  });
}

/**
 * Builds the main-thread scope baseline for cross-context validation.
 */
async function collectMainScope() {
  const { systemCurrencyLocale, engineCurrencyLocale } = getCurrencyLocales(
    navigator.language,
  );
  const locale = getLocaleString();
  const enriched = enrichScope({
    userAgent: navigator.userAgent,
    userAgentData: (navigator as any).userAgentData,
  });
  const [permissions, storageEstimate, mediaCapabilities] = await Promise.all([
    getPermissions().catch(() => null),
    getStorageEstimate().catch(() => null),
    getMediaCapabilities().catch(() => null),
  ]);

  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory as number | undefined,
    language: navigator.language,
    languages: String(navigator.languages),
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    locale,
    systemCurrencyLocale,
    engineCurrencyLocale,
    localeEntropyIsTrusty: engineCurrencyLocale === systemCurrencyLocale,
    localeIntlEntropyIsTrusty: new Set(
      String(navigator.language).split(','),
    ).has(locale),
    timezoneOffset: computeTimezoneOffset(),
    timezoneLocation: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...getMainWebgl(),
    ...enriched,
    ...((navigator as any).userAgentData
      ? { userAgentData: (navigator as any).userAgentData }
      : {}),
    appVersion: navigator.appVersion,
    product: navigator.product,
    onLine: navigator.onLine,
    globalPrivacyControl: (navigator as any).globalPrivacyControl,
    connection: getConnection(),
    permissions,
    storageEstimate,
    mediaCapabilities,
  };
}

/**
 * Collects worker scope fingerprint using parallel worker execution.
 *
 * Spawns SharedWorker and DedicatedWorker in parallel via inline Blob URLs,
 * collects a main-thread baseline, then cross-validates all scopes to detect
 * spoofing inconsistencies.
 */
export default async function getBestWorkerScope() {
  try {
    const timer = createTimer();
    await queueEvent(timer);

    const blobUrl = createWorkerBlobUrl();
    const mainScope = await collectMainScope();

    // Spawn workers in parallel
    const [sharedResult, webResult] = await Promise.all([
      spawnBlobWorker(blobUrl, 'shared').catch(() => null),
      spawnBlobWorker(blobUrl, 'dedicated').catch(() => null),
    ]);
    URL.revokeObjectURL(blobUrl);

    const allScopes = { main: mainScope, web: webResult, shared: sharedResult };

    // Select best worker result (prefer SharedWorker)
    let workerScope: WorkerScopeData | null = null;
    let workerType: 'shared' | 'web' | '' = '';
    if (sharedResult?.userAgent) {
      workerScope = sharedResult;
      workerType = 'shared';
    } else if (webResult?.userAgent) {
      workerScope = webResult;
      workerType = 'web';
    }

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

    // Enrich all scopes with derived fields
    Object.assign(workerScope, enrichScope(workerScope));
    const otherScope = workerScope === sharedResult ? webResult : sharedResult;
    if (otherScope?.userAgent)
      Object.assign(otherScope, enrichScope(otherScope));

    // ── Cross-context validation ────────────────────────────────────

    const {
      system,
      userAgent,
      userAgentData,
      platform,
      deviceMemory,
      hardwareConcurrency,
    } = workerScope;

    // Navigator lies: worker vs main thread
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
    if (deviceMemory && deviceMemory != (navigator as any).deviceMemory) {
      documentLie('Navigator.deviceMemory', workerScopeMatchLie);
    }

    // Prototype lies from worker
    if (workerScope.lies.proto) {
      const { proto } = workerScope.lies;
      for (const key of Object.keys(proto)) {
        for (const lie of proto[key]) {
          documentLie(`WorkerGlobalScope.${key}`, lie);
        }
      }
    }

    // OS lie: platform vs user agent
    const [userAgentOS, platformOS] = getReportedPlatform(userAgent, platform);
    if (userAgentOS != platformOS) {
      workerScope.lied = true;
      workerScope.lies.os = `${platformOS} platform and ${userAgentOS} user agent do not match`;
      documentLie('WorkerGlobalScope', workerScope.lies.os);
    }

    // Engine lie: runtime JS engine vs user agent claim
    if (workerScope.userAgentEngine != JS_ENGINE) {
      workerScope.lied = true;
      workerScope.lies.engine = `${JS_ENGINE} JS runtime and ${workerScope.userAgentEngine} user agent do not match`;
      documentLie('WorkerGlobalScope', workerScope.lies.engine);
    }

    // Version lie: userAgentData version vs user agent version
    const versionSupported =
      workerScope.userAgentDataVersion && workerScope.userAgentVersion;
    if (
      versionSupported &&
      workerScope.userAgentDataVersion != workerScope.userAgentVersion
    ) {
      workerScope.lied = true;
      workerScope.lies.version = `userAgentData version ${workerScope.userAgentDataVersion} and user agent version ${workerScope.userAgentVersion} do not match`;
      documentLie('WorkerGlobalScope', workerScope.lies.version);
    }

    // Platform version lie (Windows/macOS)
    const FEATURE_CASE = IS_BLINK && CSS.supports('accent-color: initial');
    const getPlatformVersionLie = (device: any, uaData: any) => {
      if (!/windows|mac/i.test(device) || !uaData?.platformVersion)
        return false;
      if (uaData.platform == 'macOS') {
        return FEATURE_CASE ? /_/.test(uaData.platformVersion) : false;
      }
      const reportedVersionNumber = (/windows ([\d|\.]+)/i.exec(device) ||
        [])[1];
      const windows10OrHigherReport = +reportedVersionNumber == 10;
      const { platformVersion } = uaData;
      const versionMap: Record<string, string> = {
        '6.1': '7',
        '6.2': '8',
        '6.3': '8.1',
        '10.0': '10',
      };
      const version = versionMap[platformVersion];
      if (!FEATURE_CASE && version) return version != reportedVersionNumber;
      const parts = platformVersion.split('.');
      if (parts.length != 3) return true;
      const windows10OrHigherPlatform = +parts[0] > 0;
      return (
        (windows10OrHigherPlatform && !windows10OrHigherReport) ||
        (!windows10OrHigherPlatform && windows10OrHigherReport)
      );
    };
    if (getPlatformVersionLie(workerScope.device, userAgentData)) {
      workerScope.lied = true;
      workerScope.lies.platformVersion = 'platform version is fake';
      documentLie('WorkerGlobalScope', workerScope.lies.platformVersion);
    }

    // Cross-scope consistency: shared vs web worker
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
          documentLie(
            'WorkerGlobalScope',
            `${f} differs between shared and web worker`,
          );
        }
      }
      if (sharedResult.userAgentData && webResult.userAgentData) {
        if (
          JSON.stringify(sharedResult.userAgentData) !==
          JSON.stringify(webResult.userAgentData)
        ) {
          workerScope.lied = true;
          documentLie(
            'WorkerGlobalScope',
            'userAgentData differs between shared and web worker',
          );
        }
      }
    }

    logTestResult({
      time: timer.stop(),
      test: `${workerType} worker`,
      passed: true,
    });
    return {
      lied: workerScope.lied,
      lies: workerScope.lies,
      localeEntropyIsTrusty: workerScope.localeEntropyIsTrusty,
      localeIntlEntropyIsTrusty: workerScope.localeIntlEntropyIsTrusty,
      best: workerType as 'shared' | 'web' | '',
      scopes: allScopes,
    };
  } catch (error) {
    logTestResult({ test: 'worker', passed: false });
    captureError(error as Error, 'workers failed or blocked by client');
    return {
      lied: false,
      lies: {},
      localeEntropyIsTrusty: false,
      localeIntlEntropyIsTrusty: false,
      best: '' as 'shared' | 'web' | '',
      scopes: { main: null, web: null, shared: null },
    };
  }
}
