import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { announceRat } from './rat';
import { announceSmuggle } from './smuggle';
import { announceGames } from './games';
import { announcePastimes } from './pastimes';
import { announceLong } from './long';
import { announceTeam } from './team';
import { announceNights } from './nights';
import { announcePhone } from './payphone';
import { announceKiosk } from './kiosk';
import { announceVending } from './vending';
import { announceCooler, announceMenu } from './menuBoard';
import { announcePaper } from './paperwork';
import { announceParole } from './parole';
import { announceHoliday } from './holidays';
import { announceCrew } from './crew';
import { announceGetaway } from './getaway';
import { ROUTINE } from '../content/routine';
import { type Key, t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { eatingNow } from '../sim/systems/canteen';
import { itemOf } from '../sim/systems/items';
import { ALARM_CLOCK, DIRT, WALL_CHUNK } from '../sim/systems/structure';
import { clockSecs } from '../sim/systems/noise';
import { LAYER } from '../sim/world/World';
import { DOING } from '../sim/systems/inmates';
import { itemsUI, sound } from './context';
import { outOfBounds } from '../sim/systems/k9';
import { coachOnce } from './tips';

import { announceOddJob } from './oddjobs';
import { announceDog } from './dogs';
import { announceDay, nightNotChosen } from './announceDay';
import { announceJobs } from './announceJobs';
import { cant } from './announceKit';
import { announcePeople } from './announcePeople';
import { announceWorks } from './announceWorks';

/**
 * Sound, vibration, banners and toasts for what the simulation reports. Each area's own in its file
 * (v2.34.2): the day (announceDay), things and the walls (announceWorks), people (announcePeople),
 * jobs, the gym and meals (announceJobs); the features' in theirs; the rest here. Each event's type
 * is handled in one place only.
 */
export function announce(e: SimEvent, sim: Sim) {
  nightNotChosen(e);
  announceDay(e, sim);
  announceWorks(e, sim);
  announcePeople(e, sim);
  announceJobs(e, sim);
  switch (e.type) {
    case 'dog':
      announceDog(sim, e);
      break;
    case 'rat':
      announceRat(sim, e);
      break;
    case 'smuggle':
      announceSmuggle(sim, e);
      break;
    // Side games (P22), and sports day's prize.
    case 'dice':
    case 'bout':
    case 'pick':
      announceGames(sim, e);
      break;
    // Card sharks (P27): Cheat, the hoop, the old-timer's board.
    case 'cheat':
    case 'hoopShot':
    case 'hoops':
    case 'checkers':
      announcePastimes(sim, e);
      break;
    // Long games (P28): pruno, the garden, the rat's track, race nights, a sale.
    case 'pruno':
    case 'garden':
    case 'track':
    case 'race':
    case 'sold':
      announceLong(sim, e);
      break;
    // Team & ink (P29): a match, a tattoo.
    case 'football':
    case 'tattoo':
      announceTeam(sim, e);
      break;
    // Stage nights (P30): an act on the stage, a quiz.
    case 'stage':
    case 'quiz':
      announceNights(sim, e);
      break;
    case 'crew':
      announceCrew(sim, e);
      break;
    // The pay phone (P34): the queue, calls, Lou and his jobs, a secret overheard.
    case 'kiosk':
      announceKiosk(e);
      break;
    case 'vend':
      announceVending(sim, e);
      break;
    // The menu board and the water cooler (2.33).
    case 'menu':
      announceMenu(e);
      break;
    case 'cooler':
      announceCooler(e);
      break;
    // The odd jobs board (P40): a job taken, done, handed in, failed; a story's cards.
    case 'oddjob':
      announceOddJob(sim, e);
      break;
    case 'phone':
      announcePhone(sim, e);
      break;
    // The paperwork escape (P36): the form filed, the records, the release.
    case 'paper':
      announcePaper(sim, e);
      break;
    // The parole board (P39): applied, the hearing, the verdict, plotting found out.
    case 'parole':
      announceParole(sim, e);
      break;
    // Holidays (P42): the holiday's day, eggs found, the water fight, treats, carving, laughs.
    case 'holiday':
      announceHoliday(sim, e);
      break;
    // Bluff & glider (P24): waved through and the gates shut again; off a roof.
    case 'bluff':
    case 'glide':
      announceGetaway(sim, e);
      break;
    case 'today':
      if (e.event === 'sports' && e.phase === 'prize') announceGames(sim, e);
      break;
    case 'washed':
      sound.scrub();
      itemsUI.toast(t(outOfBounds(sim) ? 'toast.washedStill' : 'toast.washed'));
      break;
    case 'cantThrow': {
      const now = performance.now();
      if (now - cant.at < 600) break;
      cant.at = now;
      sound.sting();
      itemsUI.toast(t(`toss.${e.why}` as Key));
      break;
    }
  }
  if (e.type === 'pickup' && (e.item === DIRT || e.item === WALL_CHUNK)) coachOnce('evidence', 'hint.evidence');
}

/** How far off the showers can be heard (tiles). */
const SHOWER_EARSHOT = 12;

/** Ten times a second: the sound of the showers, by how near the nearest one running is (off while time runs fast). */
function showerSound(sim: Sim, speed: number) {
  const s = sim.state;
  if (s.step % 2 !== 0) return;
  let near = Infinity;
  if (speed === 1 && ROUTINE[s.routine].id === 'showers' && s.layer !== LAYER.UNDER) {
    const px = s.player.x / UNIT;
    const pz = s.player.z / UNIT;
    if (sim.showering) near = 0;
    else
      for (const m of s.inmates) {
        if (m.doing !== DOING.SHOWER) continue;
        near = Math.min(near, Math.hypot(m.body.x / UNIT - px, m.body.z / UNIT - pz));
      }
  }
  sound.setWater(near === Infinity ? 0 : Math.round(Math.max(0, 1 - near / SHOWER_EARSHOT) * 20) / 20);
}

/** Once a second: a mouthful while eating; while it counts down, a wound alarm clock in the pockets ticks (never while time runs fast: asleep, out cold, fast-forward). */
export function tickTock(sim: Sim, speed: number) {
  showerSound(sim, speed);
  const s = sim.state;
  if (speed !== 1 || s.step % STEPS_PER_SECOND !== 0) return;
  if (eatingNow(sim)) sound.bite();
  if (s.items.inv.some((v) => itemOf(v) === ALARM_CLOCK && clockSecs(v) > 0)) sound.clockTick();
}
