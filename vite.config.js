import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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

const amdScripts = [
  'Game.js', 'Render.js', 'app.js', 'bootstrap.js', 'Remote.js', 'Socket.js',
  'RpcQueue.js', 'i18n.js', 'util.js', 'setup.js', 'setup_local.js', 'setup_beta_local.js',
  'core.js', 'type_settings.js', 'LocalEngine.js', 'require.config.js',
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
    viteStaticCopy({
      targets: [
        { src: 'index.html', dest: '' },
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
  ],
});
