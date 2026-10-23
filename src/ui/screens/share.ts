import { t } from '../../i18n';
import { TOUCH, h } from '../dom';
import { icon } from '../icons';

/** The game online: what the QR code says (public/share-qr.png, drawn once from this address). */
export const GAME_URL = 'https://manuelsiuro.github.io/PrisonEscape3D/';

/**
 * Share the game: its QR code to scan with a phone, the address, and a button that opens the
 * phone's share sheet (Web Share) or copies the link on a desktop. Escape, the backdrop and
 * Close shut it.
 */
export function showShare(click: () => void): Promise<void> {
  const sheet = TOUCH && !!navigator.share;
  const el = h(
    'div',
    'modal',
    `<div class="card share-card" role="dialog" aria-modal="true" aria-labelledby="share-h">
      <h2 id="share-h">${t('share.title')}</h2>
      <p class="share-scan">${t('share.scan')}</p>
      <div class="share-qr"><img src="./share-qr.png" alt="${t('share.qr')}" width="246" height="246" decoding="async"></div>
      <div class="share-foot">
        <p class="share-url">${GAME_URL.replace('https://', '')}</p>
        <div class="actions">
          <button class="big-btn ghost" data-c="close">${t('common.close')}</button>
          <button class="big-btn primary" data-c="send">${icon(sheet ? 'share' : 'link', 18)}<span class="share-label">${t(sheet ? 'share.send' : 'share.copy')}</span></button>
        </div>
      </div>
    </div>`,
  );
  const label = el.querySelector('.share-label')!;
  return new Promise((resolve) => {
    const done = () => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      done();
    };
    let busy = false;
    const go = async () => {
      // (One at a time: a second tap while the share sheet is up would fail and fall to the clipboard.)
      if (busy) return;
      busy = true;
      click();
      try {
        await send();
      } finally {
        busy = false;
      }
    };
    const send = async () => {
      try {
        if (sheet) {
          await navigator.share({ title: 'Prison Escape 3D', text: t('title.tagline'), url: GAME_URL });
          label.textContent = t('share.shared');
          return;
        }
      } catch (e) {
        // (Closed without sharing: nothing to say.)
        if ((e as Error)?.name === 'AbortError') return;
      }
      try {
        await navigator.clipboard.writeText(GAME_URL);
        label.textContent = t('share.copied');
      } catch {
        // (No clipboard: the address selected, to copy by hand.)
        getSelection()?.selectAllChildren(el.querySelector('.share-url')!);
      }
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (c === 'send') void go();
      else if (c === 'close' || e.target === el) done();
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="send"]')?.focus();
  });
}
