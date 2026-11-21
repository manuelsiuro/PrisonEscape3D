import { NIGHT_FROM, NIGHT_TO, STEPS_PER_MINUTE } from '../../sim/tuning';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { pieceOf } from '../content/build';
import { CITY_ITEMS, cityItem, cityItemNumber } from '../content/items';
import { LEFT, RUSH, SUPPLIES } from '../content/rush';
import { PLACES, TUNNEL } from '../gen/tunnel';
import { builtHere, removePiece } from './build';
import { START_MINUTE, type City } from './City';
import { danger, rushWave } from './dead';
import { going } from './story';
import { skillUp } from './skills';
import { SKILL, SKILL_POINTS } from '../content/alive';

/**
 * Nights (C5 batch 3, 2.68), a part of the city's simulation: the Rush (every third night, cities begun from 2.68), and a base left
 * to the nights. The Rush's dead and the traps are dead.ts's; a sleeper in a base looked for, its `siege`.
 */

const N = MAP_W * MAP_H;
/** The game minute since day 1's midnight, of a step. */
const minuteOf = (step: number) => START_MINUTE + Math.floor(step / STEPS_PER_MINUTE);

/**
 * The save's part: the Rushes held; the step each place was last left; the waves put down this Rush ([its night, how many]); the
 * Rush's dead about when a checkpoint was crossed, to come after the player into the next district.
 */
export const freshRush = () => ({ held: 0, left: [] as number[], waves: [] as number[], follow: 0 });

