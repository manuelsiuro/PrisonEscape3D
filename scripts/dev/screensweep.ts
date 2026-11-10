// Dev tool, run in the browser on the dev server: the screen-size sweep (session 8). `audit()` reads the
// layout of what's on screen and lists what a player would trip on; `menus()` and `moments()` bring up
// every screen and every moment of play (How to play's staged moments, the HUD shown) and audit each.
// The viewport is the browser's (chrome-devtools `emulate`): one size per run.
//   const s = await import('/scripts/dev/screensweep.ts');
//   s.audit('here');                 // what's on screen now
//   await s.menus();                 // the title and every screen it opens
//   await s.moments();               // every staged moment of play, with its HUD and cards (the title
//                                    // goes for good: reload after)
// What it flags, each with the element and its box:
//   off      a button or a line of text out of the window (not inside something that scrolls)
//   cut      text clipped by its box (scrolling and a one-line ellipsis on purpose are told apart)
//   ellipsis text cut short with "…" (fine for a long name; not for a label or an instruction)
//   overlap  two buttons on top of each other, or a button under something else where it's pressed
//   small    a button under 32×32 on a touch screen, a clear margin around it counted (44 recommended),
//            text under 10px (both in the screen's points: the interface scaled up, its scale counted)
//   scroll   the page itself scrolls sideways or down (the game never should)
//   scrolled a button of a card in play reached only by scrolling the card (dialogs' and panels' lists aside)
// `lessonCards()` (2.39.1): every step of every lesson, in both languages, in the lesson's card in play, measured against
// the hotbar and the window (a phone turned in Chrome, 915×274, is where they ran under it).
import { currentLang, loadLang, setLang, t, type Key } from '../../src/i18n';
import { play } from '../../src/play/game';
import { chapterOf, LESSONS } from '../../src/tutorial/lessons';
import { icon } from '../../src/ui/icons';
import { fitLessonCard } from '../../src/ui/lessonCard';

export type Issue = { scene: string; kind: string; what: string; box: string; note?: string };

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [data-c], [tabindex]:not([tabindex="-1"])';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = (n: number) =>
  new Promise<void>((done) => {
    const go = (k: number) => (k ? requestAnimationFrame(() => go(k - 1)) : done());
    go(n);
  });

function shown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
  }
  return true;
}

