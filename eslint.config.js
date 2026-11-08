// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.toolchain/*', 'src/injected/generated/*', 'e2e/test-results/*', 'e2e/report/*', 'coverage/*'],
  },
]);
