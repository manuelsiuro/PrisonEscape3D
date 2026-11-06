import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { serviceWorker } from './vite-sw.ts';

const PACKAGE = fileURLToPath(new URL('./package.json', import.meta.url));
const readVersion = () => (JSON.parse(readFileSync(PACKAGE, 'utf8')) as { version: string }).version;

/** The game's version, shown on the title screen (bump it with `npm version` before pushing). */
const version = readVersion();

/** Dev only: a version bump (`npm version`) restarts the server, so the page shows the new one. */
const versionReload = (): Plugin => ({
  name: 'version-reload',
  configureServer(server) {
    server.watcher.add(PACKAGE);
    server.watcher.on('change', (file) => {
      if (file !== PACKAGE || readVersion() === version) return;
      server.config.logger.info(`version ${version} → ${readVersion()}: restarting`, { timestamp: true });
      server.restart();
    });
  },
});

/**
 * The first paint (v2.34.2): the loading screen written in index.html shows before anything else.
 * The game's stylesheet stops holding up the first paint (main.ts keeps the loading screen up until
 * it's in). French is a file of its own (src/i18n/french.ts, loaded by loadLang): for a player who
 * wants it (`__pe3dLang`, set in index.html as src/i18n/index.ts decides), index.html asks for it at once, beside the game's script, rather than after it (only a hint: the
 * game loads it either way).
 */
const firstPaint = (): Plugin => ({
  name: 'first-paint',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const chunk = Object.values(ctx.bundle ?? {}).find((c) => c.type === 'chunk' && c.facadeModuleId?.endsWith('/src/i18n/french.ts'));
      if (!chunk) throw new Error('first-paint: no chunk for src/i18n/french.ts');
      const script = `<script>
      (function () {
        if (window.__pe3dLang !== 'fr') return;
        var l = document.createElement('link');
        l.rel = 'modulepreload';
        l.href = './${chunk.fileName}';
        document.head.appendChild(l);
      })();
    </script>`;
      // The game's styles (made from src/styles/) don't hold up the first paint either: main.ts keeps
      // the loading screen up until they're in.
      const css = /<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)">/;
      if (!css.test(html)) throw new Error("first-paint: the game's stylesheet link isn't where expected");
      return html
        .replace(css, `<link rel="stylesheet" crossorigin href="$1" media="print" onload="this.media = 'all'" onerror="this.media = 'all'" data-game-css>`)
        .replace('</head>', `  ${script}\n  </head>`);
    },
  },
});

export default defineConfig({
  // Relative paths: the build works under any GitHub Pages sub-path.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: true },
  build: {
    // The game's own code is ~1.6 MB before compression, and needs nearly all of it to start.
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        // Three.js in a file of its own: its name (a hash of what's in it) stays the same from one
        // release to the next, so an update doesn't fetch it again (vite-sw.ts keeps what's unchanged).
        // The rest the game starts with in one file (else what the parts fetched later share with it
        // is cut into several); the parts (src/play/lazy.ts) and French in theirs.
        codeSplitting: {
          groups: [
            { name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ },
            { name: 'game', test: /[\\/]src[\\/]/, tags: ['$initial'] },
          ],
        },
      },
    },
  },
  plugins: [versionReload(), serviceWorker(), firstPaint()],
});
