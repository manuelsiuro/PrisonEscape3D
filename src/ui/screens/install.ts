import { installWay, onInstallChange, promptInstall } from '../../app/install';
import { t } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';
import { GAME_URL } from './share';

/** A browser button named in a step, drawn as it looks there. */
const chip = (name: string) => `<span class="ins-chip">${icon(name, 14)}</span>`;
const CHIPS = { share: chip('iosShare'), add: chip('addSquare'), more: chip('dots'), moreH: chip('dotsH'), install: chip('install'), dock: chip('dock') };

/**
 * Install the game: the browser's own install dialog where there is one (Chrome, Edge),
 * otherwise a card with the steps for this browser (Safari on an iPhone: Share, then Add to
 * Home Screen…). Pages opened inside another app, and Firefox on a computer, can't install:
 * the card says to open it in a browser that can, with the link to copy. Escape, the
 * backdrop and Close shut it; it closes by itself once the game is installed.
 */
export async function showInstall(click: () => void): Promise<void> {
  const way = installWay();
  if (!way) return;
  if (way === 'prompt' && (await promptInstall()) !== null) return;
  // (The dialog failed to open: the menu steps for this browser instead.)
  const steps = way === 'prompt' ? installWay() ?? 'desktop' : way;
  if (steps === 'prompt') return;
  const copy = steps === 'inApp' || steps === 'firefox';
  const el = h(
    'div',
    'modal',
    `<div class="card install-card" role="dialog" aria-modal="true" aria-labelledby="install-h">
      <div class="install-head"><img src="./icon-192.png" alt="" width="56" height="56"><div><h2 id="install-h">${t('install.title')}</h2><p class="install-lead">${t(`install.${steps}.lead`)}</p></div></div>
      <ol class="install-steps">${([1, 2, 3] as const).map((n) => `<li><span class="install-n">${n}</span><span>${t(`install.${steps}.${n}`, CHIPS)}</span></li>`).join('')}</ol>
      <p class="install-note">${t(`install.${steps}.note`)}</p>
      ${copy ? `<p class="share-url install-url">${GAME_URL.replace('https://', '')}</p>` : ''}
      <div class="actions">
        <button class="big-btn ${copy ? 'ghost' : 'primary'}" data-c="close">${t(copy ? 'common.close' : 'install.ok')}</button>
        ${copy ? `<button class="big-btn primary" data-c="copy">${icon('link', 18)}<span class="install-copy">${t('share.copy')}</span></button>` : ''}
      </div>
    </div>`,
  );
  return new Promise((resolve) => {
    const done = () => {
      click();
      removeEventListener('keydown', key, true);
      off();
      el.remove();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      done();
    };
    // (Installed meanwhile, from the browser's menu: nothing left to show.)
    const off = onInstallChange(() => installWay() === null && done());
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (c === 'copy') {
        click();
        // (No clipboard, or it refused: the address selected, to copy by hand.)
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(GAME_URL))
          .then(() => (el.querySelector('.install-copy')!.textContent = t('share.copied')))
          .catch(() => getSelection()?.selectAllChildren(el.querySelector('.install-url')!));
      } else if (c === 'close' || e.target === el) done();
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('.actions .primary')?.focus();
  });
}
