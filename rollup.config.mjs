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
const isProd = stage === 'prod';
const apiBase = isProd
  ? 'https://api.argus.pw'
  : `https://api-${stage}.argus.pw`;
const sigintBaseDomain = 'argus.pw';
const sigintStagePrefix = isProd ? '' : `${stage}-`;

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
};

export default [configs[build]];
