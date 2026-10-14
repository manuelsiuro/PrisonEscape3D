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

export default defineConfig({
  // Relative paths: the build works under any GitHub Pages sub-path.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: true },
  // Three.js alone is ~550 kB; one chunk is fine for a game that needs all of it to start.
  build: { chunkSizeWarningLimit: 800 },
  plugins: [versionReload(), serviceWorker()],
});
