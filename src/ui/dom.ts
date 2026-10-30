/** Small DOM helpers shared by the HUD and the screens. */

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};

/** Writes text only when it changed (the HUD updates every frame). */
export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

const ua = navigator.userAgent;
/** A phone or tablet by its own word (iPadOS says "Macintosh" but has a touch screen). */
export const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

/** Phones and tablets: no keyboard, no hover. The `touch` class on body mirrors it. */
export const TOUCH = MOBILE || matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', TOUCH);

/** Fades an element out (its `.leaving` style), then removes it. */
export function fadeOut(el: HTMLElement, ms: number) {
  el.classList.add('leaving');
  setTimeout(() => el.remove(), ms);
}

/** An arrow key in a radio group: +1 (right, down), -1 (left, up), else 0. Taken from the page's keys (they'd walk the player). */
export function arrowStep(e: KeyboardEvent): number {
  const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (d) {
    e.preventDefault();
    e.stopPropagation();
  }
  return d;
}
