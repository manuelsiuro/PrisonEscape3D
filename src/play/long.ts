import { buzz } from '../app/haptics';
import { CROP, GROWN, LEGS, RACE_MINUTE, RACE_STEPS, TAKE, TIPSY_HEAT, WATER_MAX } from '../content/long';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { clockAt, formatTime, prisonDay } from '../sim/systems/clock';
import { BED, bedCount, bedOf, bedTile, ripe, wilted } from '../sim/systems/garden';
import { takeCheck } from '../sim/systems/pantry';
import { atTrack, cardMinute, cardUp, oddsOf, petLane, RACE, raceCard, raceCheck, raceNight, runRace, trackOf, trackTiles, type Entrant } from '../sim/systems/races';
import { petOf, RAT } from '../sim/systems/rats';
import { tipsyNow } from '../sim/systems/pruno';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { LAYER, MAP_W } from '../sim/world/World';
import { TILE } from '../sim/world/tiles';
import { BETS } from '../content/long';
import type { LongFrame } from '../render/Long';
import type { RaceLane, RaceView } from '../ui/long';
import { itemName } from '../ui/items';
import { inmateName } from '../ui/social';
import { banner, combatUI, itemsUI, sound, view } from './context';
import { play } from './game';
import { ratName } from './rat';
import { coachOnce } from './tips';
import { treatOffers } from './holidays';

/**
 * Long games (P28) on screen: what can be taken from the open furniture, the race card, the
 * sounds, toasts and floats of the events, and what the picture shows (the garden's beds as they
 * grow, the rats down the track, the pet's laps at home, the player tipsy). All of it from the
 * sim's own rules (pantry.ts, garden.ts, pruno.ts, races.ts).
 */

const floatPoint = { x: 0, y: 0 };
function floatUp(text: string, kind: 'cash' | 'gain' | 'taken') {
  const at = view.screenOf(-1, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

// ------------------------------------------------------------------ the open furniture

export const NO_TAKE: ReadonlyArray<{ what: number; label: string; why: string }> = [];
const offers: Array<{ what: number; label: string; why: string }> = [];
const TAKES_OF: Record<string, readonly number[]> = { canteenCounter: [TAKE.FRUIT], kitchenFreezer: [TAKE.SUGAR], libraryShelf: [TAKE.VEG_SEEDS, TAKE.FRUIT_SEEDS] };
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
    offers.push({ what, label: t(TAKE_LABEL[what]), why: why === 'notMeal' ? t('take.notMeal') : why === 'takenToday' ? t(what === TAKE.FRUIT ? 'take.meal' : 'take.today') : why === 'room' ? t('refused.room') : '' });
  }
  return offers;
}

// ------------------------------------------------------------------ the events

/** The last race's result, held a moment for the card (real ms). */
let result: { order: number[]; card: Entrant[]; final: number[]; at: number; lane: number; stake: number; odds: number; won: number; purse: number; day: number } | null = null;
/** Where the pet runs its laps at home (tiles: a free floor tile beside the player as it set off), held for the session. */
let lapAt: { x: number; z: number } | null = null;
const RESULT_MS = 6000;

export function resetLong() {
  result = null;
  lapAt = null;
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
        banner.toast(t('toast.drunk', { n: TIPSY_HEAT }), 'info', 5000);
        coachOnce('tipsy', 'hint.tipsy');
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
      } else if (e.what === 'ripe' || e.what === 'wilted' || e.what === 'died') {
        // (Once a kind a morning, however many beds.)
        const key = `${e.what}:${sim.state.step}`;
        if (gardenSaid.has(key)) break;
        gardenSaid.add(key);
        if (gardenSaid.size > 12) gardenSaid.clear();
        banner.toast(t(e.what === 'ripe' ? 'toast.bedRipe' : e.what === 'wilted' ? 'toast.bedWilted' : 'toast.bedDied'), e.what === 'ripe' ? 'good' : 'bad', 4000);
      }
      break;
    case 'track':
      if (e.what === 'trained') {
        lapAt = lapSpot(sim);
        sound.squeak(1);
        window.setTimeout(() => play.game === g && sound.patter(0.8), 300);
        floatUp(`+${e.gain} ${t('race.speedShort')}`, 'gain');
        itemsUI.toast(t('toast.ratTrained', { name: ratName(sim), item: lower(itemName(e.item ?? 0)), n: e.speed ?? 0 }));
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
        banner.toast(e.stake ? t('toast.ratScratchedBack', { name: ratName(sim), n: e.stake }) : t('toast.ratScratched', { name: ratName(sim) }), 'bad', 4200);
      }
      else if (e.what === 'start') {
        sound.whistle();
        sound.cheer();
        window.setTimeout(() => play.game === g && sound.patter(), 200);
      } else if (e.what === 'result') {
        // (The pet's lane: on the card it raced on, which the state no longer says.)
        const order = e.order ?? [];
        const raced = cardOf(sim, day, order.length);
        const fin: number[] = [];
        positions(runRace(sim.state.salt, day, raced).legs, 1, fin);
        result = { order, card: raced, final: fin, at: performance.now(), lane: e.lane ?? -1, stake: e.stake ?? 0, odds: e.odds ?? 0, won: e.won ?? 0, purse: e.purse ?? 0, day };
        sound.cheer();
        const winner = result.card[order[0]];
        const name = winner ? entrantName(sim, winner) : '';
        if (e.won || e.purse) {
          sound.coin(true);
          buzz('attended');
          if (e.won) floatUp(`+$${e.won}`, 'cash');
          const parts = [e.won ? t('toast.betWon', { n: e.won }) : '', e.purse ? t('toast.purse', { n: e.purse }) : ''].filter(Boolean).join(' ');
          banner.toast(`${t('toast.raceWinner', { name })} ${parts}`, 'good', 5000);
        } else banner.toast(e.lane !== undefined && e.lane >= 0 ? t('toast.betLost', { name }) : t('toast.raceWinner', { name }), e.lane !== undefined && e.lane >= 0 ? 'bad' : 'info', 4500);
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

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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
  const time = `${String(Math.floor(RACE_MINUTE / 60)).padStart(2, '0')}:${String(RACE_MINUTE % 60).padStart(2, '0')}`;
  banner.toast(pet && pet.mode === RAT.SHOULDER ? t('toast.raceNightPet', { name: ratName(sim), time }) : t('toast.raceNight', { time }), 'info', 5200);
}

