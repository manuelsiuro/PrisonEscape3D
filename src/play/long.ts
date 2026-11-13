import { buzz } from '../app/haptics';
import {
  BETS,
  CROP,
  GROWN,
  HEATWAVE_WATER,
  LEGS,
  RACE_MINUTE,
  RACE_STEPS,
  RAT_LAPS,
  RAT_WINDOW,
  TAKE,
  TIPSY_HEAT,
  WATER_MAX,
} from '../content/long';
import { type Key, lowerFirst, t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { clockAt, formatTime, hhmm, prisonDay } from '../sim/systems/clock';
import { BED, bedCount, bedOf, bedOwner, bedTile, ripe, wilted } from '../sim/systems/garden';
import { lineOfSight } from '../sim/ai/sight';
import { planOf } from '../sim/systems/calendar';
import { DOING } from '../sim/ai/doing';
import { itemNumber } from '../content/items';
import { itemOf } from '../sim/systems/items';
import { takeCheck } from '../sim/systems/pantry';
import {
  atTrack,
  cardMinute,
  cardUp,
  oddsOf,
  petLane,
  RACE,
  ratLap,
  ratRunning,
  RR,
  raceCard,
  raceCheck,
  runRace,
  trackOf,
  trackTiles,
  type Entrant,
} from '../sim/systems/races';
import { petOf, RAT } from '../sim/systems/rats';
import { tipsyNow } from '../sim/systems/pruno';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import { TILE } from '../sim/world/tiles';
import type { LongFrame } from '../render/Long';
import type { RaceLane, RaceView, RatRunView } from '../ui/long';
import { TOUCH } from '../ui/dom';
import { gameCards } from './lazy';
import { itemName } from '../ui/items';
import { banner, itemsUI, settings, sound } from './context';
import { play } from './game';
import { coachOnce } from './tips';
import { treatOffers } from './holidays';
import { floatUp } from './floats';
import { ratName } from './labels';
import { inmateName } from '../ui/names';
import { DICE_HEAT } from '../content/games';
import { eyesOn } from '../sim/systems/games';
import { director } from './chatter';
import { cheer } from './games';

/**
 * Long games (P28) on screen: what can be taken from the open furniture, the race card, the
 * sounds, toasts and floats of the events, and what the picture shows (the garden's beds as they
 * grow, the rats down the track, the pet's laps at home, the player tipsy). All of it from the
 * sim's own rules (pantry.ts, garden.ts, pruno.ts, races.ts).
 */

// ------------------------------------------------------------------ the open furniture

export const NO_TAKE: ReadonlyArray<{ what: number; label: string; why: string }> = [];
const offers: Array<{ what: number; label: string; why: string }> = [];
const TAKES_OF: Record<string, readonly number[]> = {
  canteenCounter: [TAKE.FRUIT],
  kitchenFreezer: [TAKE.SUGAR],
  libraryShelf: [TAKE.VEG_SEEDS, TAKE.FRUIT_SEEDS],
};
const TAKE_LABEL: readonly Key[] = ['take.fruit', 'take.sugar', 'take.vegSeeds', 'take.fruitSeeds'];

/** What can be taken from the open furniture (by its table), and why not. */
export function takeOffers(sim: Sim, table: string): ReadonlyArray<{ what: number; label: string; why: string }> {
  const list = TAKES_OF[table];
  if (!list) return NO_TAKE;
  offers.length = 0;
  // (P42: a holiday's treat first, where there is one today.)
  offers.push(...treatOffers(sim, table));
  for (const what of list) {
    const why = takeCheck(sim, what);
    offers.push({
      what,
      label: t(TAKE_LABEL[what]),
      why:
        why === 'notMeal'
          ? t('take.notMeal')
          : why === 'takenToday'
            ? t(what === TAKE.FRUIT ? 'take.meal' : 'take.today')
            : why === 'room'
              ? t('refused.room')
              : '',
    });
  }
  return offers;
}

// ------------------------------------------------------------------ the events

/** The last race's result, held a moment for the card (real ms). */
let result: {
  order: number[];
  card: Entrant[];
  final: number[];
  at: number;
  lane: number;
  stake: number;
  odds: number;
  won: number;
  purse: number;
  day: number;
  /** 2.41: the first two so close at the line it took the camera (PHOTO), not in a run from before. */
  photo: boolean;
} | null = null;
/** 2.41: a photo finish: the first two within this share of the winner's distance. */
const PHOTO = 0.02;
/** 2.41: the camera's flash at the line (ms). */
const FLASH_MS = 700;
/** Where the pet runs its laps at home (tiles: a free floor tile beside the player as it set off), held for the session. */
let lapAt: { x: number; z: number } | null = null;
const RESULT_MS = 6000;

export function resetLong() {
  result = null;
  lapAt = null;
  swigEnd = 0;
  remindedDay = 0;
  nextTipsyLine = 0;
  nextSwigLine = 0;
}

export function announceLong(sim: Sim, e: SimEvent) {
  const g = play.game;
  switch (e.type) {
    case 'pruno':
      if (e.what === 'ripe' && e.mine) {
        sound.chime();
        banner.toast(t('toast.prunoRipe'), 'good', 4200);
      } else if (e.what === 'seized') {
        if (e.mine) banner.toast(t('toast.prunoSeized'), 'bad', 4500);
      } else if (e.what === 'drunk') {
        sound.gulp();
        buzz('attended');
        // (2.43: the bag at the lips a moment; one message, not a toast and a hint saying the same.)
        swigEnd = performance.now() + SWIG_MS;
        banner.toast(t('toast.drunk', { n: TIPSY_HEAT }), 'info', 6000);
      } else if (e.what === 'stumble') sound.hiccup();
      else if (e.what === 'sober') itemsUI.toast(t('toast.sober'));
      break;
    case 'garden':
      if (e.what === 'planted') {
        sound.plant();
        itemsUI.toast(t(e.crop === CROP.FRUIT ? 'toast.plantedFruit' : 'toast.plantedVeg', { n: GROWN }));
        coachOnce('garden', 'hint.garden');
      } else if (e.what === 'watered') {
        sound.pour();
        itemsUI.toast(t(e.n === 1 ? 'toast.watered' : 'toast.wateredTwice'));
      } else if (e.what === 'refused') {
        sound.sting();
        itemsUI.toast(t('toast.wateredEnough', { n: WATER_MAX }));
      } else if (e.what === 'harvested') {
        sound.pluck();
        buzz('attended');
        itemsUI.toast(t(e.crop === CROP.FRUIT ? 'toast.harvestFruit' : 'toast.harvestVeg', { n: e.n ?? 2 }));
      } else if (e.what === 'favour' && e.who !== undefined) {
        sound.chime();
        // (At the top of his opinion already: thanked all the same, no number.)
        if (e.n) floatUp(`+${e.n}`, 'gain');
        itemsUI.toast(t(e.n ? 'toast.gardenFavour' : 'toast.gardenFavourTop', { name: inmateName(sim, e.who), n: e.n ?? 0 }));
        neighbourLine(sim, e.who, 'garden.thanks');
      } else if (e.what === 'stolen' && e.who !== undefined) {
        // (2.43: a neighbour's crop taken, not harvested; seen or not, as the sim says.)
        const seen = !!e.seen;
        sound.pluck();
        if (seen) sound.sting();
        banner.toast(
          t(seen ? 'toast.gardenStolenSeen' : 'toast.gardenStolen', { name: inmateName(sim, e.who), n: e.n ?? 0 }),
          seen ? 'bad' : 'info',
          4500,
        );
        if (seen) neighbourLine(sim, e.who, 'garden.thief', 'shout');
      } else if (e.what === 'neighbourWatered' && e.who !== undefined) {
        // (Now and then, with the player close by to hear it: a word to the plants.)
        if (near(sim, e.who, 8) && Math.random() < 0.6) neighbourLine(sim, e.who, 'garden.tending');
      } else if (e.what === 'ripe' || e.what === 'wilted' || e.what === 'died') {
        // (2.43: a neighbour's bed is his business: the player hears only of their own.)
        if (bedOwner(sim.state, e.bed) >= 0) break;
        // (Once a kind a morning, however many beds.)
        const key = `${e.what}:${sim.state.step}`;
        if (gardenSaid.has(key)) break;
        gardenSaid.add(key);
        if (gardenSaid.size > 12) gardenSaid.clear();
        banner.toast(
          t(e.what === 'ripe' ? 'toast.bedRipe' : e.what === 'wilted' ? 'toast.bedWilted' : 'toast.bedDied'),
          e.what === 'ripe' ? 'good' : 'bad',
          4000,
        );
      }
      break;
    case 'track':
      // (2.43: the laps a timing game: the ring set down, the passes marked as they're pressed for, the gain at the end.)
      if (e.what === 'start') {
        lapAt = lapSpot(sim);
        runMarks.fill('');
        sound.squeak(1);
        window.setTimeout(() => play.game === g && sound.patter(0.8), 300);
        coachOnce('ratRun', TOUCH ? 'hint.ratRunTouch' : 'hint.ratRunKeys');
      } else if (e.what === 'tap') {
        const r = ratRunning(sim.state);
        if (r && r[RR.LAST] >= 0) runMarks[r[RR.LAST]] = e.hit ? 'hit' : 'miss';
        if (e.hit) {
          sound.squeak(1.3);
          buzz('attended');
        } else sound.setBeat();
        baitAt = performance.now();
        baitHit = !!e.hit;
        gameCards()?.ratCard.flash(!!e.hit);
      } else if (e.what === 'trained') {
        if (e.hits === undefined) {
          lapAt = lapSpot(sim);
          sound.squeak(1);
          window.setTimeout(() => play.game === g && sound.patter(0.8), 300);
        } else if (e.hits >= RAT_LAPS) cheer();
        floatUp(`+${e.gain} ${t('race.speedShort')}`, 'gain');
        itemsUI.toast(
          e.hits === undefined
            ? t('toast.ratTrained', { name: ratName(sim), item: lowerFirst(itemName(e.item ?? 0)), n: e.speed ?? 0 })
            : t('toast.ratRan', { name: ratName(sim), hits: e.hits, of: RAT_LAPS, n: e.speed ?? 0, gain: e.gain ?? 0 }),
        );
      } else {
        sound.sting();
        itemsUI.toast(t(`track.${e.why}` as Key, { name: ratName(sim) }));
      }
      break;
    case 'sold':
      sound.coin(e.price >= 20);
      itemsUI.toast(t('toast.sold', { item: itemName(e.item), n: e.price, name: inmateName(sim, e.who) }));
      break;
    case 'race': {
      const day = prisonDay(sim.state.step);
      if (e.what === 'bet') {
        sound.buy();
        floatUp(`−$${e.stake}`, 'taken');
        coachOnce('race', 'hint.race');
      } else if (e.what === 'entered') {
        sound.squeak(1);
        itemsUI.toast(t('toast.ratEntered', { name: ratName(sim) }));
      } else if (e.what === 'scratched') {
        // (A bet on it void: its stake back.)
        if (e.stake) floatUp(`+$${e.stake}`, 'cash');
        banner.toast(
          e.stake ? t('toast.ratScratchedBack', { name: ratName(sim), n: e.stake }) : t('toast.ratScratched', { name: ratName(sim) }),
          'bad',
          4200,
        );
      } else if (e.what === 'start') {
        sound.whistle();
        sound.cheer();
        window.setTimeout(() => play.game === g && sound.patter(), 200);
      } else if (e.what === 'result') {
        // (The pet's lane: on the card it raced on, which the state no longer says.)
        const order = e.order ?? [];
        const raced = cardOf(sim, day, order.length);
        const fin: number[] = [];
        positions(runRace(sim.state.salt, day, raced).legs, 1, fin);
        const run = runRace(sim.state.salt, day, raced);
        const far = (lane: number | undefined) => (lane === undefined ? 0 : (run.legs[lane]?.[LEGS - 1] ?? 0));
        const lead = far(order[0]);
        result = {
          order,
          card: raced,
          final: fin,
          at: performance.now(),
          lane: e.lane ?? -1,
          stake: e.stake ?? 0,
          odds: e.odds ?? 0,
          won: e.won ?? 0,
          purse: e.purse ?? 0,
          day,
          photo: !sim.rules240 && order.length > 1 && lead - far(order[1]) <= lead * PHOTO,
        };
        sound.cheer();
        if (result.photo) sound.click();
        // (2.41: those at the track throw a fist up.)
        if (sim.state.watch?.length) cheer();
        const winner = result.card[order[0]];
        const name = winner ? entrantName(sim, winner) : '';
        if (e.won || e.purse) {
          sound.coin(true);
          buzz('attended');
          if (e.won) floatUp(`+$${e.won}`, 'cash');
          const parts = [e.won ? t('toast.betWon', { n: e.won }) : '', e.purse ? t('toast.purse', { n: e.purse }) : '']
            .filter(Boolean)
            .join(' ');
          banner.toast(`${t('toast.raceWinner', { name })} ${parts}`, 'good', 5000);
        } else
          banner.toast(
            e.lane !== undefined && e.lane >= 0 ? t('toast.betLost', { name }) : t('toast.raceWinner', { name }),
            e.lane !== undefined && e.lane >= 0 ? 'bad' : 'info',
            4500,
          );
      } else if (e.what === 'off') {
        if (e.stake) floatUp(`+$${e.stake}`, 'cash');
        banner.toast(e.stake ? t('toast.raceOffBack', { n: e.stake }) : t('toast.raceOff'), 'bad', 4000);
      }
      break;
    }
  }
}

/** The garden's morning news told (kind and step): once a kind a morning. */
const gardenSaid = new Set<string>();

/** The card a race was run on: the rivals, and the pet after them if the order has a lane for it. */
function cardOf(sim: Sim, day: number, lanes: number): Entrant[] {
  const s = sim.state;
  const card = raceCard({ ...s, race: [day, -1, -1, 0, 1, 0, 0, 0] }, day);
  return card.slice(0, lanes);
}

/** A rat's name on the card: an inmate's by its cell, the player's by its own name. */
function entrantName(sim: Sim, e: Entrant): string {
  return e.owner < 0 ? ratName(sim) : (t('race.names').split('|')[e.name] ?? '');
}

// ------------------------------------------------------------------ race night's reminder

/** After each step: the card going up on a race night (once, in a game of one's own: a lesson guides its own way). */
export function raceStep(sim: Sim) {
  const g = play.game;
  const s = sim.state;
  if (!g || g.lesson || g.over || s.sleeping || s.step % STEPS_PER_MINUTE !== 0 || sim.rules215) return;
  if (clockAt(s.step).minuteOfDay !== cardMinute(sim) || !cardUp(sim) || s.solitary > 0 || sim.away || s.stowed) return;
  const pet = petOf(s);
  sound.chime();
  const time = hhmm(RACE_MINUTE);
  banner.toast(
    pet && pet.mode === RAT.SHOULDER ? t('toast.raceNightPet', { name: ratName(sim), time }) : t('toast.raceNight', { time }),
    'info',
    5200,
  );
}

// ------------------------------------------------------------------ the race card

const raceView: RaceView = {
  phase: 'card',
  at: '',
  lanes: [],
  bet: null,
  enter: '',
  entered: '',
  why: '',
  result: '',
  cash: 0,
  day: 0,
  call: '',
  risk: '',
  seen: false,
};

/** 2.41: what the player has heard of a rival's rat today (gossip kept in the file): fed, hungry, or null nothing. */
function heardFed(day: number, owner: number): boolean | null {
  const r = director.rumors.find((x) => x.fact.key === `ratFed:${day}:${owner}`);
  return r ? r.fact.kind === 'ratFed' : null;
}

/** 2.41: the race called as it's run: the off, who leads (a change held a moment), neck and neck, pulling clear. */
const calling = { day: -1, lead: -1, text: '', until: 0 };
function callOf(sim: Sim, card: readonly Entrant[], at: readonly number[], f: number, day: number): string {
  const now = performance.now();
  if (calling.day !== day) Object.assign(calling, { day, lead: -1, text: '', until: 0 });
  if (f < 0.12) return t('race.call.off');
  const order = card.map((_, k) => k).sort((a, b) => at[b] - at[a] || a - b);
  const [a, b] = order;
  const gap = b === undefined ? 1 : at[a] - at[b];
  const name = (k: number) => entrantName(sim, card[k]);
  if (now < calling.until && a === calling.lead) return calling.text;
  const text =
    a !== calling.lead
      ? t('race.call.lead', { name: name(a) })
      : f > 0.85 && gap < 0.03 && b !== undefined
        ? t('race.call.line', { name: name(a), other: name(b) })
        : gap < 0.04 && b !== undefined
          ? t('race.call.close', { name: name(a), other: name(b) })
          : gap > 0.1
            ? t('race.call.clear', { name: name(a) })
            : t('race.call.front', { name: name(a) });
  Object.assign(calling, { lead: a, text, until: now + 1500 });
  return text;
}
const lanePool: RaceLane[] = [];

/** How far along each lane is at a fraction of the race (0–1 of the winner's distance). */
function positions(legs: number[][], f: number, out: number[]) {
  let end = 1;
  for (const l of legs) end = Math.max(end, l[LEGS - 1]);
  const x = Math.max(0, Math.min(1, f)) * LEGS;
  const k = Math.floor(x);
  legs.forEach((l, i) => {
    const a = k === 0 ? 0 : l[k - 1];
    const b = l[Math.min(LEGS - 1, k)];
    out[i] = Math.min(1, (a + (b - a) * (x - k)) / end);
  });
}
const pos: number[] = [];

/** The race card: up at the track on a race night until the off; the race as it's run (with a bet on, or the pet in it); the result a moment after. */
export function raceNow(sim: Sim, a: number): RaceView | null {
  const s = sim.state;
  const track = trackOf(sim.world);
  if (!track || s.layer !== LAYER.GROUND) return null;
  const day = prisonDay(s.step);
  const now = performance.now();
  const v = raceView;
  const running = s.race[RACE.DAY] === day && s.race[RACE.ON] === 1;
  const showResult = !running && result && result.day === day && now - result.at < RESULT_MS;
  if (!running && !showResult && !(cardUp(sim) && atTrack(sim))) return null;
  v.day = day;
  v.cash = s.cash;
  v.entered = '';
  v.at = formatTime(clockAt((day - 1) * 1440 * STEPS_PER_MINUTE + (RACE_MINUTE - 480) * STEPS_PER_MINUTE));
  const card = showResult ? result!.card : raceCard(s, day);
  const odds = oddsOf(s.salt, day, card);
  const pet = petLane(card);
  v.lanes.length = 0;
  card.forEach((e, k) => {
    const l = (lanePool[k] ??= {
      name: '',
      owner: '',
      speed: 0,
      odds: 0,
      mine: false,
      fed: null,
      heard: false,
      lead: false,
      pos: 0,
      place: 0,
    });
    l.name = entrantName(sim, e);
    l.owner = e.owner >= 0 ? inmateName(sim, e.owner) : '';
    l.speed = e.speed;
    l.odds = odds[k];
    l.mine = k === pet;
    // (The player knows whether their own rat ate; the rivals', only the gossip says: 2.41, what was heard.)
    const heard = l.mine ? null : heardFed(day, e.owner);
    l.fed = l.mine ? e.fed : heard;
    l.heard = heard !== null;
    l.lead = false;
    l.pos = 0;
    l.place = 0;
    v.lanes.push(l);
  });
  // (2.41: a guard who sees the player at it with a bet on while it's run: heat, once. Said before the bet, and while it's
  // run till charged: red as a guard sees them then.)
  v.seen = running && eyesOn(s, s.step);
  v.risk = sim.rules240 || (running && s.race[RACE.SEEN] === 1) ? '' : t(v.seen ? 'race.riskSeen' : 'race.risk', { n: DICE_HEAT });
  v.call = '';
  const lane = s.race[RACE.DAY] === day ? s.race[RACE.LANE] : -1;
  v.bet =
    lane >= 0
      ? { lane, stake: BETS[s.race[RACE.STAKE]], odds: s.race[RACE.ODDS] }
      : showResult && result!.lane >= 0
        ? { lane: result!.lane, stake: result!.stake, odds: result!.odds }
        : null;
  if (running) {
    v.phase = 'running';
    const run = runRace(s.salt, day, card);
    const f = (s.step - s.race[RACE.AT] + a) / RACE_STEPS;
    positions(run.legs, f, pos);
    v.lanes.forEach((l, k) => (l.pos = pos[k]));
    // (2.41: the leader marked and the race called; the risk only with a bet on.)
    if (!sim.rules240) {
      let lead = 0;
      v.lanes.forEach((l, k) => {
        if (l.pos > v.lanes[lead].pos) lead = k;
      });
      v.lanes[lead].lead = true;
      v.call = callOf(sim, card, pos, f, day);
    }
    if (!v.bet) v.risk = '';
    v.result = '';
    v.enter = '';
    v.why = '';
    return v;
  }
  if (showResult) {
    v.phase = 'result';
    result!.order.forEach((ln, k) => {
      if (v.lanes[ln]) {
        v.lanes[ln].place = k + 1;
        v.lanes[ln].pos = result!.final[ln] ?? 1;
      }
    });
    const w = card[result!.order[0]];
    const said = w
      ? result!.won
        ? t('race.resultWon', { name: entrantName(sim, w), n: result!.won })
        : t('race.result', { name: entrantName(sim, w) })
      : '';
    const photo = result!.photo ? `${t('race.photo')} ` : '';
    v.result = photo + (result!.purse ? `${said} ${t('toast.purse', { n: result!.purse })}` : said);
    v.risk = '';
    v.enter = '';
    v.why = '';
    return v;
  }
  v.phase = 'card';
  v.result = '';
  const why = raceCheck(sim);
  v.why = why ? t(`refused.${why}` as Key) : '';
  const p = petOf(s);
  const entered = s.race[RACE.DAY] === day && s.race[RACE.ENTERED] === 1;
  v.enter = p && p.mode === RAT.SHOULDER && !entered ? ratName(sim) : '';
  v.entered = entered ? ratName(sim) : '';
  return v;
}

// ------------------------------------------------------------------ the picture

const frame: LongFrame = { beds: [], track: null, rats: [], laps: null, tipsy: false, flash: 0 };
const bedPool: LongFrame['beds'] = [];
const ratPool: LongFrame['rats'] = [];

/**
 * The long games in the frame: the garden's beds (crop, stage, wilted, watered today, ripe), the
 * track (its tiles), the rats down it while a race is run, the pet's laps on its track at home,
 * and the player tipsy (the walk sways).
 */
export function longFrameOf(sim: Sim, a: number): LongFrame {
  const s = sim.state;
  const w = sim.world;
  const f = frame;
  f.beds.length = 0;
  const n = bedCount(w);
  for (let k = 0; k < n; k++) {
    const b = bedOf(s.plots, k);
    const v = (bedPool[k] ??= { tile: 0, crop: 0, grown: 0, wilted: false, watered: false, ripe: false, hole: false, theirs: false });
    v.theirs = bedOwner(s, k) >= 0;
    v.tile = bedTile(w, k);
    v.hole = w.ground.kind[v.tile] === TILE.SHAFT;
    v.crop = b[BED.CROP];
    v.grown = b[BED.GROWN];
    v.wilted = wilted(b);
    v.watered = b[BED.WATER] > 0;
    v.ripe = ripe(b);
    f.beds.push(v);
  }
  const track = trackOf(w);
  f.track = track ? tilesOf(track) : null;
  f.rats.length = 0;
  const day = prisonDay(s.step);
  if (track && s.race[RACE.DAY] === day && s.race[RACE.ON] === 1) {
    const card = raceCard(s, day);
    const run = runRace(s.salt, day, card);
    positions(run.legs, (s.step - s.race[RACE.AT] + a) / RACE_STEPS, pos);
    card.forEach((_, k) => {
      const r = (ratPool[k] ??= { lane: 0, of: 0, pos: 0, pet: false });
      r.lane = k;
      r.of = card.length;
      r.pos = pos[k];
      r.pet = card[k].owner < 0;
      f.rats.push(r);
    });
  }
  // (2.41: a photo finish: the camera's flash at the line as they cross it.)
  const since = result ? performance.now() - result.at : Infinity;
  f.flash = track && result && result.photo && result.day === day && since < FLASH_MS ? 1 - since / FLASH_MS : 0;
  if (!f.rats.length && track && result && result.day === day && performance.now() - result.at < RESULT_MS) {
    // (At the finish line a moment after.)
    result.card.forEach((_, k) => {
      const r = (ratPool[k] ??= { lane: 0, of: 0, pos: 0, pet: false });
      r.lane = k;
      r.of = result!.card.length;
      r.pos = result!.final[k] ?? 1;
      r.pet = result!.card[k].owner < 0;
      f.rats.push(r);
    });
  }
  const pet = petOf(s);
  if (pet && (pet.lap ?? 0) > s.step && s.layer === LAYER.GROUND) {
    // (A load mid-session: the spot worked out from where the player is now.)
    lapAt ??= lapSpot(sim);
    lapFrame.x = lapAt.x;
    lapFrame.z = lapAt.z;
    // (2.43: round the ring as the sim has it, the bait at its front; a catch lights the bait a moment.)
    const r = ratRunning(s);
    lapFrame.turn = r ? runTurn(s.step + a, r) : null;
    const since = performance.now() - baitAt;
    lapFrame.bait = r ? (since < BAIT_MS ? (baitHit ? 1 : -1) * (1 - since / BAIT_MS) : 0) : null;
    f.laps = lapFrame;
  } else {
    lapAt = null;
    f.laps = null;
  }
  f.tipsy = tipsyNow(s);
  return f;
}

// ------------------------------------------------------------------ 2.43: the neighbours and pruno, out loud

/** An inmate within `tiles` of the player. */
function near(sim: Sim, who: number, tiles: number): boolean {
  const m = sim.state.inmates[who];
  const p = sim.state.player;
  return !!m && Math.hypot(m.body.x - p.x, m.body.z - p.z) <= tiles * UNIT;
}

/** One of a bank's lines ('|' between them), said by an inmate as a bubble (none with the chatter off). */
function neighbourLine(sim: Sim, who: number, bank: Key, style: 'say' | 'shout' = 'say') {
  if (settings.chatter === 'off' || !sim.state.inmates[who]) return;
  const lines = t(bank).split('|');
  director.line(performance.now() / 1000, who, lines[Math.floor(Math.random() * lines.length)], 3, style, 0.2, 3);
}

/** When the next word about the player's state may come (performance.now()). */
let nextTipsyLine = 0;
let nextSwigLine = 0;
const PRUNO_ITEM = itemNumber('pruno');

/**
 * 2.43, every frame: tipsy, an inmate who can see the player has something to say about it now and then; with ripe pruno
 * in hand, a friend close by asks for a swig (a gift, the talk's own). Bubbles only, nothing in the sim.
 */
export function longTalk(sim: Sim, busy: boolean) {
  const s = sim.state;
  const now = performance.now();
  if (!busy) gardenReminder(sim);
  if (busy || settings.chatter === 'off' || s.layer !== LAYER.GROUND) return;
  const tipsy = tipsyNow(s);
  const swig = itemOf(s.items.inv[s.items.hand]) === PRUNO_ITEM;
  if (!tipsy && !swig) return;
  if (tipsy && now < nextTipsyLine) return;
  if (!tipsy && now < nextSwigLine) return;
  const p = s.player;
  let best = -1;
  let bestD = Infinity;
  s.inmates.forEach((m, k) => {
    if (m.ko > 0 || m.angry > 0 || m.doing === DOING.SLEEP || s.talk === k) return;
    const d = Math.hypot(m.body.x - p.x, m.body.z - p.z);
    if (d > (tipsy ? 6 : 4) * UNIT || d >= bestD || (!tipsy && m.opinion < SWIG_OPINION)) return;
    if (!lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z)) return;
    best = k;
    bestD = d;
  });
  if (best < 0) return;
  if (tipsy) {
    nextTipsyLine = now + 7000 + Math.random() * 5000;
    neighbourLine(sim, best, 'pruno.seen', Math.random() < 0.5 ? 'shout' : 'say');
  } else {
    nextSwigLine = now + 40000;
    neighbourLine(sim, best, 'pruno.ask');
  }
}
/** The opinion a friend asks for a swig at. */
const SWIG_OPINION = 50;

