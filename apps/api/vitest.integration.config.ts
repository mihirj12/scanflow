import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api-integration',
    include: ['test/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
