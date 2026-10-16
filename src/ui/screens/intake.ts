import { ACHIEVEMENTS } from '../../content/achievements';
import { cleanName, cosmetic, cosmeticsOf, LOOK_PARTS, NAME_MAX, type LookPart, type Prisoner } from '../../content/prisoner';
import { t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

/**
 * The Intake (P16): make your prisoner. A panel beside the 3D preview (your prisoner standing
 * in their cell behind it, turned by dragging): a name, then a part at a time (skin, hair,
 * style, beard, build, hat, glasses, tattoo, trim) as swatches; those still locked say which
 * achievement opens them. Resolves with the prisoner made, or null when cancelled.
 * `onChange` follows every change (the preview), `onTurn` a drag across the picture.
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

export function showIntake(start: Prisoner, opts: IntakeOptions, click: () => void): Promise<Prisoner | null> {
  const p: Prisoner = { name: start.name, look: { ...start.look } };
  let part: LookPart = 'skin';
  const el = h(
    'div',
    'intake',
    `<div class="intake-stage" aria-hidden="true"><span class="intake-turn">${icon('chevronLeft', 16)}${t('intake.turn')}${icon('chevronRight', 16)}</span></div>
    <div class="intake-card" role="dialog" aria-modal="true" aria-labelledby="intake-title">
      <div class="intake-head"><span class="intake-tag">${icon('shirt', 14)}${t('intake.tag')}</span><h2 id="intake-title">${t('intake.title')}</h2></div>
      <label class="intake-name"><span>${t('intake.name')}</span><input type="text" maxlength="${NAME_MAX * 2}" autocomplete="off" spellcheck="false" placeholder="${t('intake.namePh')}"></label>
      <div class="intake-parts" role="tablist">${LOOK_PARTS.map((k) => `<button role="tab" data-part="${k}" aria-label="${t(`part.${k}` as Key)}">${icon(PART_ICON[k], 18)}<span>${t(`part.${k}` as Key)}</span></button>`).join('')}</div>
      <div class="intake-opts" role="radiogroup"></div>
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
      b.classList.toggle('on', b.dataset.part === part);
      b.setAttribute('aria-selected', String(b.dataset.part === part));
    }
    const colour = part === 'skin' || part === 'hair' || part === 'trim';
    opts$.innerHTML = cosmeticsOf(part)
      .map((c) => {
        const open = opts.unlocked.has(c.id);
        const on = p.look[part] === c.id;
        const name = t(`look.${c.id}` as Key);
        const swatch = colour ? (c.color ? `<i class="sw" style="--c:${css(c.color)}"></i>` : '<i class="sw none"></i>') : c.color ? `<i class="sw dot" style="--c:${css(c.color)}"></i>` : '';
        return `<button role="radio" class="opt${on ? ' on' : ''}${open ? '' : ' locked'}${colour ? ' colour' : ''}" data-id="${c.id}" aria-checked="${on}" aria-label="${name}${open ? '' : ` (${t('intake.locked')})`}" title="${name}">${swatch}${colour ? '' : `<span>${name}</span>`}${open ? '' : `<em>${icon('lock', 11)}</em>`}</button>`;
      })
      .join('');
    lockNote.textContent = '';
    opts$.setAttribute('aria-label', t(`part.${part}` as Key));
  };
  const changed = () => opts.onChange({ name: cleanName(input.value), look: { ...p.look } });
  showOpts();
  changed();
  return new Promise((resolve) => {
    const done = (v: Prisoner | null) => {
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        click();
        done(null);
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
    // Arrow keys move along the choices of a part.
    opts$.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      const list = [...opts$.querySelectorAll<HTMLElement>('.opt')];
      const k = list.indexOf(document.activeElement as HTMLElement);
      if (k < 0) return;
      e.preventDefault();
      e.stopPropagation();
      list[(k + step + list.length) % list.length].focus();
    });
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const k = target.closest<HTMLElement>('[data-part]')?.dataset.part as LookPart | undefined;
      if (k) {
        click();
        part = k;
        showOpts();
        // The part chosen in full view (the row scrolls on a phone).
        el.querySelector<HTMLElement>(`[data-part="${k}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }
      const o = target.closest<HTMLElement>('[data-id]');
      if (o) {
        const id = o.dataset.id!;
        if (!opts.unlocked.has(id)) {
          const a = giverOf(id);
          lockNote.textContent = a ? t('intake.lockedBy', { what: t(`look.${id}` as Key), name: t(`ach.${a.id}` as Key) }) : t('intake.locked');
          return;
        }
        click();
        p.look[part] = id;
        showOpts();
        opts$.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();
        return changed();
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
