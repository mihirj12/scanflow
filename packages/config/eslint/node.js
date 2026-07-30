import globals from 'globals';
import tseslint from 'typescript-eslint';

import { baseConfig, testOverrides } from './base.js';

/** Base rules plus Node globals, for anything that runs on a server. */
export const nodeConfig = tseslint.config(
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  testOverrides,
);

export default nodeConfig;
