// Minimal Jest transformer for the page-runtime tests (plain TS → CommonJS via esbuild).
// The native project keeps using jest-expo/babel; the injected runtime is browser code
// and is also bundled by esbuild for production, so tests compile it the same way.
const { transformSync } = require('esbuild');

module.exports = {
  process(source, filename) {
    const { code, map } = transformSync(source, {
      loader: filename.endsWith('x') ? 'tsx' : filename.endsWith('.ts') ? 'ts' : 'js',
      format: 'cjs',
      target: 'es2020',
      sourcemap: 'inline',
      sourcefile: filename,
    });
    return { code, map };
  },
};
