import { KO_STEPS, LOOK_AWAY_STEPS, PAPER_HEAT, STEPS_PER_MINUTE, STEPS_PER_SECOND } from '../sim/tuning';
import { buzz } from '../app/haptics';
import { hostile } from '../sim/systems/social';
import { itemDef } from '../content/items';
import { lowerFirst, t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { FIRECRACKER } from '../sim/systems/structure';
import { tossFlight } from '../render/Noise';
import { TOUCH } from '../ui/dom';
import { itemName } from '../ui/items';
import { press } from './reach';
import { aimUI, banner, board, combatUI, itemsUI, profile, ratPanel, phonePanel, crewPanel, sound, tools, view } from './context';
import { play } from './game';
import { coachOnce, seenInteract } from './tips';
import { floatAt } from './floats';
import { refusedText } from './refusals';
import { gainAt, tilesTo } from './loudness';
import { guardSubject, inmateName, jobName } from '../ui/names';
import { cant } from './announceKit';

/** When a cup was last thrown (real ms), and how long it's in the air (the flight in viewEffects.ts). */
let thrownAt = -1e9;
const THROW_FLIGHT_MS = 320;

/** How long the last thing thrown is in the air (s): its thud's wave waits for it to land. */
let lastFlight = 0;

/** People (out of announce.ts, v2.34.2): blows, knockouts and wounds, cash, talk, opinion, gifts, favours, followers, ambushes, bribes, refusals, what's thrown and noise. */
/** At most this many opinions moving in one step float over their heads (a crowd's cheer doesn't). */
const OPINION_FLOATS = 3;

export function announcePeople(e: SimEvent, sim: Sim) {
  switch (e.type) {
    case 'hit':
      sound.punch(e.ko, !!e.weapon);
      buzz(e.ko ? 'giveWay' : 'strike');
      view.blow(-1, e.who, e.ko);
      floatAt(e.who, `${e.dmg}`, 'dealt');
      break;
    case 'thrown':
      sound.splash();
      buzz('giveWay');
      view.throwAt(e.who);
      thrownAt = performance.now();
      break;
    case 'cantHit': {
      const now = performance.now();
      if (now - cant.at < 1200) break;
      cant.at = now;
      sound.whoosh();
      itemsUI.toast(t('toast.tooFar'));
      break;
    }
    case 'hurt':
      sound.hurt();
      buzz('strike');
      combatUI.hurt(e.dmg >= 25);
      if (e.by >= 0) view.blow(e.by, -1, false);
      // (2.35: a blow blocked says so.)
      floatAt(-1, e.blocked ? t('combat.blocked', { n: e.dmg }) : `${e.dmg}`, 'taken');
      // Hit while working: the tool stops (a fight goes on: a held Hit button keeps swinging).
      if (!press.toolNow?.attack) tools.release();
      break;
    case 'koed': {
      // Knocked out by a thrown cup: the stars when it lands, not while it's in the air.
      const who = e.who;
      const g0 = play.game;
      const land = () => {
        if (play.game !== g0) return;
        sound.ko();
        floatAt(who, t('combat.ko'), 'ko');
        coachOnce('loot', 'hint.loot', { s: KO_STEPS / STEPS_PER_SECOND });
      };
      if (performance.now() - thrownAt < 100) setTimeout(land, THROW_FLIGHT_MS);
      else land();
      break;
    }
    case 'floored':
      sound.thud();
      buzz('lockdown');
      itemsUI.closePanels();
      play.game?.pilot.stop();
      banner.show(t('banner.floored'), t('banner.flooredSub'), 'alarm', 3500);
      break;
    case 'sharpened':
      sound.craft();
      buzz('attended');
      itemsUI.toast(t('toast.sharpened', { item: itemName(e.item) }));
      break;
    // ---------------------------------------------------------------- economy and social life (P6)
    case 'cash':
      // (The dice's winnings and sports day's prize: said by the games, when the dice are down.)
      if (e.why === 'dice' || e.why === 'prize') break;
      if (e.n > 0) {
        sound.coin(e.n >= 20);
        floatAt(-1, `+$${e.n}`, 'cash');
        if (e.why === 'loot') itemsUI.toast(t('toast.foundCash', { n: e.n }));
        coachOnce('file', TOUCH ? 'hint.fileTouch' : 'hint.fileKeys');
        if (e.why === 'wage') {
          buzz('attended');
          banner.show(t('banner.paid', { n: e.n }), t('banner.paidSub', { job: jobName(sim, sim.playerJob) }), 'routine', 3600);
        }
      } else if (e.why === 'wage') {
        // (P26: an Unpaid Labour Daily, the quota done for nothing.)
        buzz('attended');
        banner.show(t('banner.unpaid'), t('banner.paidSub', { job: jobName(sim, sim.playerJob) }), 'routine', 3600);
      }
      break;
    case 'talk':
      if (e.who >= 0) {
        seenInteract();
        sound.drawer();
        itemsUI.closePanels();
        board.close();
        profile.close();
        ratPanel.close();
        phonePanel.close();
        crewPanel.close();
        // A guard (P15): what talking to one is for.
        coachOnce(
          e.who >= sim.state.inmates.length ? 'guardTalk' : 'talk',
          e.who >= sim.state.inmates.length ? 'hint.guardTalk' : 'hint.talk',
        );
      }
      break;
    case 'opinion': {
      if (e.by > 0) sound.opinionUp();
      // (2.36: over their head, but where the talk panel shows it already, a blow's number or a laugh is there, or a crowd moves at once.)
      const shown = sim.events.some(
        (o) =>
          (o.type === 'hit' && o.who === e.who) || ((o.type === 'menu' || o.type === 'holiday') && o.what === 'laugh' && o.who === e.who),
      );
      if (sim.state.talk !== e.who && !shown && sim.events.filter((o) => o.type === 'opinion').length <= OPINION_FLOATS)
        floatAt(e.who, t('float.opinion', { n: `${e.by > 0 ? '+' : '−'}${Math.abs(e.by)}` }), e.by > 0 ? 'gain' : 'taken');
      break;
    }
    case 'bought':
      sound.buy();
      buzz('bell');
      itemsUI.toast(t('toast.bought', { item: itemName(e.item), n: e.price }));
      break;
    case 'gift':
      sound.pickup();
      // (A delivery done by it: the job's own banner says it, once.)
      if (sim.events.some((o) => o.type === 'oddjob' && o.what === 'done')) break;
      itemsUI.toast(
        e.item
          ? t('toast.gaveItem', { item: lowerFirst(itemName(e.item)), name: inmateName(sim, e.who) })
          : t('toast.gaveCash', { n: e.cash, name: inmateName(sim, e.who) }),
      );
      break;
    case 'favor':
      if (e.state === 'taken') {
        sound.chime();
        coachOnce('favor', 'hint.favor');
      } else if (e.state === 'done') {
        sound.chime();
        buzz('attended');
        banner.toast(t('toast.favorDone', { name: inmateName(sim, e.who) }), 'good', 5000);
      } else if (e.state === 'paid') buzz('attended');
      else if (e.state === 'dropped') banner.toast(t('toast.favorDropped', { name: inmateName(sim, e.who) }), 'info');
      break;
    case 'recruit':
      if (e.on) {
        sound.levelUp();
        // (One who owed the player from an odd job: its own toast says it, once.)
        if (sim.events.some((o) => o.type === 'oddjob' && o.what === 'owedJoin' && o.who === e.who)) break;
        banner.toast(t('toast.recruited', { name: inmateName(sim, e.who) }), 'good', 4500);
      } else banner.toast(t('toast.leftYou', { name: inmateName(sim, e.who) }), 'info');
      break;
    case 'snooped':
      // (2.23: an inmate's things gone through before their eyes; a fight's whistle as they come at the player.)
      if (e.fights) sound.whistle();
      buzz('missed');
      banner.toast(t(e.fights ? 'toast.snoopedFight' : 'toast.snooped', { name: inmateName(sim, e.who) }), 'bad', 4500);
      break;
    case 'ambush':
      sound.whistle();
      buzz('missed');
      banner.toast(t('toast.ambush', { name: inmateName(sim, e.who) }), 'bad', 4500);
      // A lawless prison (San Pancho, or a Bad Blood Daily): how scores are settled there, told once.
      if (hostile(sim)) coachOnce('hostile', 'hint.hostile');
      break;
    case 'allyHit':
      sound.punch(e.ko, false);
      view.blow(e.by, e.who, e.ko);
      floatAt(e.who, `${e.dmg}`, 'ally');
      if (e.ko) floatAt(e.who, t('combat.ko'), 'ko');
      break;
    // Guard ways (P15): a bribe paid, a look away over (a guard dozing: the coach, see overlay).
    case 'bribe': {
      const name = guardSubject(sim, e.guard);
      if (e.kind === 'over') {
        sound.sting();
        banner.toast(t('toast.bribeOver', { name }), 'bad', 3500);
        break;
      }
      sound.buy();
      buzz('bell');
      floatAt(-1, `−$${e.price}`, 'cash');
      itemsUI.toast(
        e.kind === 'look'
          ? t('toast.bribeLook', { name, n: LOOK_AWAY_STEPS / STEPS_PER_MINUTE / 60 })
          : t('toast.bribePaper', { n: PAPER_HEAT }),
      );
      break;
    }
    case 'refused': {
      const now = performance.now();
      if (now - cant.at < 600) break;
      cant.at = now;
      sound.sting();
      // (Each with its number: the opinion a game or a night out needs, the games a day, parole's days…)
      itemsUI.toast(refusedText(sim, e.why));
      break;
    }
    // Noise and distractions (P14): a throw flies, lands with its clatter; a noise sends out its
    // wave and the guards sent to look get a "?"; a firecracker fizzes, then bangs; a clock rings.
    case 'tossed': {
      const flight = view.reducedMotion ? 0 : tossFlight(tilesTo(sim, e.to));
      lastFlight = flight;
      sound.whoosh();
      view.toss(e.item, e.to);
      const gain = gainAt(sim, e.to);
      setTimeout(() => sound.clatter(itemDef(e.item).thud ?? 0, gain), flight * 1000);
      if (e.item === FIRECRACKER) setTimeout(() => sound.fuse(gain), flight * 1000);
      if (e.hit >= 0) itemsUI.toast(t('toast.hitInmate', { name: inmateName(sim, e.hit) }));
      break;
    }
    case 'noise': {
      view.noise(e.kind, e.tile, e.reach, e.tiles, e.sent.length > 0, e.kind === 'thud' ? lastFlight : 0);
      if (e.sent.length) {
        aimUI.heard(e.sent.map((k) => sim.state.inmates.length + k));
        // (The tip is about the player's own noise: never the drone's buzz.)
        if (e.kind !== 'buzz') coachOnce('heard', 'hint.heard');
      }
      break;
    }
    case 'wound':
      sound.wind();
      itemsUI.toast(e.secs ? t('toast.wound', { n: e.secs }) : t('toast.clockStopped'));
      break;
    case 'bang': {
      const gain = gainAt(sim, e.tile);
      sound.bang(gain);
      view.bang(e.tile);
      if (gain > 0.5) buzz('giveWay');
      break;
    }
    case 'ringing':
      sound.ring(gainAt(sim, e.tile));
      break;
  }
}
