import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { obfuscator } from 'rollup-obfuscator';

const build = process.env.BUILD || 'dev';

// Stage resolution — baked into the iframe bundle at build time.
// The loader URL a merchant embeds determines which stage's bundle they get:
//   static-dev-jw.argus.pw/argus-loader.js  → built with ARGUS_STAGE=dev-jw
//   static.argus.pw/argus-loader.js         → built with ARGUS_STAGE=prod
// Merchants do not configure API endpoints — they pick the right loader URL.
const stage = process.env.ARGUS_STAGE || 'dev-jw';
// API + sigint endpoints can target a different stage than the static bundle
// host. The isolated `e2e` static stack serves loader/iframe/worker from
// static-integrity-e2e but submits to the EXISTING dev-jw API/sigint, so it
// needs no standalone API stack. Defaults to `stage` (the normal case).
const apiStage = process.env.ARGUS_API_STAGE || stage;
const isProd = stage === 'prod';
const isApiProd = apiStage === 'prod';
const apiBase = isApiProd
  ? 'https://api.argus.pw'
  : `https://api-${apiStage}.argus.pw`;
const sigintBaseDomain = 'argus.pw';
const sigintStagePrefix = isApiProd ? '' : `${apiStage}-`;
const workerIntegrity = process.env.ARGUS_WORKER_INTEGRITY || '';
const iframeIntegrity = process.env.ARGUS_IFRAME_INTEGRITY || '';
const manifestKeyId =
  process.env.ARGUS_MANIFEST_KEY_ID || 'argus-dev-jw-manifest-v1';
const manifestPublicKey = process.env.ARGUS_MANIFEST_PUBLIC_JWK
  ? JSON.parse(process.env.ARGUS_MANIFEST_PUBLIC_JWK)
  : {
      key_ops: ['verify'],
      ext: true,
      kty: 'EC',
      x: 'IYkp3ntcKTMMB5-J1yVZkGyIRo8CydDDRzY8vT5XX5M',
      y: '8dXgkrrMt5vU901_GSEGJkAO3Gdy5EBMkHI9XzeYuqg',
      crv: 'P-256',
    };

if (build === 'iframe' && !workerIntegrity) {
  throw new Error('ARGUS_WORKER_INTEGRITY is required when BUILD=iframe');
}
if (build === 'loader' && !iframeIntegrity) {
  throw new Error('ARGUS_IFRAME_INTEGRITY is required when BUILD=loader');
}

const shared = {
  plugins: {
    nodeResolve: nodeResolve(),
    typescript: typescript({
      tsconfig: './tsconfig.json',
      noEmitOnError: false,
      outDir: 'dist',
    }),
  },
};

