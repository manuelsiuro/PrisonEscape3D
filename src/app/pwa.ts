/**
 * Installed app (production builds only): registers the offline service
 * worker. A new version downloads in the background; an update waiting at
 * launch takes over right away, and one found while the game is open (from its
 * first moment, not only once the page has loaded) is offered to the player
 * (`onUpdate`), never in the middle of a ride.
 */
export function registerServiceWorker(onUpdate: (version: string | null, restart: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !isSecureContext) return;
  const restart = (worker: ServiceWorker) => () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    worker.postMessage('skipWaiting');
  };
  /** A new worker of this registration, offered once it's installed with a page already controlled. */
  const track = (worker: ServiceWorker | null) =>
    worker?.addEventListener('statechange', async () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdate(await versionOf(worker), restart(worker));
    });
  const watched = new Set<ServiceWorkerRegistration>();
  const watch = (reg: ServiceWorkerRegistration) => {
    if (watched.has(reg)) return;
    watched.add(reg);
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));
  };
  // (2.37) Watched at once, not at the page's load: the browser looks for an update as the page opens, and on a slow
  // phone it was found, or even installed, before the load. Its "updatefound" gone by, it was never offered: the load
  // took it for one waiting from last time and switched to it without a word.
  const early = navigator.serviceWorker
    .getRegistration()
    .then((reg) => {
      // An update found last time is waiting: switch to it now, before anything starts.
      if (reg?.waiting && navigator.serviceWorker.controller) {
        restart(reg.waiting)();
        return true;
      }
      if (reg) watch(reg);
      return false;
    })
    .catch(() => false);
  addEventListener('load', async () => {
    try {
      if (await early) return;
      const reg = await navigator.serviceWorker.register('./sw.js');
      watch(reg);
      // Installed apps stay open for days: look for a new version when it comes back, and now and then.
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      setInterval(check, 30 * 60_000);
    } catch {
      // No offline mode (private window, blocked storage): the game still runs online.
    }
  });
}

/** Asks a waiting worker which game version it brings (null if it doesn't say). */
function versionOf(worker: ServiceWorker): Promise<string | null> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : null);
    setTimeout(() => resolve(null), 1500);
    worker.postMessage('version', [ch.port2]);
  });
}
