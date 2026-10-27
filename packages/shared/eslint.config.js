import { withBase } from '@postitup/config/eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(withBase(tseslint.configs.recommended));
