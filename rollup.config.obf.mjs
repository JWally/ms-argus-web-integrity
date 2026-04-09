/**
 * Production build — terser minification + selective javascript-obfuscator.
 *
 * Obfuscator runs ONLY on fingerprinting/detection modules (the readable stuff).
 * VM, crypto, fetch, and async bridge code is excluded to avoid breaking
 * Web Crypto API calls and async patterns.
 *
 * Usage: npm run build:obf (or via npm run build:prod)
 * Output: dist/argus-integrity.iife.js (no source map)
 * Target: < 75KB gzipped
 */
import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { obfuscator } from 'rollup-obfuscator';

export default [
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/argus-integrity.iife.js',
      format: 'iife',
      name: 'ArgusIntegrity',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      nodeResolve(),
      replace({
        preventAssignment: true,
        __BUILD_ID__: JSON.stringify(`integrity-${Date.now()}`),
      }),
      typescript({
        tsconfig: './tsconfig.json',
        noEmitOnError: false,
        outDir: 'dist',
      }),
      // Obfuscate detection/fingerprinting modules only — NOT vm/crypto/fetch
      obfuscator({
        // Only process detection logic files
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
      // Terser runs after obfuscator — compresses everything including obfuscated output
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
];