/** A save's fields made sound before the city is built from it. */
export function soundRush(st: { held?: unknown; left?: unknown; waves?: unknown; follow?: unknown }) {
  const whole = (v: unknown, most: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= most;
  if (!whole(st.held, 999)) st.held = 0;
  const left = st.left;
  st.left = Array.isArray(left) && left.length === PLACES && left.every((n) => whole(n, 1e9)) ? left : [];
  const w = st.waves;
  st.waves = Array.isArray(w) && w.length === 2 && whole(w[0], 99_999) && whole(w[1], RUSH.waves.length) ? w : [];
  if (!whole(st.follow, 180)) st.follow = 0;
}

/** The night it is, or the coming one by day: the night that began (or begins) on day n is night n. */
export const nightOf = (c: City) => (c.minute < NIGHT_TO ? c.day - 1 : c.day);
/** Whether night n is a Rush's (a city begun from 2.68). */
export const isRush = (c: City, n: number) => c.state.rev >= RUSH.rev && n >= RUSH.every && n % RUSH.every === 0;
/** The Rush is on: from 21:00 to 05:00 of a Rush's night. */
export const rushNow = (c: City) => (c.minute >= NIGHT_FROM || c.minute < NIGHT_TO) && isRush(c, nightOf(c));
/** Which Rush a night's is (1 the first). */
export const rushNumber = (n: number) => Math.floor(n / RUSH.every);
/** 2.68: no sleep from 20:00 on a Rush's day until 05:00. */
export const noSleep = (c: City) => (c.minute >= 20 * 60 && isRush(c, c.day)) || (c.minute < NIGHT_TO && isRush(c, c.day - 1));
/** The waves put down so far this Rush (0 before the first, or where none came: the tunnel, a way out's night). */
export function wavesIn(c: City): number {
  if (!rushNow(c)) return 0;
  const w = c.state.waves;
  return w.length === 2 && w[0] === nightOf(c) ? w[1] : 0;
}
/** 2.68: where the Rush can't reach the player: the tunnel, and a district a way out's beacon or generator calls already. */
const outOfIt = (c: City) => c.state.district === TUNNEL || going(c) === 1;

/** A wave's size: the Rush's number, the wave's, the district's danger. */
export function waveSize(c: City, n: number, k: number): number {
  return Math.min(
    RUSH.most,
    RUSH.base + RUSH.perRush * (rushNumber(n) - 1) + RUSH.perWave * k + RUSH.perDanger * danger(c, c.state.district),
  );
}

/** Minutes to the next Rush's first wave, while one is due today or on (-1: none due today). For the HUD. */
export function rushDue(c: City): number {
  if (c.state.rev < RUSH.rev) return -1;
  if (rushNow(c)) return outOfIt(c) ? -1 : 0;
  if (!isRush(c, c.day) || c.minute < NIGHT_TO) return -1;
  return RUSH.waves[0] - c.minute;
}

/**
 * A game minute (stepDead's, above ground and not at peace): the Rush said at dawn and before dusk, begun at nightfall, its waves on
 * the hour, and held at 05:00: supplies dropped beside the player.
 */
export function rushMinute(c: City) {
  const s = c.state;
  if (s.rev < RUSH.rev) return;
  const m = c.minute;
  if (RUSH.warn.includes(m as 360 | 1140) && isRush(c, c.day))
    c.events.push({ type: 'rush', what: 'warn', n: c.day, soon: NIGHT_FROM - m });
  if (m === NIGHT_FROM && isRush(c, c.day) && !outOfIt(c)) c.events.push({ type: 'rush', what: 'begin', n: c.day });
  // (At 05:00 the night that ends is the day before's.)
  const n = m === NIGHT_TO ? c.day - 1 : nightOf(c);
  if (!isRush(c, n)) return;
  const k = RUSH.waves.indexOf(m as 1320);
  // (A way out set going here calls the district's dead already: its night is the Rush enough.)
  if (k >= 0 && !outOfIt(c)) {
    const put = rushWave(c, waveSize(c, n, k), rushNumber(n), k);
    // (Counted in the save: the HUD's wave, a crossing's, and whether there was a Rush to hold at all.)
    s.waves = [n, (s.waves.length === 2 && s.waves[0] === n ? s.waves[1] : 0) + 1];
    c.events.push({ type: 'rush', what: 'wave', n, wave: k + 1, size: put });
  }
  if (m === NIGHT_TO) {
    for (const z of s.zeds) z.rush = undefined;
    // (2.68, the review: the night spent in the tunnel or on a way out's night held nothing: no wave came.)
    if (!(s.waves.length === 2 && s.waves[0] === n && s.waves[1] > 0)) return;
    // Held: what's left of it goes as the others do at dawn; supplies beside the player.
    const tier = SUPPLIES[Math.min(s.held, SUPPLIES.length - 1)];
    s.held++;
    for (const [id, count] of tier) c.drop(c.tile, cityItemNumber(id), count);
    // (2.69, a city begun from then: a manual not yet read nor carried from the second Rush held; a padded jacket from the third.)
    if (s.rev >= 5 && s.held >= 2) {
      const manual = CITY_ITEMS.findIndex(
        (d) => d.manual !== undefined && !(s.manuals & (1 << d.manual)) && !c.count(cityItemNumber(d.id)),
      );
      if (manual >= 0) c.drop(c.tile, manual + 1, 1);
      if (s.held >= 3) c.drop(c.tile, cityItemNumber('padded_jacket'), cityItem(cityItemNumber('padded_jacket'))!.wear!);
    }
    skillUp(c, SKILL.SURVIVALIST, SKILL_POINTS.rush);
    c.events.push({ type: 'rush', what: 'held', n, tile: c.tile });
  }
}

/** 2.68: a checkpoint crossed mid-Rush: the Rush's dead about are counted, to follow (the save keeps the count). */
export function rushCrossing(c: City) {
  const s = c.state;
  s.follow = rushNow(c) ? Math.min(180, s.zeds.filter((z) => z.rush && (z.down ?? 0) <= 0).length) : 0;
}

/**
 * 2.68: a district crossed into mid-Rush: the Rush's dead that were about come after the player, put down out of sight (the review:
 * half the last wave let a checkpoint shed the rest of the night). None into the tunnel or a way out's night.
 */
export function rushFollows(c: City) {
  const s = c.state;
  const many = s.follow;
  s.follow = 0;
  if (!many || !rushNow(c) || outOfIt(c)) return;
  const n = nightOf(c);
  rushWave(c, Math.ceil((many * RUSH.follow) / 100), rushNumber(n), Math.max(0, wavesIn(c) - 1));
}

/** 2.68: carried home past a night by a fall: a Rush's day is said on waking (its 06:00 warning was slept through). */
export function rushOnWaking(c: City) {
  if (isRush(c, c.day) && c.minute >= NIGHT_TO && c.minute < NIGHT_FROM)
    c.events.push({ type: 'rush', what: 'warn', n: c.day, soon: NIGHT_FROM - c.minute });
}

/** Leaving a district: the step is kept (its base, if any, takes the nights while the player's away). */
export function leftDistrict(c: City, d: number) {
  const s = c.state;
  if (d === TUNNEL || d < 0 || d >= PLACES) return;
  if (s.left.length !== PLACES) s.left = Array<number>(PLACES).fill(0);
  s.left[d] = s.step;
}

/**
 * 2.68: back in a district after nights away: each piece the dead could walk up to (beside a tile they reach from the streets) has
 * taken the nights' harm: so much a night, more for the danger and where a light burns; a Rush's night counts as three. Pieces at
 * none are gone (what they held on the ground). Said: how many were damaged and lost.
 */
export function baseReturned(c: City) {
  const s = c.state;
  const d = s.district;
  if (d === TUNNEL || s.left.length !== PLACES || !s.left[d]) return;
  const from = s.left[d];
  s.left[d] = 0;
  const list = builtHere(c);
  if (!list.length) return;
  // The nights away: each midnight passed while away is a night (the review: nightfalls counted a step across 21:00 as one, and
  // missed a night left after 21:00 and come back to before dawn). The midnight beginning day D ends night D − 1.
  const dayOf = (step: number) => Math.floor(minuteOf(step) / 1440) + 1;
  const a = dayOf(from);
  const b = dayOf(s.step);
  let nights = 0;
  for (let day = a + 1; day <= b; day++) nights += isRush(c, day - 1) ? LEFT.rushTimes : 1;
  if (!nights) return;
  // Where the dead walk: the streets and all they reach on foot (what's built and the barred doors stopping them).
  const reach = new Uint8Array(N);
  const queue: number[] = [];
  for (const t of c.zedPlaces.streets)
    if (!c.zedGrid[t] && !reach[t]) {
      reach[t] = 1;
      queue.push(t);
    }
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q];
    const x = t % MAP_W;
    for (const u of [t - MAP_W, t + MAP_W, x > 0 ? t - 1 : -1, x < MAP_W - 1 ? t + 1 : -1]) {
      if (u < 0 || u >= N || reach[u] || c.zedGrid[u]) continue;
      reach[u] = 1;
      queue.push(u);
    }
  }
  const dg = danger(c, d);
  let damaged = 0;
  let lost = 0;
  for (const p of [...list]) {
    const [t, kind] = p;
    const def = pieceOf(kind);
    if (!def) continue;
    const x = t % MAP_W;
    const out = reach[t] || [t - MAP_W, t + MAP_W, x > 0 ? t - 1 : -1, x < MAP_W - 1 ? t + 1 : -1].some((u) => u >= 0 && u < N && reach[u]);
    if (!out) continue;
    let harm = nights * (LEFT.perNight + LEFT.perDanger * dg);
    if (c.lit[t]) harm += Math.floor((harm * LEFT.litMore) / 100);
    if (!def.solid) harm = Math.ceil(harm / 2);
    // (A little more or less for each piece, the same for a city and a tile: no draw.)
    harm = Math.max(1, harm + ((c.salt(t + b * 4096) >>> 0) % 7) - 3);
    p[2] -= harm;
    if (p[2] > 0) damaged++;
    else {
      lost++;
      removePiece(c, p);
    }
  }
  if (damaged || lost) c.piecesRev++;
  c.events.push({ type: 'baseHeld', damaged, lost, nights });
}
