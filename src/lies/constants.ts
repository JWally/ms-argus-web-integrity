/**
 * Lie Detection Constants
 *
 * This file contains patterns, regexes, and API targets used to detect
 * if browser APIs have been modified, wrapped in proxies, or otherwise
 * tampered with by automation tools, privacy extensions, or bots.
 *
 * ## Why lie detection matters:
 * Bots and automation tools often modify browser APIs to:
 * - Spoof fingerprints (return fake values)
 * - Hide automation indicators (webdriver, headless)
 * - Bypass security checks
 *
 * By detecting these modifications, we can identify non-human traffic.
 */

/**
 * CSS styles to hide iframes used for isolated testing.
 * Positioned off-screen and invisible to avoid interfering with the page.
 */
export const GHOST_STYLES = `
  height: 100vh;
  width: 100vw;
  position: absolute;
  left:-10000px;
  visibility: hidden;
`;

/**
 * Regex patterns for detecting proxy wrapping in stack traces.
 *
 * When native functions are wrapped in Proxies, the error stack traces
 * reveal this by showing different call origins than expected.
 */
export const STACK_TRACE_PATTERNS = {
  /** Expected stack trace for Function.toString calls */
  AT_FUNCTION: /at Function\.toString /,

  /** Expected stack trace for Object.toString calls */
  AT_OBJECT: /at Object\.toString/,

  /** Pattern for Function[Symbol.hasInstance] in stack (Chrome < 102) */
  FUNCTION_INSTANCE: /at (Function\.)?\[Symbol.hasInstance\]/,

  /** Pattern for Proxy[Symbol.hasInstance] in stack (Chrome < 102) */
  PROXY_INSTANCE: /at (Proxy\.)?\[Symbol.hasInstance\]/,

  /** Strict mode error message pattern (Firefox/Gecko) */
  STRICT_MODE: /strict mode/,
} as const;

/**
 * Known valid toString() formats for native functions.
 *
 * Native browser functions have specific toString() formats that vary
 * by browser engine. If a function doesn't match any of these patterns,
 * it's likely been modified or wrapped.
 *
 * @param name - The function name to check
 * @returns Map of valid toString formats for this function name
 */
export function getKnownToStringFormats(name: string): Record<string, boolean> {
  return {
    // Standard format (most browsers)
    [`function ${name}() { [native code] }`]: true,
    [`function get ${name}() { [native code] }`]: true,
    [`function () { [native code] }`]: true,
    // Safari/WebKit format (newlines)
    [`function ${name}() {\n    [native code]\n}`]: true,
    [`function get ${name}() {\n    [native code]\n}`]: true,
    [`function () {\n    [native code]\n}`]: true,
  };
}

/**
 * APIs and their properties to search for tampering.
 *
 * Each entry specifies an API and which properties to test.
 * Properties not listed are skipped to improve performance.
 * If `target` is undefined, all properties are tested.
 */
