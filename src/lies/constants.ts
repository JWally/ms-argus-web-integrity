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

  // WebGL APIs - critical for WebGL fingerprinting
  {
    api: 'WebGLRenderingContext',
    target: ['bufferData', 'getParameter', 'readPixels'],
  },
  {
    api: 'WebGL2RenderingContext',
    target: ['bufferData', 'getParameter', 'readPixels'],
  },
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
