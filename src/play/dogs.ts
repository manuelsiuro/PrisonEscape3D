/** What the guard dogs do, on screen and in the ears. */
import { buzz } from '../app/haptics';
import { t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { banner, itemsUI, sound } from './context';
import { dogName } from './labels';
import { dogDef, outOfBounds } from '../sim/systems/k9';
import { coachOnce } from './tips';
import { tileAt } from '../sim/world/grid';
import { gainAt } from './loudness';
import { KENNEL_TRUST_CAP, TRUST_IGNORE } from '../sim/tuning';

/** When each dog's "on your trail" was last said (real ms), and whether it was (its "lost" follows only then). */
const trackSaid: number[] = [];
const trackShown: boolean[] = [];

/** The guard dogs (P19): heard as loud as they are close, told by name. */
export function announceDog(sim: Sim, e: Extract<SimEvent, { type: 'dog' }>) {
  const d = sim.state.dogs[e.dog];
  const gain = d ? gainAt(sim, tileAt(d.body.x, d.body.z)) : 0.5;
  const dog = dogName(sim, e.dog);
  const pitch = dogDef(sim.world, e.dog).coat === 'mastiff' ? 0.75 : dogDef(sim.world, e.dog).coat === 'collie' ? 1.15 : 1;
  switch (e.what) {
    case 'sniff':
      sound.bark(gain, pitch);
      buzz('missed');
      coachOnce('sniffed', 'hint.sniffed');
      break;
    case 'track': {
      sound.bark(gain * 0.8, pitch);
      // (Once in a while per dog: in a lockdown a dog may lose the trail and pick up fresher scent again and again.)
      const now = performance.now();
      if (now - (trackSaid[e.dog] ?? -1e9) < 10000) break;
      trackSaid[e.dog] = now;
      trackShown[e.dog] = true;
      banner.toast(t('toast.dogTrack', { dog }), 'bad');
      coachOnce('scent', 'hint.scent');
      break;
    }
    case 'point':
      sound.bark(gain, pitch);
      trackShown[e.dog] = false;
      // (Found somewhere the player may be, it's only a dog's hello.)
      if (outOfBounds(sim)) banner.toast(t('toast.dogPoint', { dog }), 'bad');
      else itemsUI.toast(t('toast.dogHello', { dog }));
      break;
    case 'dug':
      sound.bark(gain, pitch);
      buzz('missed');
      trackShown[e.dog] = false;
      // (Out of a lockdown the alarm's banner says it; in one, this does.)
      if (sim.state.lockdown && !sim.events.some((m) => m.type === 'lockdown')) banner.toast(t('toast.dogDug', { dog }), 'bad');
      break;
    case 'lost':
      // (Said only of a trail the player was told about.)
      if (trackShown[e.dog]) itemsUI.toast(t('toast.dogLost', { dog }));
      trackShown[e.dog] = false;
      break;
    case 'dazed':
      sound.sneeze(gain);
      itemsUI.toast(t(e.trail ? 'toast.dogDazed' : 'toast.dogSneeze', { dog }));
      trackShown[e.dog] = false;
      break;
    case 'fed': {
      // 2.36 (The Six Hunter): the kennel hand's quota feeds the whole pack at once: said once, with the lowest trust.
      if (e.pack) {
        const pack = sim.events.filter((m): m is typeof e => m.type === 'dog' && m.what === 'fed' && !!m.pack);
        if (pack[0] !== e) break;
        sound.munch(false);
        itemsUI.toast(t('toast.packFed', { n: Math.min(...pack.map((m) => m.trust ?? 0)) }));
        coachOnce('kennels', 'hint.kennels', { n: KENNEL_TRUST_CAP, m: TRUST_IGNORE });
        break;
      }
      sound.munch(false);
      if (!sim.events.some((m) => m.type === 'dog' && m.what === 'friend'))
        itemsUI.toast(t(e.trout ? 'toast.dogFedTrout' : 'toast.dogFed', { dog, n: e.trust ?? 0 }));
      coachOnce('treat', 'hint.treat');
      break;
    }
    case 'friend':
      sound.munch(true);
      banner.toast(t('toast.dogFriend', { dog }), 'good');
      break;
    case 'full':
      itemsUI.toast(t('toast.dogFull', { dog }));
      break;
    case 'asleep':
      sound.yawn(gain);
      itemsUI.toast(t('toast.dogAsleep', { dog }));
      break;
    case 'woke':
      if (gain > 0.4) itemsUI.toast(t('toast.dogWoke', { dog }));
      break;
  }
}
