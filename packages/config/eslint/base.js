// Shared ESLint (flat config) pieces for every workspace.
// Use `withBase(...workspaceConfigs)`: common rules first, the workspace's configs in the middle,
// and eslint-config-prettier last so formatting is left to Prettier.
const prettier = require('eslint-config-prettier/flat');
const simpleImportSort = require('eslint-plugin-simple-import-sort');

/** @type {import('eslint').Linter.Config[]} */
const base = [
  {
    name: '@postitup/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/ios/**',
      '**/android/**',
      '**/data/**',
      '**/coverage/**',
      '**/expo-env.d.ts',
    ],
  },
  {
    name: '@postitup/base',
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
];

/** @param {...(import('eslint').Linter.Config | import('eslint').Linter.Config[])} configs */
function withBase(...configs) {
  return [...base, ...configs.flat(), prettier];
}

module.exports = { base, prettier, withBase };