/** The prison day the evening's reminder about the garden was last given. */
let remindedDay = 0;

/**
 * 2.43: from 18:00, once a day, the player's own beds still wanting water today (not ripe, not rained on, fewer cupfuls
 * than the day needs): a word, while there's still time (the garden's open until 22:00). Not in a run from before.
 */
function gardenReminder(sim: Sim) {
  const s = sim.state;
  if (sim.rules242 || !s.plots.length || clockAt(s.step).minuteOfDay < REMIND_MINUTE) return;
  const day = prisonDay(s.step);
  if (remindedDay === day) return;
  const weather = planOf(sim).weather;
  if (weather === 'rain' || weather === 'storm') return;
  const need = weather === 'heatwave' ? HEATWAVE_WATER : 1;
  const dry = s.plots.filter((b, k) => b[BED.CROP] !== CROP.NONE && !ripe(b) && b[BED.WATER] < need && bedOwner(s, k) < 0).length;
  remindedDay = day;
  if (!dry || s.lockdown) return;
  sound.chime();
  // (A heatwave: two cups a day, so a bed watered once is still short; said so.)
  const key = need > 1 ? 'toast.gardenThirstyHeat' : dry === 1 ? 'toast.gardenThirstyOne' : 'toast.gardenThirsty';
  banner.toast(t(key, { n: dry }), 'info', 5000);
}
const REMIND_MINUTE = 18 * 60;

