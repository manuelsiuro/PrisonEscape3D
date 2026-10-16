import { ACHIEVEMENTS } from '../../content/achievements';
import { cleanName, cosmetic, cosmeticsOf, LOOK_PARTS, NAME_MAX, type LookPart, type Prisoner } from '../../content/prisoner';
import { t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

/**
 * The Intake (P16): make your prisoner. A panel beside the 3D preview (your prisoner standing
 * in their cell behind it, turned by dragging): a name, then a part at a time (skin, hair,
 * style, beard, build, hat, glasses, tattoo, trim) as swatches; those still locked say which
 * achievement opens them. Resolves with the prisoner made, null when cancelled (or skipped,
 * the first time), 'back' when Escape leaves a first Intake (no game: back to the title).
 * `onChange` follows every change (the preview), `onTurn` a drag across the picture.
 * Keyboard: the parts are tabs (arrows switch part), the choices a radio group (arrows choose;
 * a locked one says what opens it), one Tab stop each.
 */
const PART_ICON: Record<LookPart, string> = { skin: 'hand', hair: 'drop', style: 'star', beard: 'chat', build: 'dumbbell', hat: 'home', glasses: 'eye', tattoo: 'heart', trim: 'shirt' };

/** A colour as CSS. */
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** The achievement that gives a cosmetic. */
const giverOf = (id: string) => ACHIEVEMENTS.find((a) => a.gives === id);

export interface IntakeOptions {
  /** The cosmetics open to the player (the rest are shown locked). */
  unlocked: ReadonlySet<string>;
  /** The first time (before a first game): Skip instead of Cancel. */
  first?: boolean;
  onChange: (p: Prisoner) => void;
  onTurn: (radians: number) => void;
}

export function showIntake(start: Prisoner, opts: IntakeOptions, click: () => void): Promise<Prisoner | null | 'back'> {
  const p: Prisoner = { name: start.name, look: { ...start.look } };
  let part: LookPart = 'skin';
  const el = h(
    'div',
    'intake',
    `<div class="intake-stage" aria-hidden="true"><span class="intake-turn">${icon('chevronLeft', 16)}${t('intake.turn')}${icon('chevronRight', 16)}</span></div>
    <div class="intake-card" role="dialog" aria-modal="true" aria-labelledby="intake-title">
      <div class="intake-head"><span class="intake-tag">${icon('shirt', 14)}${t('intake.tag')}</span><h2 id="intake-title">${t('intake.title')}</h2></div>
      <label class="intake-name"><span>${t('intake.name')}</span><input type="text" maxlength="${NAME_MAX * 2}" autocomplete="off" spellcheck="false" placeholder="${t('intake.namePh')}"></label>
      <div class="intake-parts" role="tablist" aria-label="${t('intake.parts')}">${LOOK_PARTS.map((k) => `<button role="tab" id="intake-tab-${k}" aria-controls="intake-pane" data-part="${k}">${icon(PART_ICON[k], 18)}<span>${t(`part.${k}` as Key)}</span></button>`).join('')}</div>
      <div id="intake-pane" role="tabpanel"><div class="intake-opts" role="radiogroup"></div></div>
      <p class="intake-lock" aria-live="polite"></p>
      <div class="intake-actions">
        <button class="big-btn ghost small" data-c="random">${icon('replay', 16)}${t('intake.random')}</button>
        <button class="big-btn ghost small" data-c="cancel">${t(opts.first ? 'intake.skip' : 'common.cancel')}</button>
        <button class="big-btn primary small" data-c="done">${icon('check', 16)}${t('intake.done')}</button>
      </div>
    </div>`,
  );
  const input = el.querySelector<HTMLInputElement>('input')!;
  input.value = p.name;
  const opts$ = el.querySelector<HTMLElement>('.intake-opts')!;
  const lockNote = el.querySelector<HTMLElement>('.intake-lock')!;
  const showOpts = () => {
    for (const b of el.querySelectorAll<HTMLElement>('[data-part]')) {
      const on = b.dataset.part === part;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    el.querySelector('#intake-pane')!.setAttribute('aria-labelledby', `intake-tab-${part}`);
    const colour = part === 'skin' || part === 'hair' || part === 'trim';
    opts$.innerHTML = cosmeticsOf(part)
      .map((c) => {
        const open = opts.unlocked.has(c.id);
        const on = p.look[part] === c.id;
        const name = t(`look.${c.id}` as Key);
        const swatch = colour ? (c.color ? `<i class="sw" style="--c:${css(c.color)}"></i>` : '<i class="sw none"></i>') : c.color ? `<i class="sw dot" style="--c:${css(c.color)}"></i>` : '';
        return `<button role="radio" tabindex="${on ? 0 : -1}" class="opt${on ? ' on' : ''}${open ? '' : ' locked'}${colour ? ' colour' : ''}" data-id="${c.id}" aria-checked="${on}" aria-label="${name}${open ? '' : ` (${t('intake.locked')})`}" title="${name}">${swatch}${colour ? '' : `<span>${name}</span>`}${open ? '' : `<em>${icon('lock', 11)}</em>`}</button>`;
      })
      .join('');
    lockNote.textContent = '';
    opts$.setAttribute('aria-label', t(`part.${part}` as Key));
  };
  const changed = () => opts.onChange({ name: cleanName(input.value), look: { ...p.look } });
  const choosePart = (k: LookPart) => {
    part = k;
    showOpts();
    // The part chosen in full view (the row scrolls on a phone).
    el.querySelector<HTMLElement>(`[data-part="${k}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: document.body.classList.contains('reduced-motion') ? 'auto' : 'smooth' });
  };
  /** A choice: worn (and the preview follows), or, still locked, what opens it. */
  const pick = (id: string) => {
    if (!opts.unlocked.has(id)) {
      const a = giverOf(id);
      for (const b of opts$.querySelectorAll<HTMLElement>('.opt')) b.tabIndex = b.dataset.id === id ? 0 : -1;
      lockNote.textContent = a ? t('intake.lockedBy', { what: t(`look.${id}` as Key), name: t(`ach.${a.id}` as Key) }) : t('intake.locked');
      return;
    }
    click();
    p.look[part] = id;
    showOpts();
    changed();
  };
  showOpts();
  changed();
  return new Promise((resolve) => {
    const done = (v: Prisoner | null | 'back') => {
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        // In the name: out of it only (nothing typed is lost).
        if (e.target === input) return input.blur();
        click();
        done(opts.first ? 'back' : null);
      }
      if (e.code === 'Enter' && e.target === input) {
        e.preventDefault();
        input.blur();
      }
    };
    addEventListener('keydown', key, true);
    // (The name isn't in the picture: the preview isn't rebuilt for it.)
    input.addEventListener('input', () => {
      if ([...input.value].length > NAME_MAX) input.value = cleanName(input.value);
    });
    const stepOf = (e: KeyboardEvent, n: number, k: number) =>
      e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (k + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (k + n - 1) % n : -1;
    // The parts: arrows switch part (the choices follow).
    el.querySelector<HTMLElement>('.intake-parts')!.addEventListener('keydown', (e) => {
      const k = LOOK_PARTS.indexOf(part);
      const j = stepOf(e, LOOK_PARTS.length, k);
      if (j < 0) return;
      e.preventDefault();
      e.stopPropagation();
      click();
      choosePart(LOOK_PARTS[j]);
      el.querySelector<HTMLElement>(`[data-part="${part}"]`)?.focus();
    });
    // The choices: arrows choose (a locked one is only pointed at: it says what opens it).
    opts$.addEventListener('keydown', (e) => {
      const list = [...opts$.querySelectorAll<HTMLElement>('.opt')];
      const k = list.indexOf(document.activeElement as HTMLElement);
      const j = k < 0 ? -1 : stepOf(e, list.length, k);
      if (j < 0) return;
      e.preventDefault();
      e.stopPropagation();
      pick(list[j].dataset.id!);
      opts$.querySelector<HTMLElement>(`[data-id="${list[j].dataset.id}"]`)?.focus();
    });
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const k = target.closest<HTMLElement>('[data-part]')?.dataset.part as LookPart | undefined;
      if (k) {
        click();
        return choosePart(k);
      }
      const o = target.closest<HTMLElement>('[data-id]');
      if (o) {
        pick(o.dataset.id!);
        opts$.querySelector<HTMLElement>(`[data-id="${o.dataset.id}"]`)?.focus();
        return;
      }
      const c = target.closest<HTMLElement>('[data-c]')?.dataset.c;
      if (c === 'random') {
        click();
        // Something open for every part (the name stays).
        for (const k of LOOK_PARTS) {
          const open = cosmeticsOf(k).filter((x) => opts.unlocked.has(x.id));
          p.look[k] = open[Math.floor(Math.random() * open.length)]?.id ?? p.look[k];
        }
        showOpts();
        return changed();
      }
      if (c === 'cancel') {
        click();
        return done(null);
      }
      if (c === 'done') {
        click();
        return done({ name: cleanName(input.value), look: Object.fromEntries(LOOK_PARTS.map((k) => [k, cosmetic(p.look[k]) ? p.look[k] : start.look[k]])) as Prisoner['look'] });
      }
    });
    // Dragging across the picture turns your prisoner round.
    const stage = el.querySelector<HTMLElement>('.intake-stage')!;
    let from: number | null = null;
    stage.addEventListener('pointerdown', (e) => {
      from = e.clientX;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (from === null) return;
      opts.onTurn(((e.clientX - from) / 120) * 1);
      from = e.clientX;
    });
    const up = () => (from = null);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    document.body.append(el);
    el.querySelector<HTMLElement>(`[data-part="${part}"]`)?.focus({ preventScroll: true });
  });
}
