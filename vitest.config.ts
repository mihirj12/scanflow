import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Apps join this list as they gain tests: apps/api in M2, apps/web in M3.
    projects: ['packages/*'],
  },
});