// ------------------------------------------------------------------ 2.43: the rat's training, a timing game

/** Where the rat's ring is set down (tiles), while its laps are run. */
export const ratRingAt = (): { x: number; z: number } | null => lapAt;

/** 2.43: pruno drunk: the bag held at the lips until then (performance.now()). */
let swigEnd = 0;
const SWIG_MS = 1600;
export const swigUntil = () => swigEnd;

/** Each lap's pass as the player pressed for it (the sim keeps the count; the card shows which). */
const runMarks: Array<'hit' | 'miss' | ''> = new Array<'hit' | 'miss' | ''>(RAT_LAPS).fill('');
/** The last press's moment and whether it caught the bait (the bait lights or dims a moment in the picture). */
let baitAt = -Infinity;
let baitHit = false;
const BAIT_MS = 350;
const ratView: RatRunView = { name: '', speed: 0, marks: runMarks, turn: 0, count: 0, how: '' };
let runStepSeen = -1;
let runStepAt = 0;

/** Round the ring at a step (between steps too): 0 at the bait, the way it runs. */
const runTurn = (at: number, r: readonly number[]) => {
  const lap = ratLap(r[RR.SPEED]);
  return ((((at - r[RR.FROM]) / lap) % 1) + 1) % 1;
};

/** The rat's laps on the card (null: none running): its passes caught or missed so far, where it is round the ring. */
export function ratRunNow(sim: Sim): RatRunView | null {
  const s = sim.state;
  const r = ratRunning(s);
  if (!r) return null;
  const now = performance.now();
  if (s.step !== runStepSeen) {
    runStepSeen = s.step;
    runStepAt = now;
  }
  const at = s.step + Math.min(1, (now - runStepAt) / 50);
  const lap = ratLap(r[RR.SPEED]);
  // (A pass gone by unpressed for: missed.)
  for (let k = 0; k < RAT_LAPS; k++) if (!runMarks[k] && at > r[RR.FROM] + k * lap + RAT_WINDOW) runMarks[k] = 'miss';
  const v = ratView;
  v.name = ratName(sim);
  v.speed = r[RR.SPEED];
  v.turn = runTurn(at, r);
  v.count = at < r[RR.FROM] - RAT_WINDOW ? 1 : 0;
  v.how = t(TOUCH ? 'track.howTouch' : 'track.howKeys', { name: v.name });
  return v;
}

