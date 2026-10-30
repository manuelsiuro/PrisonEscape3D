import { buzz } from '../app/haptics';
import { dailyNumber, dailyOf } from '../content/daily';
import { twistOf } from '../content/twists';
import { checkCode, dailyEscape, dailyRecord, streakOf, stripOf } from '../game/daily';
import { deleteSave } from '../game/saves';
import { addStats } from '../game/stats';
import { escapeRun } from '../game/trophies';
import { t, type Key } from '../i18n';
import { sumOf } from '../sim/runlog';
import { ESCAPES, type Sim } from '../sim/Sim';
import { formatTime } from '../sim/systems/clock';
import { STEPS_PER_MINUTE } from '../sim/tuning';
import { icon } from '../ui/icons';
import { showDailyResult, showTimeUp, type DailyResult } from '../ui/screens/daily';
import { keepReplay } from '../game/logs';
import type { RunLog } from '../sim/runlog';
import { watchReplay } from './replay';
import { prisonName } from '../ui/screens/prisons';
import { banner, click, controls, itemsUI, sound, tools, trophyToast } from './context';
import { play, type DailyRun, type Game } from './game';
import { endGame } from './session';
import { escapeScene } from './stage';

/**
 * A Daily Escape's run in play (P26): its twists said as it begins, its escape kept in the
 * Daily's history (never the campaign's records), its result card to share, a Three Days run's
 * time up; "Try again" straight into a new try, past the title.
 */

/** "Daily #12". */
const dailyName = (n: number) => t('daily.name', { n: n + 1 });

/** Where a Daily's run is (the pause card): "Daily #12 · Shankton · Day 2". */
export const dailyPlace = (sim: Sim, d: DailyRun) => `${dailyName(d.n)} · ${prisonName(sim.prison)} · ${t('hud.day', { n: sim.clock.day })}`;

/** The day's twists as chips (an icon and a name each). */
export function dailyTwistsHtml(mods: readonly string[]): string {
  return mods
    .map((id) => twistOf(id))
    .filter((x) => !!x)
    .map((x) => `<span class="twist-chip" role="listitem" title="${t(`twist.${x!.id}.d` as Key)}">${icon(x!.icon, 14)}<span>${t(`twist.${x!.id}` as Key)}</span></span>`)
    .join('');
}

/** As the run begins (or is picked up again): today's twists, under the HUD. */
export function dailyBanner(sim: Sim, d: DailyRun) {
  const names = sim.state.mods.map((id) => t(`twist.${id}` as Key)).join(' · ');
  banner.show(dailyName(d.n), t('daily.bannerSub', { twists: names, n: d.tries }), 'routine', 5200);
}

/** A Daily straight into its next try after its card ("Try again"), past the title. */
let again: number | null = null;
export const dailyRestart = (n: number) => void (again = n);
export function takeDailyAgain(): number | null {
  const n = again;
  again = null;
  return n;
}

/** Out of a Daily: kept in its history, the achievements it earned, its card (to share), then a new try or the title. */
export async function dailyEscaped(g: Game) {
  const d = g.daily!;
  const sim = g.rec.sim;
  const st = sim.state;
  const via = ESCAPES[st.via];
  const minutes = Math.floor(st.step / STEPS_PER_MINUTE);
  const strip = stripOf(st.days);
  const code = checkCode(d.n, via, minutes, d.tries, sumOf(sim));
  const first = !dailyRecord(d.n).best;
  const rec = dailyEscape(d.n, { prison: sim.prison.id, day: sim.clock.day, minutes, via, strip, code });
  const streak = streakOf(dailyNumber(new Date()));
  addStats({ ...(first ? { dailies: 1 } : {}), dailyStreak: streak });
  const earned = escapeRun({ medal: rec.medal }, { twists: st.mods.length, tries: d.tries, streak });
  trophyToast.clear();
  // The run is over: its slot is free again; its log kept as the last escape's, to watch again (P25).
  const log: RunLog = { ...g.rec.toLog(), via, daily: d.n };
  deleteSave('daily');
  keepReplay(log, false);
  if (!(await escapeScene(g))) return;
  const daily = dailyOf(d.n);
  const result: DailyResult = {
    n: d.n,
    late: d.n < dailyNumber(new Date()),
    prison: prisonName(sim.prison),
    prisonId: sim.prison.id,
    twists: daily.twists,
    via,
    day: sim.clock.day,
    time: formatTime(sim.clock),
    tries: d.tries,
    medal: rec.medal,
    best: rec.best,
    bestDay: rec.record.best?.day ?? sim.clock.day,
    streak,
    strip,
    code,
    earned,
    watch: true,
  };
  let choice: Awaited<ReturnType<typeof showDailyResult>>;
  for (let back = false; ; back = true) {
    choice = await showDailyResult(result, click, back);
    if (play.game !== g) return;
    if (choice !== 'watch') break;
    await watchReplay({ log, guest: false, by: null }, g);
    if (play.game !== g) return;
  }
  again = choice === 'again' ? d.n : null;
  endGame();
}

/** A Three Days run still inside as the fourth day dawns: over. Try again, or the title. */
export async function dailyTimeUp(g: Game) {
  const d = g.daily;
  if (!d || g.over) return;
  g.over = true;
  g.paused = true;
  controls.enabled = false;
  controls.reset();
  tools.release();
  itemsUI.closePanels();
  sound.siren(false);
  sound.sting();
  buzz('missed');
  deleteSave('daily');
  sound.music('title');
  await new Promise((r) => setTimeout(r, 900));
  if (play.game !== g) return;
  const choice = await showTimeUp({ n: d.n, prison: prisonName(g.rec.sim.prison), tries: d.tries }, click);
  if (play.game !== g) return;
  again = choice === 'again' ? d.n : null;
  endGame();
}
