/**
 * Vite configuration of the example playground.
 *
 * It serves `examples/` during development and builds a static example site.
 *
 * The library build is *not* configured here: `scripts/build.mjs` drives the eight
 * published bundles through Vite's JavaScript API.
 *
 * @see {@link file://./scripts/build.mjs}
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;
const examples = resolve(root, 'examples');

export default defineConfig({
  // relative asset urls, so the built site also works from a repository sub path
  base: './',
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      input: resolve(examples, 'index.html'),
    },
    sourcemap: true,
  },
  root: 'examples',
  server: {
    open: '/',
    port: 5173,
  },
});
