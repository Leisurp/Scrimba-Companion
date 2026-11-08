/**
 * Expo config plugin: optional release signing for local/CI Gradle builds.
 *
 * If the Gradle properties below are provided (e.g. from CI secrets via
 * ORG_GRADLE_PROJECT_* environment variables), release builds are signed with that
 * keystore; otherwise the Expo template's default (debug keystore) is kept, which is
 * installable but cannot be upgraded in place by an APK signed with another key.
 *
 *   SC_RELEASE_STORE_FILE      absolute path to the .jks/.keystore
 *   SC_RELEASE_STORE_PASSWORD
 *   SC_RELEASE_KEY_ALIAS
 *   SC_RELEASE_KEY_PASSWORD
 *
 * EAS builds ignore this and use EAS-managed credentials.
 * Never commit keystores or passwords (see .gitignore).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// scrimba-companion: optional release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    src = src.replace(
      /signingConfigs\s*\{/,
      (m) =>
        `${m}\n        ${MARKER}\n        if (project.hasProperty('SC_RELEASE_STORE_FILE')) {\n            release {\n                storeFile file(project.property('SC_RELEASE_STORE_FILE'))\n                storePassword project.property('SC_RELEASE_STORE_PASSWORD')\n                keyAlias project.property('SC_RELEASE_KEY_ALIAS')\n                keyPassword project.property('SC_RELEASE_KEY_PASSWORD')\n            }\n        }`,
    );
    // Inside buildTypes.release, prefer the release config when it exists.
    src = src.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      (_m, head) => `${head}signingConfig project.hasProperty('SC_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
};
