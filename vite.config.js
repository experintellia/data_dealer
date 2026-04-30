import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build, defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { buildXDC } from '@webxdc/vite-plugins';

// Serve the @webxdc/vite-plugins simulator with an explicit Content-Type so
// strict-MIME environments (GitHub Codespaces reverse proxy) don't block it.
function mockWebxdc() {
  const src = readFileSync(
    fileURLToPath(new URL('./node_modules/@webxdc/vite-plugins/src/webxdc.js', import.meta.url)),
    'utf-8',
  );
  return {
    name: 'webxdc-mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/webxdc.js') {
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(src);
        } else {
          next();
        }
      });
    },
  };
}

const amdBridgeFooter = `
if (typeof define === 'function' && define.amd) {
  Object.keys(__DD).forEach(function(name) {
    if (name !== '__placeholder') define(name, [], function() { return __DD[name]; });
  });
}`;

// In dev (`vite`), `scripts/esm-bundle.js` doesn't exist as a source file —
// it's only produced by `vite build`.  Without it, the AMD bridge never runs
// and RequireJS falls back to fetching `webxdcIdentity` / `LocalEngine.js`
// as plain scripts, which 404s or trips a "Cannot use import statement"
// error.  This plugin runs the same Rollup pipeline the prod build uses,
// in-memory, and serves the result via middleware.
function bundleEsmDev() {
  let bundleSrc = null;
  let buildPromise = null;

  function rebuild() {
    if (buildPromise) return buildPromise;
    buildPromise = (async () => {
      try {
        const result = await build({
          configFile: false,
          root: process.cwd(),
          logLevel: 'error',
          build: {
            write: false,
            emptyOutDir: false,
            rollupOptions: {
              input: 'scripts/esm-entry.js',
              preserveEntrySignatures: 'exports-only',
              output: {
                format: 'iife',
                name: '__DD',
                entryFileNames: 'esm-bundle.js',
                footer: amdBridgeFooter,
              },
            },
          },
        });
        const out = (Array.isArray(result) ? result[0] : result).output
          .find((o) => o.fileName === 'esm-bundle.js');
        bundleSrc = out ? out.code : null;
      } finally {
        buildPromise = null;
      }
    })();
    return buildPromise;
  }

  return {
    name: 'esm-bundle-dev',
    apply: 'serve',
    async configureServer(server) {
      await rebuild().catch((err) => {
        server.config.logger.error('[esm-bundle-dev] initial build failed: ' + err.message);
      });
      server.watcher.on('change', (file) => {
        if (file.includes('/scripts/') && file.endsWith('.js')) {
          rebuild().catch((err) => {
            server.config.logger.error('[esm-bundle-dev] rebuild failed: ' + err.message);
          });
        }
      });
      server.middlewares.use((req, res, next) => {
        if (req.url === '/scripts/esm-bundle.js' || req.url === '/scripts/esm-bundle.js?') {
          if (!bundleSrc) {
            res.statusCode = 503;
            res.end('// esm-bundle build pending or failed');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
          res.end(bundleSrc);
          return;
        }
        next();
      });
    },
  };
}

const amdScripts = [
  'Game.js', 'Render.js', 'app.js', 'bootstrap.js', 'Remote.js', 'Socket.js',
  'RpcQueue.js', 'i18n.js', 'util.js', 'setup.js', 'setup_local.js', 'setup_beta_local.js',
  'core.js', 'type_settings.js', 'require.config.js',
  // LocalEngine.js is ESM — bundled into esm-bundle.js and registered via
  // the AMD bridge footer; do NOT copy the raw file alongside AMD modules.
].map(f => ({ src: `scripts/${f}`, dest: '' }));

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

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'scripts/esm-entry.js',
      // Preserve entry exports so __DD in the AMD bridge footer can iterate
      // them.  Vite defaults to false which strips all exports and renders
      // the bridge a no-op.
      preserveEntrySignatures: 'exports-only',
      output: {
        format: 'iife',
        name: '__DD',
        entryFileNames: 'scripts/esm-bundle.js',
        footer: amdBridgeFooter,
      },
    },
  },

  plugins: [
    mockWebxdc(),
    bundleEsmDev(),
    viteStaticCopy({
      targets: [
        { src: 'index.html', dest: '' },
        { src: 'manifest.toml', dest: '' },
        { src: 'icon.png', dest: '' },
        { src: 'CREDITS.txt', dest: '' },
        { src: 'LICENSE.txt', dest: '' },
        { src: 'LICENSE-CODE.txt', dest: '' },
        { src: 'LICENSE-ASSETS.txt', dest: '' },
        { src: 'vendor', dest: '' },
        { src: 'css', dest: '' },
        { src: 'img', dest: '' },
        { src: 'font', dest: '' },
        { src: 'views', dest: '' },
        { src: 'data', dest: '' },
        { src: 'i18n', dest: '' },
        ...amdScripts,
      ],
    }),
    buildXDC({ inDir: 'dist', outDir: '.', outFileName: 'data-dealer.xdc' }),
  ],
});
