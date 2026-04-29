import { defineConfig } from 'vite';

// Vite is used for the dev server only (pnpm dev).
// Production builds use esbuild.config.js (pnpm build) to avoid running
// legacy CSS and AMD scripts through Vite's bundler / PostCSS pipeline.
export default defineConfig({
  root: '.',
  publicDir: false,

  server: {
    port: 3000,
    open: false,
  },

  preview: {
    port: 3000,
  },

  // Don't let Vite's CSS pipeline touch legacy stylesheets — they predate
  // PostCSS and contain constructs that trip strict CSS parsers.
  css: {
    postcss: { plugins: [] },
    transformer: 'postcss',
  },
});
