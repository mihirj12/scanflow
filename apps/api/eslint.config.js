import { nodeConfig } from '@scanflow/config/eslint/node';

export default [
  { ignores: ['dist/**', 'coverage/**'] },
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
    // The composition root is the one place allowed to reach across every layer;
    // that is its entire job.
    files: ['src/container.ts', 'src/main.ts'],
    rules: { 'import-x/no-restricted-paths': 'off' },
  },
];
