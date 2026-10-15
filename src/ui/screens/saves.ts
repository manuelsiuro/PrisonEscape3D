import { ALL_SLOTS, HAND_SLOTS, deleteSave, readSave, type SaveFile, type SlotId } from '../../game/saves';
import { currentLang, t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

const pad = (n: number) => String(n).padStart(2, '0');

/** "Stalag Flucht · Day 3 · 14:20 · Laundry": which prison, when and where a save was made. */
export function saveWhen(f: SaveFile): string {
  return `${t(`prison.${f.prison}` as Key)} · ${t('hud.day', { n: f.day })} · ${pad(Math.floor(f.minute / 60))}:${pad(f.minute % 60)} · ${t(`zone.${f.zone}` as Key)}`;
}

/** "5 minutes ago", in the game's language. */
function ago(at: number): string {
  const s = Math.round((at - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(currentLang(), { numeric: 'auto' });
  const a = Math.abs(s);
  if (a < 45) return rtf.format(0, 'second');
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

/**
 * The saved games, to load one (the game in progress and the three slots) or to save the
 * game into a slot (from the pause card). A slot already in use asks again before it's
 * overwritten; deleting asks again too. Resolves with the slot picked, or null when closed.
 */
export function showSaves(mode: 'load' | 'save', click: () => void): Promise<SlotId | null> {
  const el = h('div', 'modal saves-modal');
  const slots = mode === 'load' ? ALL_SLOTS : HAND_SLOTS;
  /** The slot waiting for a second press (to overwrite, or to delete). */
  let armed: { slot: SlotId; what: 'over' | 'del' } | null = null;
  const render = () => {
    const rows = slots
      .map((slot) => {
        const f = readSave(slot);
        const name = slot === 'auto' ? t('saves.auto') : t('saves.slot', { n: slot });
        const over = armed?.slot === slot && armed.what === 'over';
        const del = armed?.slot === slot && armed.what === 'del';
        const ic = slot === 'auto' ? 'replay' : f ? 'save' : 'folder';
        const sub = f ? `<small>${saveWhen(f)}</small><small class="save-ago">${over ? t('saves.overwrite') : ago(f.at)}</small>` : `<small>${t('saves.empty')}</small>`;
        const usable = mode === 'save' || !!f;
        return `<div class="save-row${f ? '' : ' empty'}${over ? ' armed' : ''}">
          <button class="save-main" data-slot="${slot}" ${usable ? '' : 'disabled'}>
            <span class="save-ic">${icon(ic, 20)}</span>
            <span class="save-text"><b>${name}</b>${sub}</span>
          </button>
          ${f && mode === 'load' ? `<button class="save-del${del ? ' armed' : ''}" data-del="${slot}" aria-label="${t('saves.delete')}">${icon('trash', 18)}${del ? `<span>${t('saves.deleteSure')}</span>` : ''}</button>` : ''}
        </div>`;
      })
      .join('');
    el.innerHTML = `<div class="card saves-card" role="dialog" aria-modal="true" aria-labelledby="saves-title">
      <div class="settings-head"><h2 id="saves-title">${t(mode === 'load' ? 'saves.loadTitle' : 'saves.saveTitle')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
      <p class="card-note">${t(mode === 'load' ? 'saves.loadNote' : 'saves.saveNote')}</p>
      <div class="save-list">${rows}</div>
    </div>`;
  };
  render();
  return new Promise((resolve) => {
    const done = (slot: SlotId | null) => {
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(slot);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      click();
      done(null);
    };
    addEventListener('keydown', key, true);
    const slotOf = (v: string): SlotId => (v === 'auto' ? 'auto' : (Number(v) as SlotId));
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) {
        click();
        return done(null);
      }
      const d = target.closest<HTMLElement>('[data-del]');
      if (d) {
        click();
        const slot = slotOf(d.dataset.del!);
        if (armed?.slot === slot && armed.what === 'del') {
          deleteSave(slot);
          armed = null;
        } else armed = { slot, what: 'del' };
        return render();
      }
      const b = target.closest<HTMLButtonElement>('[data-slot]');
      if (!b || b.disabled) return;
      click();
      const slot = slotOf(b.dataset.slot!);
      // Saving over a game asks once more.
      if (mode === 'save' && readSave(slot) && !(armed?.slot === slot && armed.what === 'over')) {
        armed = { slot, what: 'over' };
        return render();
      }
      done(slot);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('.save-main:not([disabled])')?.focus();
  });
}
