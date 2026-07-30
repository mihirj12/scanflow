/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['api', 'web', 'core', 'contracts', 'config', 'db', 'ci', 'docs', 'repo'],
    ],
  },
};
