/**
 * Production build — terser minification only.
 * Real obfuscation lives in the VM bytecode (randomized opcodes, XOR scramble).
 *
 * Usage: npm run build:obf
 * Output: dist/argus-integrity.iife.js (~48K gzipped, no source map)
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
          passes: 1,
          drop_console: false,
          drop_debugger: true,
        },
        mangle: true,
        format: {
          comments: false,
        },
      }),
    ],
  },
];