// ------------------------------------------------------------------ the race card

const raceView: RaceView = { phase: 'card', at: '', lanes: [], bet: null, enter: '', entered: '', why: '', result: '', cash: 0, day: 0 };
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
    const l = (lanePool[k] ??= { name: '', owner: '', speed: 0, odds: 0, mine: false, fed: null, pos: 0, place: 0 });
    l.name = entrantName(sim, e);
    l.owner = e.owner >= 0 ? inmateName(sim, e.owner) : '';
    l.speed = e.speed;
    l.odds = odds[k];
    l.mine = k === pet;
    // (The player knows whether their own rat ate; the rivals', only the gossip says.)
    l.fed = l.mine ? e.fed : null;
    l.pos = 0;
    l.place = 0;
    v.lanes.push(l);
  });
  const lane = s.race[RACE.DAY] === day ? s.race[RACE.LANE] : -1;
  v.bet = lane >= 0 ? { lane, stake: BETS[s.race[RACE.STAKE]], odds: s.race[RACE.ODDS] } : showResult && result!.lane >= 0 ? { lane: result!.lane, stake: result!.stake, odds: result!.odds } : null;
  if (running) {
    v.phase = 'running';
    const run = runRace(s.salt, day, card);
    positions(run.legs, (s.step - s.race[RACE.AT] + a) / RACE_STEPS, pos);
    v.lanes.forEach((l, k) => (l.pos = pos[k]));
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
    const said = w ? (result!.won ? t('race.resultWon', { name: entrantName(sim, w), n: result!.won }) : t('race.result', { name: entrantName(sim, w) })) : '';
    v.result = result!.purse ? `${said} ${t('toast.purse', { n: result!.purse })}` : said;
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

const frame: LongFrame = { beds: [], track: null, rats: [], laps: null, tipsy: false };
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
    const v = (bedPool[k] ??= { tile: 0, crop: 0, grown: 0, wilted: false, watered: false, ripe: false, hole: false });
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
  } else if (track && result && result.day === day && performance.now() - result.at < RESULT_MS) {
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
    f.laps = lapFrame;
  } else {
    lapAt = null;
    f.laps = null;
  }
  f.tipsy = tipsyNow(s);
  return f;
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

const lapFrame = { x: 0, z: 0 };
/** A free floor tile beside the player (east, south, west, north; else their own), for the home track: its middle, in tiles. */
function lapSpot(sim: Sim): { x: number; z: number } {
  const w = sim.world;
  const x0 = Math.floor(sim.state.player.x / UNIT);
  const z0 = Math.floor(sim.state.player.z / UNIT);
  const zone = w.zoneAt(x0, z0);
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
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

/** The race nights (for the help and the lessons): tonight's a race night. */
export const raceTonight = (sim: Sim) => raceNight(prisonDay(sim.state.step)) && !!trackOf(sim.world);

/** A garden bed's tile (the lessons' arrows). */
export const bedTileOf = (sim: Sim, k: number) => bedTile(sim.world, k);
/** The track's start (the lessons' arrows). */
export const trackStart = (sim: Sim) => {
  const t0 = trackOf(sim.world);
  return t0 ? trackTiles(t0)[0] : -1;
};
void MAP_W;
