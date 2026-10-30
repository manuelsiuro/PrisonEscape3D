/** Why the sim said no, in words: the refusal's line with the number it names. */
import { NIGHT_OPINION } from '../content/crew';
import { ELDER_OPINION, GAME_OPINION, GAMES_A_DAY } from '../content/games';
import { APPLY_DAY } from '../content/parole';
import { FRIEND_INK, INK_OPINION } from '../content/team';
import { t, type Key } from '../i18n';
import type { Sim } from '../sim/Sim';
import { P } from '../sim/systems/parole';
import { BRIBE_REPORT_HEAT } from '../sim/tuning';

/** The number a refusal's line names ({n}): the opinion a game, a night out, the old-timer or a tattoo needs, the games a day, parole's first day and the day to apply again, a reported bribe's heat. */
const REFUSAL_N: Record<string, (sim: Sim) => number> = {
  reported: () => BRIBE_REPORT_HEAT,
  gameOpinion: () => GAME_OPINION,
  played: () => GAMES_A_DAY,
  nightOpinion: () => NIGHT_OPINION,
  elderOpinion: () => ELDER_OPINION,
  inkOpinion: () => INK_OPINION,
  inkFriend: () => FRIEND_INK,
  paroleEarly: () => APPLY_DAY,
  paroleWait: (sim) => sim.state.parole[P.AGAIN],
};

/** Why the sim said no, in words (`refused.<why>`, with its number where the line has one). */
export const refusedText = (sim: Sim, why: string) => t(`refused.${why}` as Key, { n: REFUSAL_N[why]?.(sim) ?? 0 });
