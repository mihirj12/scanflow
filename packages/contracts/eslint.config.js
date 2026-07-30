import { baseConfig, testOverrides } from '@scanflow/config/eslint/base';

export default [
  { ignores: ['dist/**', 'coverage/**'] },
  ...baseConfig,
  testOverrides,
];
