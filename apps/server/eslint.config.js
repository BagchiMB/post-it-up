import { withBase } from '@postitup/config/eslint';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  withBase(
    {
      languageOptions: {
        globals: globals.node,
        parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      },
    },
    tseslint.configs.recommendedTypeChecked,
    {
      rules: {
        // Log through src/log.ts (timestamped, never secrets).
        'no-console': 'error',
        '@typescript-eslint/no-floating-promises': [
          'error',
          {
            // node:test's test()/describe() return promises the runner awaits itself.
            allowForKnownSafeCalls: [
              { from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'] },
            ],
          },
        ],
        // `_`-prefixed names are deliberately unused (e.g. omitting keys via rest destructuring).
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
            ignoreRestSiblings: true,
          },
        ],
      },
    },
    {
      // The logger itself, and tests, may write to the console.
      files: ['src/log.ts', 'test/**'],
      rules: { 'no-console': 'off' },
    },
    {
      // Test fetch fakes are `async` to match fetch's signature, even when they don't await.
      files: ['test/**'],
      rules: { '@typescript-eslint/require-await': 'off' },
    },
    {
      files: ['**/*.js'],
      extends: [tseslint.configs.disableTypeChecked],
    },
  ),
);
