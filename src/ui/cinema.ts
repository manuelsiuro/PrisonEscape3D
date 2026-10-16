import { t } from '../i18n';
import { h, TOUCH } from './dom';

/**
 * The escape camera's dressing (P16): letterbox bars slide in, ESCAPED is stamped across the
 * picture, and a tap (or a key) skips to the card. Resolves once the camera is done (`played`),
 * the bars already on their way out. Under reduced motion everything simply appears.
 */
export async function showCinema(played: Promise<void>, skip: () => void, reduced: boolean): Promise<void> {
  const el = h('div', `cinema${reduced ? ' still' : ''}`, `<i class="cine-bar top"></i><i class="cine-bar bottom"></i><b class="cine-stamp"></b><small class="cine-skip"></small>`);
  el.querySelector('.cine-stamp')!.textContent = t('cinema.escaped');
  el.querySelector('.cine-skip')!.textContent = t(TOUCH ? 'cinema.skip' : 'cinema.skipKeys');
  // The picture's dressing: the victory card right after says it all to a screen reader.
  el.setAttribute('aria-hidden', 'true');
  const key = (e: KeyboardEvent) => {
    if (e.repeat) return;
    e.stopImmediatePropagation();
    skip();
  };
  el.addEventListener('pointerdown', skip);
  addEventListener('keydown', key, true);
  document.body.append(el);
  // Nothing of play over the picture meanwhile: the HUD, hints, bubbles and cards step away.
  document.body.classList.add('cinema-on');
  await played;
  document.body.classList.remove('cinema-on');
  removeEventListener('keydown', key, true);
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 450);
}
