/**
 * Gangs and turf in the play layer (2.36, sim/systems/gangs.ts): what the player is told of gang business
 * (meeting the gangs, joining, leaving, thrown out, told off a rival's turf, off it in time, squared up to,
 * the war's rival), and, with nothing in the simulation, a word the first time they stand on held turf while
 * in no gang (nobody minds them: it's only so they know).
 */
import { buzz } from '../app/haptics';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { gangsHere, heldPiece, playerGang, turfAt } from '../sim/systems/gangs';
import { crowdPlan } from '../sim/systems/calendar';
import { TRESPASS_STEPS, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import { gangName, inmateName } from '../ui/names';
import { banner, sound } from './context';
import { coachOnce } from './tips';

/** A gang's name as a title ("Kitchen Crew"), by its place in the prison's gangs. */
const title = (sim: Sim, k: number) => {
  const id = sim.prison.gangs?.[k]?.id;
  return id ? t(`gangT.${id}` as Key) : '';
};

/** What the simulation reports of gang business (announce.ts hands every event here). */
export function announceGang(e: SimEvent, sim: Sim) {
  if (e.type !== 'gang') return;
  const who = e.who ?? -1;
  switch (e.what) {
    case 'met':
      banner.toast(t('toast.gangMet', { name: inmateName(sim, who), gang: gangName(sim, e.gang) }), 'info', 4000);
      coachOnce('gangs', 'hint.gangs');
      break;
    case 'joined':
      sound.levelUp();
      buzz('attended');
      banner.show(
        t('banner.gangJoined'),
        t('banner.gangJoinedSub', { gang: title(sim, e.gang), boss: inmateName(sim, who) }),
        'routine',
        4800,
      );
      break;
    case 'left':
      banner.toast(t('toast.gangLeft', { gang: gangName(sim, e.gang) }), 'info', 4500);
      break;
    case 'kicked':
      sound.sting();
      buzz('missed');
      banner.toast(t('toast.gangKicked', { gang: gangName(sim, e.gang) }), 'bad', 5000);
      break;
    case 'warn':
      sound.whistle();
      buzz('missed');
      banner.toast(t('toast.gangWarn', { gang: title(sim, e.gang), n: Math.round(TRESPASS_STEPS / STEPS_PER_SECOND) }), 'bad', 4000);
      break;
    case 'clear':
      banner.toast(t('toast.gangClear'), 'good', 2500);
      break;
    case 'jumped':
      sound.whistle();
      buzz('missed');
      banner.toast(t('toast.gangJumped', { name: inmateName(sim, who) }), 'bad', 4500);
      break;
    case 'warJump':
      sound.whistle();
      buzz('missed');
      banner.toast(t('toast.gangWarJump', { name: inmateName(sim, who) }), 'bad', 4500);
      break;
  }
}

/**
 * Each frame: in no gang, the first time the player stands on turf a gang holds (its members there), a word
 * that it's theirs and that nobody minds a newcomer (coachOnce: once a profile).
 */
export function turfHint(sim: Sim) {
  const s = sim.state;
  const piece = heldPiece(sim, crowdPlan(sim, s.routine));
  if (!s.gang || !gangsHere(sim) || playerGang(sim) >= 0 || s.layer !== LAYER.GROUND || !piece) return;
  const k = turfAt(sim.world.def, Math.floor(s.player.x / UNIT), Math.floor(s.player.z / UNIT), piece);
  if (k < 0) return;
  const def = sim.prison.gangs![k];
  const there = s.inmates.some((m) => def.members.includes(m.cell) && Math.hypot(m.body.x - s.player.x, m.body.z - s.player.z) < 3 * UNIT);
  if (there) coachOnce('gangTurf', 'hint.gangTurf', { gang: gangName(sim, k) });
}
