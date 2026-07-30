import { baseConfig, testOverrides } from '@scanflow/config/eslint/base';

export default [
  { ignores: ['dist/**', 'coverage/**', 'scripts/**'] },
  ...baseConfig,
  {
    // Scoped to src: this package's own tooling config legitimately imports the
    // shared ESLint config, and tooling is not shipped.
    files: ['src/**/*.ts'],
    rules: {
      // Ground rule 1: no imports from outside the package. The complementary
      // check in scripts/check-purity.mjs catches bare specifiers that ESLint
      // would consider legitimate; this catches reaching across the workspace.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@scanflow/*', 'node:*'],
              message:
                'scheduling-core is a pure package: it imports nothing outside itself.',
            },
          ],
        },
      ],
    },
  },
  testOverrides,
];
