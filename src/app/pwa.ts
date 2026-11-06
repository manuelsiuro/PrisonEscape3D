/**
 * Installed app (production builds only): registers the offline service
 * worker. A new version downloads in the background; an update waiting at
 * launch takes over right away, and one found while the game is open is
 * offered to the player (`onUpdate`), never in the middle of a ride.
 */
export function registerServiceWorker(onUpdate: (version: string | null, restart: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !isSecureContext) return;
  const restart = (worker: ServiceWorker) => () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    worker.postMessage('skipWaiting');
  };
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // An update found last time is waiting: switch to it now, before anything starts.
      if (reg.waiting && navigator.serviceWorker.controller) {
        restart(reg.waiting)();
        return;
      }
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', async () => {
          // "installed" with a page already controlled: a new version is ready and waiting.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdate(await versionOf(worker), restart(worker));
        });
      });
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
