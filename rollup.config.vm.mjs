/**
 * VM-only build — produces an obfuscated bundle that shows what an attacker sees.
 *
 * Usage: npm run build:vm
 * Output: dist/argus-vm.obf.js (minified + mangled, no source map)
 */
import typescript from '@rollup/plugin-typescript';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default [
  {
    input: 'src/index-vm.ts',
    output: {
      file: 'dist/argus-vm.obf.js',
      format: 'es',
      sourcemap: false,
      inlineDynamicImports: true,
    },
    plugins: [
      nodeResolve(),
      typescript({
        tsconfig: './tsconfig.json',
        noEmitOnError: false,
        outDir: 'dist',
      }),
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
];
