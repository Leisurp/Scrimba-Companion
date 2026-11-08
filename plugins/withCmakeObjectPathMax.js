/**
 * Expo config plugin: keep native object-file paths under Windows' 260-character limit.
 *
 * React Native's Gradle setup passes -DCMAKE_OBJECT_PATH_MAX=1024, which disables CMake's
 * own shortening of long object paths. On Windows (ninja without long-path support) the
 * codegen objects of autolinked libraries then exceed MAX_PATH and the build fails with
 * "Filename longer than 260 characters". Re-adding a Windows-safe limit lets CMake hash
 * long object paths. It has no effect on Linux/macOS builds (EAS), where paths are short.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// scrimba-companion: cmake object path max';

module.exports = function withCmakeObjectPathMax(config, { max = 240 } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    const block = `\n        ${MARKER}\n        externalNativeBuild {\n            cmake {\n                arguments "-DCMAKE_OBJECT_PATH_MAX=${max}"\n            }\n        }\n`;
    src = src.replace(/defaultConfig\s*\{/, (m) => `${m}${block}`);
    cfg.modResults.contents = src;
    return cfg;
  });
};
