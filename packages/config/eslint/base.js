import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * Rules that apply to every package. The bans here mirror the repository ground
 * rules — the point is that they are mechanically enforced rather than merely
 * documented.
 */
export const baseConfig = tseslint.config(
  { ignores: ['dist/**', 'coverage/**', '.turbo/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    settings: {
      // The TypeScript resolver, not the Node one: source files import
      // `./foo.js` and mean `./foo.ts`, which is what NodeNext ESM requires and
      // what a plain Node resolver cannot follow.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ alwaysTryTypes: true }),
      ],
    },
    rules: {
      // `any` is banned outright; narrow from `unknown` instead.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Non-null assertions hide the exact case noUncheckedIndexedAccess exists
      // to surface. Test files re-enable this (see testOverrides).
      '@typescript-eslint/no-non-null-assertion': 'error',

      // A suppression without a reason is indistinguishable from a mistake.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': { descriptionFormat: '^: .{10,}$' },
          'ts-expect-error': { descriptionFormat: '^: .{10,}$' },
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
      'import-x/no-cycle': 'error',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'no-param-reassign': 'error',
      'prefer-const': 'error',
    },
  },

  prettier,

  {
    // Tooling config files deliberately sit outside every tsconfig, so the
    // type-aware rules have no program to consult and the parser errors. Lint
    // them syntactically rather than excluding them from linting altogether.
    files: ['**/*.config.js', '**/*.config.ts', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: { projectService: false, project: false },
    },
  },
);

/**
 * Tests are allowed the two affordances production code is not: `!` to assert a
 * fixture is present, and `console` for diagnostic output from benchmarks.
 */
export const testOverrides = {
  files: ['**/*.test.ts', '**/*.test.tsx', '**/*.bench.ts', '**/test/**/*.ts'],
  rules: {
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-console': 'off',
  },
};

export default baseConfig;
