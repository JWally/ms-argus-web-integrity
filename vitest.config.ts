import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify('test-build-id'),
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/types.ts'],
      thresholds: {
        'src/trash/index.ts': {
          statements: 85,
          branches: 85,
          functions: 85,
          lines: 85,
        },
        'src/timing/index.ts': {
          statements: 80,
          branches: 50,
          functions: 80,
          lines: 80,
        },
        'src/utils/sigint.ts': {
          statements: 65,
          branches: 60,
          functions: 60,
          lines: 65,
        },
        'src/utils/delta.ts': {
          statements: 50,
          branches: 50,
          functions: 50,
          lines: 50,
        },
        'src/utils/engine.ts': {
          statements: 85,
          branches: 50,
          functions: 85,
          lines: 85,
        },
      },
    },
  },
});
