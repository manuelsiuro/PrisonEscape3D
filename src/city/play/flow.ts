import { intakeFlow } from '../../flows/intake';
import { readPrisoner } from '../../game/prisoner';
import { t } from '../../i18n';
import { banner, click } from '../../play/context';
import { hhmm } from '../../sim/systems/clock';
import { hideLoading, showLoading } from '../../ui/loading';
import { ask } from '../../ui/screens/ask';
import { deleteCitySave, readCitySave } from '../save';
import { City, loadCity } from '../sim/City';
import { showCityMenu, showNewCity } from '../ui/screens';
import { runCity } from './city';

/**
 * City Escape from the title (C1): the city in progress carried on, or a new one made (how death
 * is taken chosen first; the Intake before a first game, as the prisons ask it). Back when the
 * player leaves the city for the title.
 */
export async function cityFlow(): Promise<void> {
  for (;;) {
    const saved = readCitySave();
    const choice = saved
      ? await showCityMenu(`${saved.name} · ${t('city.hud.day', { n: saved.day })} · ${hhmm(saved.minute)}`, click)
      : 'new';
    if (choice === 'back') return;
    let city: City | null = null;
    if (choice === 'continue' && saved) {
      await showLoading();
      city = loadCity(saved.snap);
      if (!city) {
        hideLoading();
        deleteCitySave();
        banner.toast(t('toast.loadFailed'), 'bad');
        continue;
      }
    } else {
      const mode = await showNewCity(click);
      if (mode === null) {
        if (saved) continue;
        return;
      }
      // A new city replaces the one in progress: asked first.
      if (saved && !(await ask(t('city.newSure', { where: saved.name, n: saved.day }), t('city.newYes'), click))) continue;
      if (!readPrisoner() && !(await intakeFlow(true))) continue;
      await showLoading();
      city = new City(Date.now() & 0x7fffffff, mode);
    }
    await runCity(city, choice !== 'continue');
    return;
  }
}
