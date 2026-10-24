/**
 * Installing the game as an app. Chrome, Edge and Samsung Internet offer their own install
 * dialog (`beforeinstallprompt`, caught early by index.html); everywhere else it's a step in
 * the browser's menus that players don't find alone, so the title screen shows the steps for
 * the browser they're in (`installWay`).
 */

/** Chrome's install event (not in TypeScript's DOM types). */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * How this browser installs the game:
 * - `prompt`: its own install dialog, ready to open;
 * - `ios`: Safari on an iPhone or iPad (Share, then Add to Home Screen);
 * - `iosOther`: Chrome, Edge or Firefox on an iPhone or iPad (the same, from their Share button);
 * - `inApp`: a page opened inside another app (WhatsApp, Instagram…), which can't install: open it in the browser first;
 * - `android`: an Android browser without the dialog (Firefox, a custom tab, the dialog already dismissed): its menu;
 * - `macSafari`: Safari on a Mac (File, then Add to Dock);
 * - `firefox`: Firefox on a computer, which doesn't install web apps;
 * - `desktop`: Chrome or Edge on a computer without the dialog yet: the icon in the address bar or the menu.
 */
export type InstallWay = 'prompt' | 'ios' | 'iosOther' | 'inApp' | 'android' | 'macSafari' | 'firefox' | 'desktop';

let deferred: InstallPrompt | null = (window as { __pe3dInstall?: InstallPrompt }).__pe3dInstall ?? null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
let justInstalled = false;

addEventListener('beforeinstallprompt', (e) => {
  deferred = e as InstallPrompt;
  changed();
});
addEventListener('appinstalled', () => {
  deferred = null;
  justInstalled = true;
  changed();
});

/** Running as the installed app (or just installed from this page). */
export function isInstalled(): boolean {
  return (
    justInstalled ||
    (navigator as { standalone?: boolean }).standalone === true ||
    matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches
  );
}

/** How to install here, or null once it's installed. */
export function installWay(): InstallWay | null {
  if (isInstalled()) return null;
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // In-app browsers: Facebook, Instagram, TikTok, Snapchat, LINE, WeChat, X, the Google app, Android web views.
  if (/FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|TikTok|Snapchat|Line\/|MicroMessenger|Twitter|GSA\//.test(ua) || /; wv\)/.test(ua)) return 'inApp';
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'iosOther' : 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'macSafari';
  return 'desktop';
}

/** Opens the browser's own install dialog; whether the player said yes (null: no dialog to open). */
export async function promptInstall(): Promise<boolean | null> {
  const e = deferred;
  if (!e) return null;
  // (One use per event: the browser sends a new one if the player may still install.)
  deferred = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    changed();
    return outcome === 'accepted';
  } catch {
    changed();
    return null;
  }
}

/** Called when installing becomes possible, is used up, or is done; returns the unsubscribe. */
export function onInstallChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
