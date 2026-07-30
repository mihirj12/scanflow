import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // apps/web joins in M3 when it has tests.
    projects: ['packages/*', 'apps/api'],
  },
});
