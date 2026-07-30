import { nodeConfig } from '@scanflow/config/eslint/node';

export default [
  { ignores: ['dist/**', 'coverage/**', 'test/**'] },
  ...nodeConfig,
  {
    rules: {
      /**
       * The layering rules from the ground rules, made mechanical.
       *
       * A use case that can reach `infra/` will eventually import a Drizzle
       * query, and a use case that can reach `http/` will eventually take an
       * Express type in its signature. Either one means the boundary has leaked
       * and the use case is no longer unit-testable without a database or an
       * HTTP mock. Documenting the rule is not enough; this fails the build.
       */
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/modules',
              from: './src/infra',
              message:
                'Use cases depend on the port interface in their own ports.ts, never on a Drizzle adapter. Wire the implementation in container.ts.',
            },
            {
              target: './src/modules',
              from: './src/http',
              message:
                'Use cases know nothing about HTTP. Controllers parse, delegate and serialize.',
            },
            {
              target: './src/infra',
              from: './src/http',
              message: 'Repositories know nothing about HTTP.',
            },
          ],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'express',
              message:
                'Only apps/api/src/http may import express. If a use case needs it, the boundary has leaked.',
            },
          ],
        },
      ],
    },
  },
  {
    // HTTP is the only layer allowed to know about Express. The named-as-default
    // warnings on express/pino are noise — both packages export a callable
    // default that is the idiomatic import.
    files: ['src/http/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
    },
  },
  {
    // Boot and seed scripts report failures before a logger exists.
    files: ['src/main.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/require-await': 'off' },
  },
  {
    // The composition root is the one place allowed to reach across every layer;
    // that is its entire job.
    files: ['src/container.ts', 'src/main.ts'],
    rules: { 'import-x/no-restricted-paths': 'off' },
  },
];
