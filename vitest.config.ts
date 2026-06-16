import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['web/e2e/**'],
    globalSetup: process.env.VITEST_SKIP_GLOBAL_SETUP === '1'
      ? []
      : ['tests/api-integration/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/logger.ts'],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 45,
        lines: 68,
      },
    },
  },
});
