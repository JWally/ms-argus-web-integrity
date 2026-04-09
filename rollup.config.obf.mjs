/**
 * Production build — terser minification.
 *
 * Usage: npm run build:obf (or via npm run build:prod)
 * Output: dist/argus-integrity.iife.js (no source map)
 *
 * Target: < 75KB gzipped
 */
import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';

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
