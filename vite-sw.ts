import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/** Every file in a folder, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/**
 * Writes `sw.js` after the build: a service worker that stores the whole
 * game on the device (so the installed app plays offline). Its cache is
 * named after a hash of the build, so a new deploy replaces it.
 */
export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const out = config.build.outDir;
      const files = walk(out)
        .map((f) => relative(out, f).split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256').update(SW);
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const version = hash.digest('hex').slice(0, 12);
      const assets = ['./', ...files.map((f) => `./${f}`)];
      const app = JSON.parse(readFileSync(join(config.root, 'package.json'), 'utf8')).version as string;
      writeFileSync(join(out, 'sw.js'), SW.replace('__VERSION__', version).replace('__APP__', app).replace('__ASSETS__', JSON.stringify(assets)));
    },
  };
}

const SW = `// Generated at build time (vite-sw.ts).
const CACHE = 'pe3d-__VERSION__';
/** The game version this worker serves (shown in the "new version" banner). */
const APP = '__APP__';
const FONTS = 'pe3d-fonts';
const ASSETS = __ASSETS__;

/** The files a stored index.html loads (./assets/…), which must be stored with it. */
const refsOf = (html) => [...html.matchAll(/(?:src|href)="\\.\\/(assets\\/[^"]+)"/g)].map((m) => './' + m[1]);

/** A stored copy is whole when its index.html and everything it loads are in it. */
async function whole(cache) {
  const page = await cache.match('./index.html');
  if (!page) return false;
  for (const ref of refsOf(await page.text())) if (!(await cache.match(ref))) return false;
  return true;
}

// Install: store this build, fresh from the server. The HTTP cache (Pages keeps pages for
// 10 minutes) could hand back the previous build's index.html, whose files a deploy has
// deleted: a blank page. So every file skips it (and the CDN, with a version tag), and
// the copy is checked whole before it's used.
self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of ASSETS) {
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'sw=' + CACHE, { cache: 'reload' });
        if (!res.ok) throw new Error('could not store ' + url);
        await cache.put(url, res);
      }
      if (!(await whole(cache))) throw new Error('the stored build is not whole');
      // The copy players run now is broken (a blank page): take over at once instead of waiting.
      for (const key of await caches.keys()) {
        if (key.startsWith('pe3d-') && key !== CACHE && key !== FONTS && !(await whole(await caches.open(key)))) {
          self.healing = true;
          await self.skipWaiting();
        }
      }
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pe3d-') && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(async () => {
        // Pages left blank by a broken copy load again from this one.
        if (!self.healing) return;
        for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
      }),
  );
});

// The page asks for a waiting update to take over (right after it loads, or when the player restarts).
// The page asks a waiting update which version it brings (answered on the given port).
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  else if (e.data === 'version' && e.ports[0]) e.ports[0].postMessage(APP);
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // The game itself: from the device first (it's a fixed build), the network as a fallback.
    // ignoreVary: module scripts send an Origin header the stored copies were fetched without.
    const key = req.mode === 'navigate' ? './index.html' : req;
    e.respondWith(caches.open(CACHE).then((c) => c.match(key, { ignoreSearch: req.mode === 'navigate', ignoreVary: true })).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Fonts: the stored copy right away, refreshed in the background.
    e.respondWith(
      caches.open(FONTS).then((c) =>
        c.match(req, { ignoreVary: true }).then((hit) => {
          const fresh = fetch(req)
            .then((res) => {
              if (res.ok || res.type === 'opaque') c.put(req, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || fresh;
        }),
      ),
    );
  }
});
`;
