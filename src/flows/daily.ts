import { dailyNumber, dailyOf } from '../content/daily';
import { dailyRecord, dailyTry, streakOf } from '../game/daily';
import { deleteSave, loadSave, readSave, rebuiltSince } from '../game/saves';
import { readLog } from '../game/logs';
import { t } from '../i18n';
import { prisonName } from '../ui/screens/prisons';
import { Sim } from '../sim/Sim';
import { ask } from '../ui/screens/ask';
import { showDaily } from '../ui/screens/daily';
import { saveWhen } from '../ui/screens/saves';
import { banner, click, view } from '../play/context';
import { startGame, untilQuit } from '../play/session';
import { takeDailyAgain } from '../play/daily';

/**
 * The Daily Escape from the title (P26): its card, and from it a try (a new game of the Daily's
 * prison, seed and twists) or its saved run; after a try, straight into the next one when the
 * player asked for it. Resolves back on the title.
 */
export async function dailyFlow(): Promise<void> {
  let next: number | null = null;
  for (;;) {
    const today = dailyNumber(new Date());
    const f = readSave('daily');
    // (A run of a Daily older than yesterday's can't be finished any more: let go.)
    const saved = f && f.daily! >= today - 1 ? f.daily! : null;
    const choice = next !== null ? { act: 'play' as const, n: next } : await showDaily({ today, record: dailyRecord, saved, savedWhen: f ? saveWhen(f) : '', streak: streakOf(today) }, click);
    next = null;
    if (!choice) return;
    // A new try replaces the saved run of another Daily (asked first).
    if (choice.act === 'play' && saved !== null && !(await ask(t('daily.replaceSure', { n: saved + 1 }), t('daily.play'), click))) continue;
    const d = dailyOf(choice.n);
    let sim: Sim | null;
    // (P31: a run saved before its prison was rebuilt can't go on: a fresh try of the same Daily.)
    if (choice.act === 'continue' && f && rebuiltSince(f)) {
      deleteSave('daily');
      banner.toast(t('toast.rebuilt', { prison: prisonName(d.prison) }), 'info', 6000);
      sim = new Sim(d.prison, d.seed, d.twists);
      startGame(sim, false, null, [], { seed: d.seed }, { n: choice.n, tries: Math.max(1, dailyRecord(choice.n).tries) });
    } else if (choice.act === 'continue' && f) {
      sim = loadSave(f);
      // (A Three Days run saved as its time ran out: over, its slot let go.)
      if (sim?.timeUp) {
        deleteSave('daily');
        banner.toast(t('daily.timeUp'), 'bad');
        continue;
      }
      if (!sim) {
        banner.toast(t('toast.loadFailed'), 'bad');
        continue;
      }
      startGame(sim, true, null, f.rumors, { log: readLog('daily') }, { n: choice.n, tries: Math.max(1, dailyRecord(choice.n).tries) });
    } else {
      const tries = dailyTry(choice.n);
      sim = new Sim(d.prison, d.seed, d.twists);
      startGame(sim, false, null, [], { seed: d.seed }, { n: choice.n, tries });
    }
    await untilQuit();
    view.setWorld(new Sim(d.prison).world);
    next = takeDailyAgain();
    if (next === null) return;
  }
}