const configs = {
  // Dev: unminified ESM with sourcemaps
  dev: {
    input: 'src/index.ts',
    output: {
      file: 'dist/argus.esm.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    plugins: [shared.plugins.nodeResolve, shared.plugins.typescript],
  },

  // Production: obfuscated + minified IIFE
  prod: {
    input: 'src/index.ts',
    output: {
      file: 'dist/argus-integrity.iife.js',
      format: 'iife',
      name: 'ArgusIntegrity',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      replace({
        preventAssignment: true,
        __BUILD_ID__: JSON.stringify(`integrity-${Date.now()}`),
      }),
      shared.plugins.typescript,
      obfuscator({
        include: [
          'src/cssmedia/**',
          'src/constants/**',
          'src/engine/**',
          'src/errors/**',
          'src/headless/**',
          'src/incognito/**',
          'src/intl/**',
          'src/lies/**',
          'src/navigator/**',
          'src/screen/**',
          'src/shielding/**',
          'src/status/**',
          'src/timezone/**',
          'src/timing/**',
          'src/trash/**',
          'src/webrtc/**',
          'src/worker/**',
          'src/integrity.ts',
          // VM files: the dispatch loop + opcode handlers are the single
          // most valuable target for a reverser, so we accept the CFF perf
          // hit to flatten them. bytecode-modules.ts is excluded — it's just
          // a const-string export and obfuscating a giant base64 literal
          // wastes build time for zero gain.
          'src/vm/bridge.ts',
          'src/vm/interpreter.ts',
          'src/vm/decoder.ts',
          'src/vm/opcodes.ts',
          'src/vm/format.ts',
          'src/vm/vm.ts',
          'src/vm/module.ts',
          'src/vm/unpack.ts',
        ],
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3,
        deadCodeInjection: false,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        selfDefending: false,
        stringArray: true,
        stringArrayCallsTransform: false,
        stringArrayEncoding: [],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: false,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.5,
        splitStrings: false,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
      }),
      terser({
        compress: {
          passes: 3,
          drop_console: true,
          drop_debugger: true,
          side_effects: false,
          reduce_funcs: false,
        },
        mangle: {
          toplevel: true,
          reserved: [
            'ArgusIntegrity',
            'collectIntegrity',
            'runArgusVm',
            'prefetchArgusVm',
            'runVmDetection',
          ],
          properties: {
            regex: /^_[a-z]/,
          },
        },
        format: {
          comments: false,
        },
      }),
    ],
  },

  // Loader: tiny parent-realm stub that creates the srcdoc iframe.
  // No obfuscation — this runs on the merchant page where transparency helps
  // debugging, and there's no sensitive logic here to hide.
  loader: {
    input: 'src/loader/index.ts',
    output: {
      file: 'dist/argus-loader.iife.js',
      format: 'iife',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      replace({
        preventAssignment: true,
        __ARGUS_IFRAME_INTEGRITY__: JSON.stringify(iframeIntegrity),
      }),
      shared.plugins.typescript,
      terser({
        compress: { passes: 2, drop_console: false, drop_debugger: true },
        mangle: { toplevel: true },
        format: { comments: false },
      }),
    ],
  },

  // Bootstrap: stable merchant-facing entrypoint. It fetches a signed
  // release manifest and then loads the current loader with manifest SRI.
  bootstrap: {
    input: 'src/bootstrap/index.ts',
    output: {
      file: 'dist/argus-bootstrap.v1.iife.js',
      format: 'iife',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      replace({
        preventAssignment: true,
        __ARGUS_MANIFEST_PUBLIC_KEY__: JSON.stringify(manifestPublicKey),
        __ARGUS_MANIFEST_KEY_ID__: JSON.stringify(manifestKeyId),
      }),
      shared.plugins.typescript,
      terser({
        compress: { passes: 2, drop_console: false, drop_debugger: true },
        mangle: { toplevel: true },
        format: { comments: false },
      }),
    ],
  },

  // Iframe entry: auto-runs collect + (optional) VM submission inside the
  // srcdoc iframe the loader creates. Posts result back via postMessage.
  iframe: {
    input: 'src/index-iframe.ts',
    output: {
      file: 'dist/argus-integrity-iframe.iife.js',
      format: 'iife',
      name: 'ArgusIntegrityIframe',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      replace({
        preventAssignment: true,
        __BUILD_ID__: JSON.stringify(`iframe-${Date.now()}`),
        __ARGUS_API_BASE__: JSON.stringify(apiBase),
        __ARGUS_SIGINT_BASE_DOMAIN__: JSON.stringify(sigintBaseDomain),
        __ARGUS_SIGINT_STAGE_PREFIX__: JSON.stringify(sigintStagePrefix),
        __ARGUS_WORKER_INTEGRITY__: JSON.stringify(workerIntegrity),
      }),
      shared.plugins.typescript,
      obfuscator({
        include: [
          'src/cssmedia/**',
          'src/constants/**',
          'src/engine/**',
          'src/errors/**',
          'src/headless/**',
          'src/incognito/**',
          'src/intl/**',
          'src/lies/**',
          'src/navigator/**',
          'src/screen/**',
          'src/shielding/**',
          'src/status/**',
          'src/timezone/**',
          'src/timing/**',
          'src/trash/**',
          'src/webrtc/**',
          'src/worker/**',
          'src/integrity.ts',
          // VM files: the dispatch loop + opcode handlers are the single
          // most valuable target for a reverser, so we accept the CFF perf
          // hit to flatten them. bytecode-modules.ts is excluded — it's just
          // a const-string export and obfuscating a giant base64 literal
          // wastes build time for zero gain.
          'src/vm/bridge.ts',
          'src/vm/interpreter.ts',
          'src/vm/decoder.ts',
          'src/vm/opcodes.ts',
          'src/vm/format.ts',
          'src/vm/vm.ts',
          'src/vm/module.ts',
          'src/vm/unpack.ts',
        ],
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3,
        deadCodeInjection: false,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        selfDefending: false,
        stringArray: true,
        stringArrayCallsTransform: false,
        stringArrayEncoding: [],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: false,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.5,
        splitStrings: false,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
      }),
      terser({
        compress: {
          passes: 3,
          drop_console: true,
          drop_debugger: true,
          side_effects: false,
          reduce_funcs: false,
        },
        mangle: {
          toplevel: true,
          properties: { regex: /^_[a-z]/ },
        },
        format: { comments: false },
      }),
    ],
  },

  // Worker entry: hosts the bytecode VM + bridge + crypto + POST in a
  // dedicated Web Worker realm. Page-realm prototype patches (Playwright
  // addInitScript on SubtleCrypto, TextEncoder, etc.) cannot reach into a
  // Worker; this is the structural defense the pristine-iframe pattern
  // was approximating. Loaded by index-iframe.ts via `new Worker(blobUrl)`
  // where blobUrl wraps the IIFE bytes inline — keeps the worker same-
  // origin to the srcdoc iframe so the `_fpid` cookie scope is preserved
  // on POST_PAYLOAD's fetch.
  worker: {
    input: 'src/index-worker.ts',
    output: {
      file: 'dist/argus-integrity-worker.iife.js',
      format: 'iife',
      name: 'ArgusIntegrityWorker',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      replace({
        preventAssignment: true,
        __BUILD_ID__: JSON.stringify(`worker-${Date.now()}`),
        __ARGUS_API_BASE__: JSON.stringify(apiBase),
        __ARGUS_SIGINT_BASE_DOMAIN__: JSON.stringify(sigintBaseDomain),
        __ARGUS_SIGINT_STAGE_PREFIX__: JSON.stringify(sigintStagePrefix),
      }),
      shared.plugins.typescript,
      obfuscator({
        include: [
          // Same surface as iframe — the bridge + VM are the obfuscation
          // targets a reverser would chase. Collectors that move to worker
          // realm get bundled here too.
          'src/cssmedia/**',
          'src/constants/**',
          'src/engine/**',
          'src/errors/**',
          'src/headless/**',
          'src/incognito/**',
          'src/intl/**',
          'src/lies/**',
          'src/navigator/**',
          'src/screen/**',
          'src/shielding/**',
          'src/status/**',
          'src/timezone/**',
          'src/timing/**',
          'src/trash/**',
          'src/webrtc/**',
          'src/worker/**',
          'src/integrity.ts',
          'src/vm/bridge.ts',
          'src/vm/interpreter.ts',
          'src/vm/decoder.ts',
          'src/vm/opcodes.ts',
          'src/vm/format.ts',
          'src/vm/vm.ts',
          'src/vm/module.ts',
          'src/vm/unpack.ts',
        ],
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.3,
        deadCodeInjection: false,
        identifierNamesGenerator: 'hexadecimal',
        renameGlobals: false,
        selfDefending: false,
        stringArray: true,
        stringArrayCallsTransform: false,
        stringArrayEncoding: [],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 1,
        stringArrayWrappersChainedCalls: false,
        stringArrayWrappersType: 'variable',
        stringArrayThreshold: 0.5,
        splitStrings: false,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
      }),
      terser({
        compress: {
          passes: 3,
          drop_console: true,
          drop_debugger: true,
          side_effects: false,
          reduce_funcs: false,
        },
        mangle: {
          toplevel: true,
          properties: { regex: /^_[a-z]/ },
        },
        format: { comments: false },
      }),
    ],
  },

  // VM-only: attacker-view artifact
  vm: {
    input: 'src/index-vm.ts',
    output: {
      file: 'dist/argus-vm.obf.js',
      format: 'es',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      shared.plugins.typescript,
      terser({
        compress: {
          passes: 3,
          pure_getters: true,
          unsafe: true,
          drop_console: true,
          drop_debugger: true,
        },
        mangle: {
          properties: {
            regex: /^_|^handler|^opcode|^register|^bytecode|^scramble/,
          },
          toplevel: true,
        },
        format: {
          comments: false,
        },
      }),
    ],
  },

  // Benchmark-only collector. Not deployed. This mirrors collectIntegrity's
  // orchestration with per-slice timers so local/CI perf runs can rank the
  // actual browser cost without adding profiling code to production bundles.
  bench: {
    input: 'src/bench-entry.ts',
    output: {
      file: 'dist/argus-bench.iife.js',
      format: 'iife',
      name: 'ArgusBench',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      shared.plugins.nodeResolve,
      shared.plugins.typescript,
      terser({
        compress: { passes: 1, drop_console: false, drop_debugger: true },
        mangle: false,
        format: { comments: false },
      }),
    ],
  },
};

export default [configs[build]];
