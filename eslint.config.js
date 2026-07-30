/**
 * Each package owns its own eslint.config.js so that type-aware linting
 * resolves against the right tsconfig, and `turbo run lint` fans out to them.
 * This root config exists only so that a bare `eslint .` at the root is not an
 * error; it deliberately checks nothing.
 */
export default [
  {
    ignores: [
      'apps/**',
      'packages/**',
      'dist/**',
      'coverage/**',
      '.turbo/**',
      'node_modules/**',
    ],
  },
];
