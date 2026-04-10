import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { obfuscator } from 'rollup-obfuscator';

const build = process.env.BUILD || 'dev';

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