export const API_SEARCH_TARGETS: Array<{
  api: string;
  target?: string[];
  ignore?: string[];
}> = [
  // Test Function.toString first - determines depth of other searches
  {
    api: 'Function',
    target: ['toString'],
    ignore: ['caller', 'arguments'],
  },

  // Audio APIs - critical for audio fingerprinting
  { api: 'AnalyserNode', target: undefined },
  { api: 'AudioBuffer', target: ['copyFromChannel', 'getChannelData'] },
  { api: 'BiquadFilterNode', target: ['getFrequencyResponse'] },

  // Canvas APIs - critical for canvas fingerprinting
  {
    api: 'CanvasRenderingContext2D',
    target: [
      'getImageData',
      'getLineDash',
      'isPointInPath',
      'isPointInStroke',
      'measureText',
      'quadraticCurveTo',
      'fillText',
      'strokeText',
      'font',
    ],
  },

  // CSS APIs
  { api: 'CSSStyleDeclaration', target: ['setProperty'] },
  { api: 'CSS2Properties', target: ['setProperty'] }, // Gecko

  // Date APIs - timezone detection
  {
    api: 'Date',
    target: [
      'getDate',
      'getDay',
      'getFullYear',
      'getHours',
      'getMinutes',
      'getMonth',
      'getTime',
      'getTimezoneOffset',
      'setDate',
      'setFullYear',
      'setHours',
      'setMilliseconds',
      'setMonth',
      'setSeconds',
      'setTime',
      'toDateString',
      'toJSON',
      'toLocaleDateString',
      'toLocaleString',
      'toLocaleTimeString',
      'toString',
      'toTimeString',
      'valueOf',
    ],
  },

  // WebGPU APIs (newer)
  { api: 'GPU', target: ['requestAdapter'] },
  { api: 'GPUAdapter', target: ['requestAdapterInfo'] },

  // Internationalization APIs
  {
    api: 'Intl.DateTimeFormat',
    target: ['format', 'formatRange', 'formatToParts', 'resolvedOptions'],
  },

  // Document APIs
  {
    api: 'Document',
    target: [
      'createElement',
      'createElementNS',
      'getElementById',
      'getElementsByClassName',
      'getElementsByName',
      'getElementsByTagName',
      'getElementsByTagNameNS',
      'referrer',
      'write',
      'writeln',
    ],
    ignore: ['onreadystatechange', 'onmouseenter', 'onmouseleave'], // Gecko
  },

  // DOM Rect APIs - for DOMRect fingerprinting
  { api: 'DOMRect', target: undefined },
  { api: 'DOMRectReadOnly', target: undefined },

  // Element APIs
  {
    api: 'Element',
    target: [
      'append',
      'appendChild',
      'getBoundingClientRect',
      'getClientRects',
      'insertAdjacentElement',
      'insertAdjacentHTML',
      'insertAdjacentText',
      'insertBefore',
      'prepend',
      'replaceChild',
      'replaceWith',
      'setAttribute',
    ],
  },

  // Font APIs
  { api: 'FontFace', target: ['family', 'load', 'status'] },

  // Canvas HTML element
  { api: 'HTMLCanvasElement', target: undefined },

  // HTML Element APIs
  {
    api: 'HTMLElement',
    target: [
      'clientHeight',
      'clientWidth',
      'offsetHeight',
      'offsetWidth',
      'scrollHeight',
      'scrollWidth',
    ],
    ignore: ['onmouseenter', 'onmouseleave'], // Gecko
  },

  // iFrame APIs
  { api: 'HTMLIFrameElement', target: ['contentDocument', 'contentWindow'] },

  // Intersection Observer APIs
  {
    api: 'IntersectionObserverEntry',
    target: ['boundingClientRect', 'intersectionRect', 'rootBounds'],
  },

  // Math APIs - critical for math fingerprinting
  {
    api: 'Math',
    target: [
      'acos',
      'acosh',
      'asinh',
      'atan',
      'atan2',
      'atanh',
      'cbrt',
      'cos',
      'cosh',
      'exp',
      'expm1',
      'log',
      'log10',
      'log1p',
      'sin',
      'sinh',
      'sqrt',
      'tan',
      'tanh',
    ],
  },

  // Media Device APIs
  {
    api: 'MediaDevices',
    target: ['enumerateDevices', 'getDisplayMedia', 'getUserMedia'],
  },

  // Navigator APIs - critical for navigator fingerprinting
  {
    api: 'Navigator',
    target: [
      'appCodeName',
      'appName',
      'appVersion',
      'buildID',
      'connection',
      'deviceMemory',
      'getBattery',
      'getGamepads',
      'getVRDisplays',
      'hardwareConcurrency',
      'language',
      'languages',
      'maxTouchPoints',
      'mimeTypes',
      'oscpu',
      'platform',
      'plugins',
      'product',
      'productSub',
      'sendBeacon',
      'serviceWorker',
      'storage',
      'userAgent',
      'vendor',
      'vendorSub',
      'webdriver',
      'gpu',
    ],
  },

  // Node APIs
  { api: 'Node', target: ['appendChild', 'insertBefore', 'replaceChild'] },

  // OffscreenCanvas APIs
  { api: 'OffscreenCanvas', target: ['convertToBlob', 'getContext'] },
  {
    api: 'OffscreenCanvasRenderingContext2D',
    target: [
      'getImageData',
      'getLineDash',
      'isPointInPath',
      'isPointInStroke',
      'measureText',
      'quadraticCurveTo',
      'font',
    ],
  },

  // Permissions APIs
  { api: 'Permissions', target: ['query'] },

  // Range APIs
  { api: 'Range', target: ['getBoundingClientRect', 'getClientRects'] },

  // Intl APIs
  { api: 'Intl.RelativeTimeFormat', target: ['resolvedOptions'] },

  // Screen APIs
  { api: 'Screen', target: undefined },

  // Speech APIs
  { api: 'speechSynthesis', target: ['getVoices'] },

  // String APIs
  { api: 'String', target: ['fromCodePoint'] },

  // Storage APIs
  { api: 'StorageManager', target: ['estimate'] },

  // SVG APIs
  { api: 'SVGRect', target: undefined },
  { api: 'SVGRectElement', target: ['getBBox'] },
  {
    api: 'SVGTextContentElement',
    target: ['getExtentOfChar', 'getSubStringLength', 'getComputedTextLength'],
  },

  // Text Metrics
  { api: 'TextMetrics', target: undefined },

  // WebGL APIs - critical for WebGL fingerprinting.
  // getExtension/getSupportedExtensions/getShaderPrecisionFormat are
  // called by the worker fingerprint collector (worker/index.ts) to read
  // the renderer string and precision tables; bots that don't fake the
  // renderer routinely stub these to dodge the cross-thread divergence
  // check, so they need to be scanned for tampering.
  {
    api: 'WebGLRenderingContext',
    target: [
      'bufferData',
      'getParameter',
      'readPixels',
      'getExtension',
      'getSupportedExtensions',
      'getShaderPrecisionFormat',
    ],
  },
  {
    api: 'WebGL2RenderingContext',
    target: [
      'bufferData',
      'getParameter',
      'readPixels',
      'getExtension',
      'getSupportedExtensions',
      'getShaderPrecisionFormat',
    ],
  },

  // Crypto APIs — the SDK signs the integrity envelope and derives feature
  // hashes through `crypto.subtle.sign/digest/encrypt` (vm/bridge.ts,
  // utils/crypto.ts). A no-op or constant-return patch would not show up
  // in any other scan target. Real users never have these tampered.
  {
    api: 'Crypto',
    target: ['getRandomValues', 'randomUUID', 'subtle'],
  },
  {
    api: 'SubtleCrypto',
    target: [
      'digest',
      'sign',
      'verify',
      'encrypt',
      'decrypt',
      'generateKey',
      'importKey',
      'exportKey',
      'deriveBits',
      'deriveKey',
    ],
  },

  // JSON — feature-hash canonicalization and payload serialization run
  // through JSON.stringify (utils/crypto.ts). Patching to drop keys would
  // silently change the wire fingerprint without surfacing in any other
  // signal. JSON is not legitimately patched by any browser extension.
  {
    api: 'JSON',
    target: ['stringify', 'parse'],
  },

  // Text encoders — key derivation in utils/crypto.ts converts strings to
  // bytes via TextEncoder before hashing. A patched encoder returning
  // empty buffers corrupts every downstream HMAC.
  {
    api: 'TextEncoder',
    target: ['encode', 'encodeInto', 'encoding'],
  },
  {
    api: 'TextDecoder',
    target: ['decode', 'encoding'],
  },

  // URL + Blob — anchor the worker-bench's blob-URL source path.
  // The CDP-timing bench delivers its worker source as
  // `URL.createObjectURL(new Blob([WORKER_SCRIPT], ...))`. blob: URLs
  // are browser-internal and not interceptable by page.route, but a
  // sufficiently motivated attacker can wrap either constructor with
  // a Proxy and rewrite the source bytes before the Worker is built —
  // injecting a console patch into the worker realm and defeating the
  // in-worker console probe (the v3 closure's new home, see
  // `src/headless/getConsoleTimingWorker.ts`). Adding these to the
  // scanner makes that wrap detectable. The targets cover the methods
  // the bench actually uses; the rest of the URL surface is left out
  // to avoid drag on unrelated workflows.
  {
    api: 'URL',
    target: ['createObjectURL', 'revokeObjectURL'],
  },
  { api: 'Blob', target: undefined },

  // Console — moved out of the main-thread lie scanner. The v3 closure
  // motivation for scanning console (catch `console.log = noop` patches
  // that defeat the CDP-timing bench) is still load-bearing, but the
  // check now lives inside the worker bench's own realm — see
  // `src/headless/getConsoleTimingWorker.ts`. The worker-realm probe
  // catches the same attack with a much better false-positive profile:
  //
  //   - CriOS (Chrome on iOS) wraps `console.*` in Google's iOS-app
  //     analytics shim. The wrapper is structurally identical to a
  //     bot's patch and triggers every probe in this scanner — 5
  //     methods × 11 probes = 55 false-positive lies per session, well
  //     past the lies>=20 → device_tampering=100 threshold. Removing
  //     console from this scanner eliminates that false positive.
  //   - The worker bench is engine-gated to Blink (IS_BLINK check at
  //     entry), so CriOS / Safari / Brave iOS never run the in-worker
  //     probe. CriOS's analytics shim is structurally invisible to it.
  //   - Browser extensions (uBlock, password managers) inject into
  //     content scripts on the main thread; Web Worker realms are
  //     out of their reach. Extension-induced console wrapping no
  //     longer false-positives this signal either.
  //
  // Closing this scanner entry creates a residual gap: an attacker who
  // patches `console.*` in the main realm without touching the worker
  // realm now passes the main-thread lie scanner. That's fine — the
  // main-thread iframe bench's timing measurement collapses to ~1.0
  // under that patch, the worker bench (different realm, attacker
  // patch doesn't reach it) still measures real CDP overhead, and the
  // analyzer's hasBenchDisagreement check catches the divergence at 75.
  // The only path to defeat both benches is to patch the worker's
  // console too, which requires either wrapping Worker (caught here —
  // Worker.prototype is on the scanner via `scanner.ts:102`) or
  // wrapping URL.createObjectURL to rewrite the blob source (now
  // covered by the URL/Blob entries below — added 2026-05-20 alongside
  // this removal to keep the worker-source-rewrite path closed).
];

/**
 * Error types that are considered valid for type checking.
 */
export const VALID_ERROR_TYPES = {
  Error: true,
  EvalError: true,
  InternalError: true,
  RangeError: true,
  ReferenceError: true,
  SyntaxError: true,
  TypeError: true,
  URIError: true,
  InvalidStateError: true,
  SecurityError: true,
} as const;