function label(el: Element): string {
  const cls = [...el.classList].slice(0, 3).join('.');
  const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${txt ? ` "${txt}"` : ''}`;
}
const boxOf = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;

/** The nearest ancestor that scrolls (its content reachable), if any. */
function scroller(el: Element): Element | null {
  for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1))
      return e;
  }
  return null;
}

/** Text the element shows itself (not only through its children). */
const ownText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);

/** The layer being looked at: the top dialog when one is up, else the page. */
function layer(): Element {
  const modals = [...document.querySelectorAll('.modal, [role="dialog"]')].filter(shown);
  return modals.length ? modals[modals.length - 1] : document.body;
}

export function audit(scene: string): Issue[] {
  // (Sizes on the screen: with the interface scaled up (session 9, app/scale.ts) a CSS pixel is that many points.)
  const Z = visualViewport?.scale ?? 1;
  const out: Issue[] = [];
  const W = innerWidth;
  const H = innerHeight;
  const add = (kind: string, el: Element, note?: string) =>
    out.push({ scene, kind, what: label(el), box: boxOf(el.getBoundingClientRect()), note });
  const se = document.scrollingElement!;
  if (se.scrollWidth > W + 1)
    out.push({ scene, kind: 'scroll', what: 'page', box: `${se.scrollWidth}×${se.scrollHeight}`, note: 'sideways' });
  if (se.scrollHeight > H + 1) out.push({ scene, kind: 'scroll', what: 'page', box: `${se.scrollWidth}×${se.scrollHeight}`, note: 'down' });
  const root = layer();
  const all = [...root.querySelectorAll('*')].filter((e) => !e.closest('canvas, svg *, .sr-only, [aria-hidden="true"]') && shown(e));
  const touch = matchMedia('(pointer: coarse)').matches;
  const buttons = all.filter((e) => e.matches(INTERACTIVE) && !e.parentElement?.closest(INTERACTIVE));
  const texts = all.filter((e) => ownText(e));

  // Off the window.
  for (const e of new Set([...buttons, ...texts])) {
    const r = e.getBoundingClientRect();
    const outside = r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1;
    if (!outside) continue;
    const sc = scroller(e);
    if (sc) {
      const s = sc.getBoundingClientRect();
      if (s.left >= -1 && s.top >= -1 && s.right <= W + 1 && s.bottom <= H + 1) continue; // reachable by scrolling
    }
    add('off', e, `window ${W}×${H}`);
  }
  // A button out of sight in a card of play that scrolls (not a dialog's list): in the middle of a song or
  // a hand, scrolling to reach it is too late (talent night's Stop was there).
  for (const e of buttons) {
    const sc = scroller(e);
    // (A card of play: the title and the dialogs scroll on a short screen by design.)
    if (!sc || !sc.closest('.train-card')) continue;
    const r = e.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    // (Mostly in sight is fine: a finger finds it.)
    const seen = Math.max(0, Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top));
    if (seen < r.height * 0.6)
      add('scrolled', e, `in ${label(sc).split(' ')[0]}, ${Math.round(seen)} of ${Math.round(r.height)} px in sight`);
  }

  // Clipped text.
  for (const e of texts) {
    const el = e as HTMLElement;
    const cs = getComputedStyle(el);
    const clipsX = /(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const clipsY = /(hidden|clip)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && cs.webkitLineClamp === 'none';
    if (clipsX && cs.textOverflow === 'ellipsis') add('ellipsis', el);
    else if (clipsX || clipsY) add('cut', el, `${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`);
    else if (cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 2) add('ellipsis', el, 'line clamp');
    // A child poking out of a box that hides overflow, cut by it.
    const p = el.parentElement;
    if (p) {
      const pcs = getComputedStyle(p);
      if (/(hidden|clip)/.test(pcs.overflowX + pcs.overflowY) && !scroller(el)) {
        const r = el.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 2 || r.bottom > pr.bottom + 2 || r.left < pr.left - 2)
          add('cut', el, `out of its ${label(p).split(' ')[0]}`);
      }
    }
    const fs = parseFloat(cs.fontSize) * Z;
    if (fs < 10) add('small', el, `text ${fs}px`);
  }

  // Buttons: under something else, overlapping each other, too small to hit.
  for (const e of buttons) {
    const r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    // (Its middle out of the window, or out of what scrolls it: scrolled away, tested when scrolled to.)
    const sc = scroller(e)?.getBoundingClientRect();
    const inSight = cx >= 0 && cy >= 0 && cx < W && cy < H && (!sc || (cx >= sc.left && cx <= sc.right && cy >= sc.top && cy <= sc.bottom));
    const hit = inSight ? document.elementFromPoint(cx, cy) : null;
    if (hit && hit !== e && !e.contains(hit) && !hit.contains(e) && getComputedStyle(e).pointerEvents !== 'none')
      add('overlap', e, `under ${label(hit)}`);
    if (touch) {
      // (A clear margin drawn by ::before/::after, inset below zero, takes touches too.)
      let w = r.width;
      let ht = r.height;
      for (const p of ['::before', '::after']) {
        const cs = getComputedStyle(e, p);
        if (cs.content === 'none' || cs.position !== 'absolute') continue;
        const px = (v: string) => Math.max(0, -(parseFloat(v) || 0));
        w = Math.max(w, r.width + px(cs.left) + px(cs.right));
        ht = Math.max(ht, r.height + px(cs.top) + px(cs.bottom));
      }
      w *= Z;
      ht *= Z;
      if ((w < 31.5 || ht < 31.5) && !e.closest('p, li > span')) add('small', e, `target ${Math.round(w)}×${Math.round(ht)}`);
    }
  }
  // (A box that lets touches through counts only where its children take them.)
  const areas = (e: Element): DOMRect[] =>
    getComputedStyle(e).pointerEvents === 'none'
      ? [...e.children].filter((c) => shown(c) && getComputedStyle(c).pointerEvents !== 'none').map((c) => c.getBoundingClientRect())
      : [e.getBoundingClientRect()];
  for (let i = 0; i < buttons.length; i++)
    for (let j = i + 1; j < buttons.length; j++) {
      if (buttons[i].contains(buttons[j]) || buttons[j].contains(buttons[i])) continue;
      for (const a of areas(buttons[i]))
        for (const b of areas(buttons[j])) {
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 4 && oy > 4) add('overlap', buttons[i], `over ${label(buttons[j])} by ${Math.round(ox)}×${Math.round(oy)}`);
        }
    }
  return out;
}

// ------------------------------------------------------------------------------------------------ menus

const click = async (sel: string, ms = 900) => {
  const b = document.querySelector<HTMLElement>(sel);
  if (!b) return false;
  b.click();
  await wait(ms);
  return true;
};
const escape = async () => {
  for (const t of [document.activeElement ?? document.body, window])
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  await wait(700);
};
/** Closes whatever dialog is up (its close button, else Escape). */
async function close() {
  const x = [
    ...document.querySelectorAll<HTMLElement>('.modal [data-c="close"], .modal .close, .modal [data-c="back"], .modal [aria-label]'),
  ]
    .filter(shown)
    .pop();
  if (x && /close|back|fermer|retour/i.test((x.dataset.c ?? '') + (x.getAttribute('aria-label') ?? '') + x.className)) {
    x.click();
    await wait(700);
  } else await escape();
}

/** Each step brings a screen up; audited, then closed back to the title. */
export async function menus(): Promise<Issue[]> {
  const out: Issue[] = [];
  const at = (s: string) => out.push(...audit(s));
  if (play.game) await escape();
  at('title');
  if (await click('button[data-c="settings"]')) {
    at('settings');
    await close();
  }
  if (await click('button[data-c="help"]')) {
    at('help');
    const tile = document.querySelector<HTMLElement>('.help-tile');
    if (tile) {
      tile.click();
      await wait(800);
      at('help topic (first)');
      const tiles = document.querySelectorAll<HTMLElement>('.hd-link');
      tiles[tiles.length - 1]?.click();
      await wait(800);
      at('help topic (linked)');
    }
    await close();
    if (document.querySelector('.modal')) await close();
  }
  if (await click('button[data-c="trophies"]')) {
    const tabs = [...document.querySelectorAll<HTMLElement>('.modal [role="tab"], .modal .tab')].filter(shown);
    if (!tabs.length) at('trophies');
    for (const t of tabs) {
      t.click();
      await wait(500);
      at(`trophies: ${(t.textContent ?? '').trim()}`);
    }
    await close();
  }
  if (await click('button[data-c="tutorial"]')) {
    at('lessons');
    await close();
  }
  if (await click('button[data-c="daily"]')) {
    at('daily');
    await close();
  }
  if (await click('button[data-c="load"]')) {
    at('load');
    await close();
  }
  if (await click('button[data-c="play"]')) {
    at('new game: prisons');
    const first = document.querySelector<HTMLElement>('.modal [data-c]:not([data-c="close"]):not([data-c="back"])');
    if (first) {
      first.click();
      await wait(1200);
      at('new game: next');
    }
    while (document.querySelector('.modal')) await close();
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ play

/** Every How to play moment, staged with its HUD and cards up, audited. `ids` to pick some. */
export async function moments(ids?: string[]): Promise<Issue[]> {
  const hs = await import('./helpshot');
  const out: Issue[] = [];
  const list = ids ?? Object.keys(hs.SHOTS);
  // (As playat does: the title taken away for good, a reload brings it back.)
  document.querySelector('.title-screen')?.remove();
  for (const id of list) {
    try {
      // (A moment that ends in an escape leaves its card up: gone before the next.)
      document.querySelectorAll('.modal').forEach((m) => m.remove());
      await hs.stage(id);
      hs.hideUi(false);
      await frames(10);
      out.push(...audit(`moment: ${id}`));
    } catch (e) {
      out.push({ scene: `moment: ${id}`, kind: 'error', what: String(e).slice(0, 120), box: '' });
    }
  }
  hs.done();
  return out;
}

/** The issues counted by kind and listed once each (the same element on many scenes: one line, its scenes). */
export function summary(list: Issue[]) {
  const by = new Map<string, { kind: string; what: string; note?: string; box: string; scenes: string[] }>();
  for (const i of list) {
    const k = `${i.kind}|${i.what}|${i.note ?? ''}`;
    const e = by.get(k) ?? { kind: i.kind, what: i.what, note: i.note, box: i.box, scenes: [] };
    e.scenes.push(i.scene);
    by.set(k, e);
  }
  const kinds: Record<string, number> = {};
  for (const e of by.values()) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  return { size: `${innerWidth}×${innerHeight}`, touch: matchMedia('(pointer: coarse)').matches, kinds, issues: [...by.values()] };
}

/** Both sweeps at this size, grouped by kind and element (its classes), with a line each: for reading many sizes. */
export async function sweep() {
  const list = [...(await menus()), ...(await moments())];
  const by = new Map<string, { n: number; scenes: Set<string>; sample: Issue }>();
  for (const i of list) {
    const k = `${i.kind} ${i.what.split(' ')[0]} ${i.kind === 'small' ? (i.note ?? '').split(' ')[0] : ''}`;
    const e = by.get(k) ?? { n: 0, scenes: new Set<string>(), sample: i };
    e.n++;
    e.scenes.add(i.scene);
    by.set(k, e);
  }
  return {
    size: `${innerWidth}×${innerHeight}${matchMedia('(pointer: coarse)').matches ? ' touch' : ''}${(visualViewport?.scale ?? 1) > 1.01 ? ` at ${Math.round(visualViewport!.scale * 100)}%` : ''}`,
    lines: [...by]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([k, e]) =>
          `${k} ×${e.n} [${[...e.scenes].slice(0, 4).join('; ')}${e.scenes.size > 4 ? '; …' : ''}] e.g. ${e.sample.what} ${e.sample.note ?? ''} @${e.sample.box}`,
      ),
  };
}

/**
 * Every lesson step's text (and its touch variant) in the lesson's card, in English and French, at this size: those whose
 * card runs under the hotbar (where the two overlap across) or out of the window, by how many px, and how many the game
 * lifts over the routine pill to fit (a phone turned, `fitLessonCard`); `mode`, a game's own card layout's body class to
 * measure in (never lifted there). A game must be on
 * screen (`playat.at(...)` first, or `moments()`); the card is put back hidden after.
 */
export async function lessonCards(mode = ''): Promise<{ size: string; steps: number; lifted: number; over: string[] }> {
  // (The HUD comes up a moment after the game does.)
  for (let k = 0; k < 30 && !(document.querySelector('.coach.lesson-coach') && document.querySelector('.hotbar')); k++) await wait(100);
  const card = document.querySelector<HTMLElement>('.coach.lesson-coach');
  const bar = document.querySelector<HTMLElement>('.hotbar');
  if (!card || !bar) throw new Error('no game on screen: playat.at(...) first');
  const was = currentLang();
  const hidden = card.classList.contains('hidden');
  const before = card.innerHTML;
  card.classList.remove('hidden');
  // (Where it settles: its slide-in, just restarted, would put it lower for the first frames.)
  card.style.animation = 'none';
  document.body.classList.add('lesson-on');
  // (`mode`: a game's own card layout to measure in, its body class: 'inking', 'phoning'…)
  if (mode) document.body.classList.add(mode);
  const over: string[] = [];
  let steps = 0;
  let lifted = 0;
  for (const lang of ['en', 'fr'] as const) {
    await loadLang(lang);
    setLang(lang);
    LESSONS.forEach((lesson, k) => {
      const c = chapterOf(k);
      for (const s of lesson.steps)
        for (const key of [s.text, s.touch]) {
          if (!key) continue;
          steps++;
          card.innerHTML = `<span class="coach-ic">${icon('bulb', 18)}</span><span class="coach-text"><small>${t(`chapter.${c.id}` as Key)} · ${t('lesson.of', { n: c.n, of: c.of })} · ${t(`lesson.${lesson.id}.t` as Key)}</small><b>${t(key)}</b><span class="lesson-dots">${'<i></i>'.repeat(lesson.steps.length)}</span></span>`;
          // (Where the game puts it: lifted over the routine pill when it wouldn't fit under it.)
          fitLessonCard(card);
          const r = card.getBoundingClientRect();
          const h = bar.getBoundingClientRect();
          if (document.body.classList.contains('lesson-high')) lifted++;
          const across = h.width > 0 && r.right > h.left && r.left < h.right;
          const by = Math.round(r.bottom - (across ? Math.min(h.top, innerHeight) : innerHeight));
          if (by > 0) over.push(`${by}px ${lang} ${key}`);
        }
    });
  }
  setLang(was);
  card.innerHTML = before;
  card.style.animation = '';
  document.body.classList.remove('lesson-high');
  if (mode) document.body.classList.remove(mode);
  card.classList.toggle('hidden', hidden);
  if (hidden) document.body.classList.remove('lesson-on');
  over.sort((a, b) => parseInt(b) - parseInt(a));
  return { size: `${innerWidth}×${innerHeight}`, steps, lifted, over };
}
