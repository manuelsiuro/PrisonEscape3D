import { intakeFlow } from '../../flows/intake';
import { readPrisoner } from '../../game/prisoner';
import { t } from '../../i18n';
import { banner, click } from '../../play/context';
import { hhmm } from '../../sim/systems/clock';
import { hideLoading, showLoading } from '../../ui/loading';
import { ask } from '../../ui/screens/ask';
import { deleteCitySave, readCitySave } from '../save';
import { City, loadCity, MODE } from '../sim/City';
import { showCityMenu, showNewCity } from '../ui/screens';
import { cityBackdrop, clearBackdrop, runCity } from './city';

/**
 * City Escape from the title (C1): the city in progress carried on, or a new one made (how death
 * is taken chosen first; the Intake before a first game, as the prisons ask it). Back when the
 * player leaves the city for the title.
 */
/** The city shown behind the cards when none is in progress. */
const BACKDROP_SEED = 20261115;

export async function cityFlow(): Promise<void> {
  // (2.59: a city behind these cards, not the prison the title stood over: the one in progress, or one to look at.)
  const first = readCitySave();
  await showLoading();
  const behind = (first && loadCity(first.snap)) || new City(BACKDROP_SEED);
  cityBackdrop(behind);
  hideLoading();
  // (2.64: an end card's "A new city": straight to the new city's card.)
  let again = false;
  for (;;) {
    const saved = readCitySave();
    // (A city behind the new city's card again: the one left was cleared with it.)
    if (again) cityBackdrop(new City(BACKDROP_SEED));
    const choice = again
      ? 'new'
      : saved
        ? await showCityMenu(
            `${saved.name} · ${t('city.hud.day', { n: saved.day })} · ${hhmm(saved.minute)} · ${t(saved.mode === MODE.HARDCORE ? 'city.mode.hardcore' : saved.mode === MODE.HOLDOUT ? 'city.mode.holdout' : 'city.mode.survivor')}`,
            click,
          )
        : 'new';
    if (choice === 'back') return clearBackdrop();
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
        return clearBackdrop();
      }
      // A new city replaces the one in progress: asked first.
      if (saved && !(await ask(t('city.newSure', { where: saved.name, n: saved.day }), t('city.newYes'), click))) continue;
      if (!readPrisoner() && !(await intakeFlow(true, t('city.intake.tag')))) continue;
      await showLoading();
      city = new City(Date.now() & 0x7fffffff, mode);
    }
    again = await runCity(city, choice !== 'continue');
    if (!again) return;
  }
}
