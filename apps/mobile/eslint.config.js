// https://docs.expo.dev/guides/using-eslint/
const { withBase } = require('@postitup/config/eslint');
const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig(withBase(expoConfig));