/** The pet is away running on the track (a race, its laps): not on the shoulder in the picture. */
export function petOnTrack(sim: Sim): boolean {
  const s = sim.state;
  const pet = petOf(s);
  if (!pet) return false;
  const day = prisonDay(s.step);
  // (And a moment after its race, at the finish line on the result's card.)
  const finish = !!result && result.day === day && performance.now() - result.at < RESULT_MS && result.card.some((e) => e.owner < 0);
  return (s.race[RACE.DAY] === day && s.race[RACE.ON] === 1 && s.race[RACE.ENTERED] === 1) || (pet.lap ?? 0) > s.step || finish;
}

const lapFrame: NonNullable<LongFrame['laps']> = { x: 0, z: 0, turn: null, bait: null };
/** A free floor tile beside the player (east, south, west, north; else their own), for the home track: its middle, in tiles. */
function lapSpot(sim: Sim): { x: number; z: number } {
  const w = sim.world;
  const x0 = Math.floor(sim.state.player.x / UNIT);
  const z0 = Math.floor(sim.state.player.z / UNIT);
  const zone = w.zoneAt(x0, z0);
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]) {
    const x = x0 + dx;
    const z = z0 + dz;
    if (w.blocked(x, z) || w.zoneAt(x, z) !== zone || w.props.some((p) => x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d)) continue;
    return { x: x + 0.5, z: z + 0.5 };
  }
  return { x: x0 + 0.5, z: z0 + 0.5 };
}
/** The track's tiles, worked out once a track. */
const tilesCache = new WeakMap<object, number[]>();
function tilesOf(t: NonNullable<ReturnType<typeof trackOf>>): number[] {
  let v = tilesCache.get(t);
  if (!v) tilesCache.set(t, (v = trackTiles(t)));
  return v;
}
