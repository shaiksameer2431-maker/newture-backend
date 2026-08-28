const path = require('node:path');
const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '..', 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  external: ['@xenova/transformers'],
  sourcemap: true,
  outfile: path.resolve(__dirname, '..', 'dist', 'server.cjs'),
});
