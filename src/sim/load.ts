/**
 * A state loaded from a snapshot (a save, a keyframe, a replay file's start): fields a newer
 * game added load with their starting values, and anything damaged is put right or dropped.
 */
import type { PrisonDef } from '../content/prisons/types';
import { BLOCK, ROUTINE, routineAt } from '../content/routine';
import { maxHealth } from './systems/combat';
import { clockAt, dayMinute, prisonDay } from './systems/clock';
import { fighter, spawnInmates } from './systems/inmates';
import { fixtureUse, startItems, startPockets, type ItemState } from './systems/items';
import type { Body } from './systems/movement';
import { ORDER } from './command';
import { FEATS, freshFeats, partialLedger } from './systems/ledger';
import { dayPlan, keepOldCards } from './systems/calendar';
import { DAY_BOOKS, EVENT_TIMES } from '../content/days';
import { CATALOGUE } from '../content/smuggling';
import { BAR, CHIPS, CLAIM_MAX, HAND, STAKES } from '../content/games';
import type { Cheat } from './systems/cards';
import type { Shootout } from './systems/hoops';
import type { Board } from './systems/checkers';
import { bedCount } from './systems/garden';
import { BETS, CROP, ODDS_MAX, ODDS_MIN, RAT_START_SPEED } from '../content/long';
import type { Match } from './systems/football';
import type { Ink } from './systems/tattoo';
import type { Show } from './systems/talent';
import type { Quiz } from './systems/quiz';
import { ACT_GAP, CHARTS, countIn, QUIZ_QUESTIONS, REVEAL_STEPS, SONGS, songSteps } from '../content/nights';
import { DESIGNS } from '../content/team';
import { TILE } from './world/tiles';
import { ITEMS } from '../content/items';
import { COURSE_QUESTIONS, KIOSK_BLOCK, PHOTO_WALL, PHOTOS } from '../content/kiosk';
import { FROM, J, JOB_LEN, KINDS, PERK, STAGE } from '../content/oddjobs';
import { FREED_STEPS } from '../content/paperwork';
import { APPLY_AGAIN, HEARING_AFTER, RECORD } from '../content/parole';
import { freshParole, hearingOk, SCORE_MAX, SCORE_MIN } from './systems/parole';
import { HOLIDAYS } from '../content/holidays';
import { GUARD_STR, OPINION_START, START_STR, UNIT } from './tuning';
import { containersOf } from './world/containers';
import { MAP_H, MAP_W, type World } from './world/World';
import { freshState, type Call, type SimState } from './state';

/** An array of n whole numbers (a save's field checked before it's trusted). */
const ints = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x));

/**
 * A state loaded from a snapshot (a copy the caller owns). Fields added after the snapshot
 * was taken load with their starting values, in field order, so the state hashes the same
 * however it was made.
 */
export function loadState(world: World, prison: PrisonDef, st: Partial<SimState> & Pick<SimState, 'step' | 'rng' | 'player'>): SimState {
  const fresh = freshState(world, prison, st.rng);
  const out = {} as Record<keyof SimState, unknown>;
  for (const k of Object.keys(fresh) as Array<keyof SimState>) out[k] = st[k] ?? fresh[k];
  const s = out as SimState;
  // Starting values that depend on the loaded state (its time, its Strength, its RNG), and
  // lists fitted to this prison (a map edit may change how many guards, jobs, merchants or
  // cameras it has).
  s.routine = st.routine ?? routineAt(clockAt(st.step).minuteOfDay);
  s.inmates =
    st.inmates?.map((m0) => {
      const m = m0.hp === undefined ? { ...m0, ...fighter(45), angry: 0 } : m0;
      return m.opinion === undefined ? { ...m, opinion: OPINION_START, shift: 0 } : m;
    }) ?? spawnInmates(world, { rng: st.rng });
  s.items = fitItems(world, st.items, st.rng) ?? startItems(world, { rng: st.rng });
  // Guard fields added later (P15's ways) load at the end, in field order.
  s.guards =
    st.guards?.length === world.def.guards.length
      ? st.guards.map((g) => ({ ...g, resume: g.resume ?? 0, ...(g.hp === undefined ? fighter(GUARD_STR) : {}), doze: g.doze ?? 0, napDay: g.napDay ?? 0, stir: g.stir ?? 0, bribed: g.bribed ?? 0, paperDay: g.paperDay ?? 0 }))
      : fresh.guards;
  s.health = st.health ?? maxHealth(st.str ?? START_STR);
  s.jobs = st.jobs?.length === prison.jobs.length ? st.jobs : fresh.jobs;
  s.jobOpen = st.jobOpen?.length === prison.jobs.length ? st.jobOpen : prison.jobs.map((j) => (j.cell === 0 ? clockAt(st.step).day : 0));
  s.jobDay = st.jobDay ?? clockAt(st.step).day + 1;
  s.shops = st.shops?.length === prison.merchants.length ? st.shops : fresh.shops;
  s.cams = st.cams?.length === (prison.cameras ?? []).length ? st.cams : fresh.cams;
  // A save from before the ledger (P16): partial, its days so far unknown. Counters added since load at 0.
  // (A damaged one too: a ledger that isn't lists of numbers starts again, partial.)
  const list = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'number');
  if (!list(st.feats) || !list(st.days)) Object.assign(s, partialLedger(st.step));
  else if (st.feats!.length < FEATS.length) s.feats = [...st.feats!, ...freshFeats().slice(st.feats!.length)];
  if (!Array.isArray(s.mods) || !s.mods.every((m) => typeof m === 'string')) s.mods = [];
  // A save from before the day (P17): the day it was made on stays quiet (nothing starts half way through).
  const days = (v: unknown) => Array.isArray(v) && v.every((d) => Array.isArray(d) && (d.length === 3 || d.length === 5) && d.every((x) => Number.isInteger(x)));
  if (!days(st.calendar)) s.calendar = [[prisonDay(st.step), 0, 0]];
  if (!Number.isInteger(s.eventFlags)) s.eventFlags = 0;
  // A save from before delivery day (P18): the day it was made on, and tomorrow (the forecast, the gossip may have named it), keep the card the delivery took the place of.
  const loadDays = [prisonDay(st.step), prisonDay(st.step) + 1];
  const loadPlan = (day: number) => dayPlan(prison.id, s.salt, day, s.calendar, s.mods).event;
  const book = DAY_BOOKS[prison.id];
  if (st.stowed === undefined) keepOldCards(s, loadDays, loadPlan, { delivery: book?.before ?? 'none' });
  if (typeof s.stowed !== 'boolean') s.stowed = false;
  if (!Number.isInteger(s.stowCaught)) s.stowCaught = 0;
  // The dogs (P19): a save from before them (or for a prison whose dogs changed) has them in their kennels; a trail that isn't one is gone.
  s.dogs = Array.isArray(st.dogs) && st.dogs.length === fresh.dogs.length ? st.dogs.map((d, k) => ({ ...fresh.dogs[k], ...d })) : fresh.dogs;
  if (!Array.isArray(s.scent) || !s.scent.every((e) => Array.isArray(e) && (e.length === 2 || e.length === 3) && e.every((x) => Number.isInteger(x)))) s.scent = [];
  // The rats (P20): a save from before them has none (nor one that isn't a list of them).
  if (!Array.isArray(s.rats) || !s.rats.every((r) => !!r && typeof r === 'object' && Number.isInteger(r.mode) && Array.isArray(r.path))) s.rats = [];
  // (An errand to a container this prison no longer has, after a map edit: it gives it up and comes back.)
  // (RAT.OUT is 1, RAT.WAIT 4: an errand to nowhere waits instead.)
  for (const r of s.rats) if (r.target >= s.items.containers.length || (r.mode === 1 && r.target < 0)) Object.assign(r, { target: -1, mode: 4, path: [], at: 0 });
  // Smuggling (P21): a save from before it keeps the card visiting day took the place of, on the day it's loaded and the next (as delivery day did, P18).
  if (st.order === undefined) keepOldCards(s, loadDays, loadPlan, { visiting: book?.beforeVisits ?? 'none' });
  // (A damaged one: an order for nothing in the catalogue, a way that doesn't exist, a drop of no item.)
  if (!(Array.isArray(s.order) && (s.order.length === 0 || (ints(s.order, 3) && s.order[0] >= 0 && s.order[0] < CATALOGUE.length && (s.order[1] === 0 || s.order[1] === 1))))) s.order = [];
  if (!Array.isArray(s.drops) || !s.drops.every((d) => ints(d, 3) && d[1] >= 1 && d[1] <= ITEMS.length)) s.drops = [];
  // (A drop with nothing lying where it says: forgotten, never counted as picked up.)
  s.drops = s.drops.filter(([key, item]) => s.items.ground.some(([k, v]) => k === key && (v & 255) === item));
  if (!Number.isInteger(s.visit)) s.visit = 0;
  // Side games (P22): a save from before them keeps the card sports day took the place of, on the day it's loaded and the next.
  if (st.played === undefined) keepOldCards(s, loadDays, loadPlan, { sports: book?.beforeSports ?? 'none' });
  // (A damaged one: games with nobody, dice that aren't dice, a lock where there's no door.)
  const n = s.inmates.length;
  if (!Array.isArray(s.played) || !s.played.every((x) => Number.isInteger(x) && x >= 0)) s.played = [];
  if (!(Array.isArray(s.dice) && (s.dice.length === 0 || (ints(s.dice, 4) && s.dice[0] >= 0 && s.dice[0] < n && s.dice[1] >= 0 && s.dice[1] < STAKES.length && [s.dice[2], s.dice[3]].every((d) => d >= 1 && d <= 6))))) s.dice = [];
  if (!(Array.isArray(s.bout) && (s.bout.length === 0 || (ints(s.bout, 4) && s.bout[0] >= 0 && s.bout[0] < n && s.bout[1] > 0 && s.bout[1] < BAR)))) s.bout = [];
  const door = (t: number) => t >= 0 && t < world.ground.kind.length && world.ground.base[t] === TILE.DOOR;
  if (!(Array.isArray(s.pick) && (s.pick.length === 0 || (ints(s.pick, 3) && door(s.pick[0]) && s.pick[1] >= 0)))) s.pick = [];
  if (!Array.isArray(s.cheered) || !s.cheered.every((x) => Number.isInteger(x) && x >= 0)) s.cheered = [];
  if (!(Array.isArray(s.picked) && (s.picked.length === 0 || (ints(s.picked, 3) && door(s.picked[0]))))) s.picked = [];
  // The crew (P23): orders to someone who isn't following any more, or that aren't orders, are forgotten.
  const tiles = world.ground.kind.length;
  const crewOk = (c: unknown, k: number, all: unknown[]) => {
    if (!ints(c, 5)) return false;
    const [who, order, arg, aux, night] = c as number[];
    if (!s.followers.includes(who) || order < 0 || order > ORDER.FETCH || (night !== 0 && night !== 1) || all.findIndex((o) => (o as number[])[0] === who) !== k) return false;
    if (order === ORDER.WATCH) return arg >= 0 && arg < tiles;
    if (order === ORDER.DIG) return arg < tiles && aux < tiles;
    if (order === ORDER.BRAWL) return aux >= 0 && aux < n && aux !== who;
    if (order === ORDER.FETCH) return arg >= 0 || (aux >= 1 && aux <= ITEMS.length);
    return true;
  };
  s.crew = Array.isArray(s.crew) ? s.crew.filter(crewOk) : [];
  if (!Number.isInteger(s.brawled)) s.brawled = 0;
  if (!Array.isArray(s.crewOut) || !s.crewOut.every((x, k, all) => Number.isInteger(x) && x >= 0 && x < n && all.indexOf(x) === k)) s.crewOut = [];
  if (!Number.isInteger(s.waved) || s.waved < 0) s.waved = 0;
  // P27: a hand of Cheat, a shootout, a shot held, the old-timer's board; damaged ones are dropped.
  if (!cheatOk(s.cheat, n)) s.cheat = null;
  const so = s.shootout as Shootout | null;
  if (!(so === null || (!!so && typeof so === 'object' && [so.who, so.k, so.mine, so.theirs, so.turn, so.at].every((x) => Number.isInteger(x)) && so.who >= 0 && so.who < n && so.k >= 0 && so.k < 16 && (so.turn === 0 || so.turn === 1) && (so.due === undefined || (Number.isInteger(so.due) && so.due >= 0))))) s.shootout = null;
  const spots = prison.leisure?.hoop.spots.length ?? 0;
  if (!(Array.isArray(s.shot) && (s.shot.length === 0 || (ints(s.shot, 2) && s.shot[1] >= 0 && s.shot[1] < spots)))) s.shot = [];
  if (!Number.isInteger(s.practice) || s.practice < 0) s.practice = 0;
  if (!boardOk(s.board)) s.board = null;
  if (!ints(s.elder, 4) || s.elder.some((x) => x < 0)) s.elder = [0, 0, 0, 0];
  // P28: what was taken, tipsy, the garden (fitted to this prison's plot), tonight's race; damaged ones start again.
  if (ints(s.pantry, 3)) s.pantry = [...s.pantry, 0];
  if (!ints(s.pantry, 4)) s.pantry = [0, 0, 0, 0];
  if (!(Array.isArray(s.tipsy) && (s.tipsy.length === 0 || ints(s.tipsy, 2)))) s.tipsy = [];
  const beds = bedCount(world);
  if (!(Array.isArray(s.plots) && s.plots.length <= beds && s.plots.every((b) => ints(b, 4) && b[0] >= CROP.NONE && b[0] <= CROP.FRUIT && b[1] >= 0 && b[2] >= 0 && b[3] >= 0))) s.plots = [];
  // (A race as it can be: today or before, a lane on the card and a stake with odds when bet, flags 0/1, started no later than now.)
  const raceOk = (r: number[]) => {
    const [day, lane, stake, odds, entered, on, at, seen] = r;
    const bet = lane >= 0 && lane <= 3 && stake >= 0 && stake < BETS.length && odds >= ODDS_MIN && odds <= ODDS_MAX;
    const none = lane === -1 && stake === -1;
    return day >= 1 && day <= prisonDay(st.step) && (bet || none) && [entered, on, seen].every((x) => x === 0 || x === 1) && at >= 0 && at <= st.step;
  };
  if (!(Array.isArray(s.race) && (s.race.length === 0 || (ints(s.race, 8) && raceOk(s.race))))) s.race = [];
  // (The pet rat's racing form, P28: a rat tamed before it, at the start.)
  for (const r of s.rats) if (!r.wild) Object.assign(r, { speed: Number.isInteger(r.speed) ? Math.max(0, Math.min(100, r.speed!)) : RAT_START_SPEED, fed: Number.isInteger(r.fed) ? r.fed : 0, lap: Number.isInteger(r.lap) ? r.lap : 0 });
  // P29: a match or a sitting as they can be (else over), the designs on the player's arms.
  if (!matchOk(s.match, n, s.step)) s.match = null;
  if (!inkOk(s.ink, n)) s.ink = null;
  if (!Array.isArray(s.inkDays) || s.inkDays.length > n || !s.inkDays.every((d) => Number.isInteger(d) && d >= 0)) s.inkDays = [];
  if (!(Array.isArray(s.inked) && s.inked.length <= 3 && s.inked.every((d, k, all) => Number.isInteger(d) && d >= 0 && d < DESIGNS.length && all.indexOf(d) === k))) s.inked = [];
  // P30: an act or a quiz as they can be (else over); a save from before stage nights keeps the cards they took the places of, on the day it's loaded and the next.
  if (!showOk(s.show, s.step)) s.show = null;
  if (!quizOk(s.quiz, n, s.step)) s.quiz = null;
  for (const k of ['stageDay', 'quizDay'] as const) if (!Number.isInteger(s[k]) || s[k] < 0) s[k] = 0;
  if (!(Array.isArray(s.acted) && (s.acted.length === 0 || (ints(s.acted, 2) && s.acted[0] >= 0 && s.acted[1] >= 0 && s.acted[1] < 16)))) s.acted = [];
  // P31: a lap as it can be (else none), fresh meals' step.
  if (!(Array.isArray(s.lap) && (s.lap.length === 0 || (ints(s.lap, 4) && s.lap[0] >= 0 && s.lap[0] < 4 && s.lap[1] >= 0 && s.lap[1] < 4 && Math.abs(s.lap[2]) <= 1 && s.lap[3] >= 0 && s.lap[3] < 4)))) s.lap = [];
  if (!Number.isInteger(s.fresh) || s.fresh < 0) s.fresh = 0;
  // P34: the pay phone as it can be (else nobody on it, nobody queuing, no call), Lou's and the rest's numbers whole.
  if (!(ints(s.booth, 4) && s.booth[0] >= -1 && s.booth[0] < n && s.booth[1] >= 0 && s.booth[2] >= 0 && s.booth[3] >= 0)) s.booth = [-1, 0, 0, 0];
  if (!(Array.isArray(s.line) && s.line.length <= n + 1 && s.line.every((k, i, all) => Number.isInteger(k) && k >= -1 && k < n && all.indexOf(k) === i) && !(s.booth[0] >= 0 && s.line.includes(s.booth[0])))) s.line = [];
  if (!Number.isInteger(s.turn) || s.turn < 0 || s.turn > s.step) s.turn = 0;
  if (!callOk(s.call, s.step, s.guards.length)) s.call = null;
  if (!(ints(s.lou, 8) && s.lou.every((x, k) => k === 5 || x >= 0) && s.lou[4] <= 2)) s.lou = [0, 0, 0, 0, 0, 0, 0, 0];
  if (!(ints(s.phoned, 7) && s.phoned.every((x) => x >= 0))) s.phoned = [0, 0, 0, 0, 0, 0, 0];
  if (!(Array.isArray(s.rang) && (s.rang.length === 0 || ints(s.rang, 2)))) s.rang = [];
  // P35: the kiosk's time as it can be (else logged out), the post's numbers whole, the drawings real, a course as it can be (else none).
  if (!Number.isInteger(s.kiosk) || s.kiosk < 0 || s.kiosk > s.step + KIOSK_BLOCK) s.kiosk = 0;
  if (!(ints(s.post, 6) && s.post.every((x) => x >= 0) && s.post[1] <= PHOTOS.length && (s.post[3] === 0 || (s.post[3] <= ITEMS.length && !ITEMS[s.post[3] - 1].contraband)))) s.post = [0, 0, 0, 0, 0, 0];
  if (!(Array.isArray(s.photos) && s.photos.length <= PHOTO_WALL && s.photos.every((d) => Number.isInteger(d) && d >= 0 && d < PHOTOS.length))) s.photos = [];
  if (!(Array.isArray(s.course) && (s.course.length === 0 || (ints(s.course, 6) && s.course[0] >= 0 && s.course[0] <= s.step && s.course[1] >= 0 && s.course[1] < COURSE_QUESTIONS && s.course[2] >= 0 && s.course[2] <= s.course[1] + 1 && s.course[3] >= s.course[0] && s.course[4] >= -2 && s.course[4] <= 3 && s.course[5] >= 0)))) s.course = [];
  // (A course only while logged in.)
  if (!s.kiosk) s.course = [];
  // P36: the release as it can be (else no name listed, the way out shut).
  if (!(ints(s.release, 3) && s.release[0] >= 0 && s.release[0] <= prisonDay(s.step) + 1 && s.release[1] >= 0 && s.release[1] <= s.step + FREED_STEPS && s.release[2] >= 0 && s.release[2] <= prisonDay(s.step))) s.release = [0, 0, 0];
  // Today's blocks as they went (a save from before them: nothing said of the day so far).
  if (!(ints(s.blocks, ROUTINE.length) && s.blocks.every((b) => b >= 0 && b <= BLOCK.EXCUSED))) {
    s.blocks = ROUTINE.map(() => 0);
    // (The block under way keeps its check-in.)
    if (s.attended && ROUTINE[s.routine]?.miss) s.blocks[s.routine] = BLOCK.ATTENDED;
  }
  // v2.18 (P39): the parole board as it can be (else nothing applied for; a denial's score may be below zero; no day applied nor wait past what can be), its counters whole, a hearing as it can be (else none; nor one with no hearing set for today).
  if (!(ints(s.parole, 10) && s.parole.every((x, k) => (k === 5 ? x >= SCORE_MIN && x <= SCORE_MAX : x >= (k === 6 || k === 7 ? -1 : 0))) && s.parole[0] <= prisonDay(s.step) + HEARING_AFTER + 1 && s.parole[1] <= prisonDay(s.step) + 1 && s.parole[3] <= prisonDay(s.step) + APPLY_AGAIN + 1 && s.parole[9] <= prisonDay(s.step) + 1)) s.parole = freshParole();
  if (!(Array.isArray(s.paroleBase) && (s.paroleBase.length === 0 || ints(s.paroleBase, RECORD.length)))) s.paroleBase = [];
  if (!hearingOk(s.hearing, s.step) || (s.hearing && !(s.parole[8] > 0 && s.parole[0] === prisonDay(s.step)))) s.hearing = null;
  // P40: the job held as it can be (else none), the record whole.
  if (!(Array.isArray(s.oddjob) && (s.oddjob.length === 0 || (ints(s.oddjob, JOB_LEN) && s.oddjob[J.KIND] >= 0 && s.oddjob[J.KIND] < KINDS.length && s.oddjob[J.GIVER] >= 0 && s.oddjob[J.GIVER] < s.inmates.length && s.oddjob[J.TARGET] >= -1 && s.oddjob[J.TARGET] < Math.max(s.inmates.length, s.guards.length) && s.oddjob[J.ENDS] >= 0 && s.oddjob[J.FROM] >= 0 && s.oddjob[J.FROM] <= FROM.CHAIN && (s.oddjob[J.STAGE] === STAGE.ON || s.oddjob[J.STAGE] === STAGE.DONE) && s.oddjob[J.PAY] >= 0 && s.oddjob[J.PERK] >= PERK.NONE && s.oddjob[J.PERK] <= PERK.DEBT && s.oddjob[J.ITEM] >= 0 && s.oddjob[J.ITEM] <= ITEMS.length)))) s.oddjob = [];
  if (!(ints(s.oddjobs, 5) && s.oddjobs.every((x) => x >= 0))) s.oddjobs = [0, 0, 0, 0, 0];
  // P42: a holiday that isn't one is none; the treats and laughs as they can be (else none).
  if (!Number.isInteger(s.holiday) || s.holiday < 0 || s.holiday >= HOLIDAYS.length) s.holiday = 0;
  if (!(ints(s.hol, 2) && s.hol.every((x) => x >= 0))) s.hol = [0, 0];
  if (!(Array.isArray(s.laughed) && s.laughed.length <= n + 1 && s.laughed.every((x, k) => Number.isInteger(x) && x >= 0 && (k === 0 || x < n)))) s.laughed = [];
  // (A save from before no-shows, 2.5.1: the acts whose slots had begun when it was made stand as they did then; those still to come are judged as ever.)
  if (st.acted === undefined) {
    const m = dayMinute(s.step);
    let bits = 0;
    for (let k = 0; k < 4; k++) if (m >= (EVENT_TIMES.talent.at as number) + k * ACT_GAP) bits |= 1 << k;
    s.acted = bits ? [prisonDay(s.step), bits] : [];
  }
  if (st.stageDay === undefined && book?.beforeStage) keepOldCards(s, loadDays, loadPlan, book.beforeStage);
  // (A damaged save or a replay file's start: a heading that isn't one of the 16 faces south, a
  // place that isn't whole units on the map is where that body started; nobody sees all round
  // or kicks the ball into NaN.)
  const fix = (b: Body | undefined, home: Body) => {
    if (!b || typeof b !== 'object') return;
    if (!Number.isInteger(b.facing) || b.facing < 1 || b.facing > 16) b.facing = 5;
    if (!Number.isSafeInteger(b.x) || !Number.isSafeInteger(b.z) || b.x < 0 || b.z < 0 || b.x >= MAP_W * UNIT || b.z >= MAP_H * UNIT) {
      b.x = home.x;
      b.z = home.z;
    }
    if (typeof b.moving !== 'boolean') b.moving = false;
  };
  fix(s.player, fresh.player);
  s.inmates.forEach((m, k) => {
    fix(m.body, fresh.inmates[k]?.body ?? fresh.player);
    if (!Number.isInteger(m.face) || m.face < 1 || m.face > 16) m.face = 5;
  });
  s.guards.forEach((g, k) => {
    fix(g.body, fresh.guards[k].body);
    if (!Number.isInteger(g.face) || g.face < 1 || g.face > 16) g.face = fresh.guards[k].face;
  });
  s.dogs.forEach((d, k) => fix(d.body, fresh.dogs[k].body));
  // A seat that isn't one any more (the props changed): standing.
  const seat = world.props[s.seat];
  if (s.seat >= 0 && !(seat && fixtureUse(world, seat))) s.seat = -1;
  return s;
}

/** A match as a save holds it (P29): five different inmates, its numbers whole. */
function matchOk(o: Match | null, n: number, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  const int = (x: unknown) => Number.isInteger(x);
  return (
    int(o.who) &&
    ints(o.team, 5) &&
    o.team.every((k, i, all) => k >= 0 && k < n && all.indexOf(k) === i) &&
    o.team[2] === o.who &&
    [o.from, o.at, o.last, o.pause, o.hold, o.scored, o.restart, o.kick].every(int) &&
    o.kick >= -1 &&
    o.kick <= 1 &&
    ints(o.goals, 2) &&
    o.goals.every((g) => g >= 0) &&
    ints(o.ball, 4) &&
    ints(o.cool, 6) &&
    o.last >= -2 &&
    o.last < 5 &&
    (o.late === undefined || (int(o.late) && o.late >= 0 && o.late <= step)) &&
    (o.feet === undefined || o.feet === 0 || o.feet === 1)
  );
}

/** An act as a save holds it (P30): a song and an instrument there are, a judgement for each of its notes. */
function showOk(o: Show | null, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  // (Begun no later than now, and not yet over: never a song that keeps the player still for ever.)
  return [o.song, o.inst, o.from, o.stray].every((x) => Number.isInteger(x)) && o.song >= 0 && o.song < SONGS.length && o.from <= step && step - o.from <= countIn(o.song) + songSteps(o.song) && (o.inst === 0 || o.inst === 1) && o.stray >= 0 && Array.isArray(o.hits) && o.hits.length === CHARTS[o.song].length && o.hits.every((h) => Number.isInteger(h) && h >= 0 && h <= 3);
}

/** The player's call as a save holds it (P34): to someone the phone calls, its numbers whole, Lou's lines as they can be. */
function callOk(c: Call | null, step: number, guards: number): boolean {
  if (c === null) return true;
  if (!c || typeof c !== 'object') return false;
  return (
    [c.to, c.sub, c.arg, c.from, c.ends, c.at, c.ear].every((x) => Number.isInteger(x)) &&
    c.to >= 0 &&
    c.to <= 3 &&
    c.sub >= 0 &&
    c.sub <= 2 &&
    c.arg >= 0 &&
    c.arg < 64 &&
    c.from <= step &&
    c.at >= 0 &&
    c.at <= 3 &&
    c.ear >= -1 &&
    c.ear < guards &&
    Array.isArray(c.said) &&
    c.said.length === 3 &&
    c.said.every((x) => Number.isInteger(x) && x >= -1 && x <= 2)
  );
}

/** A quiz as a save holds it (P30): three different contestants at three of the four places, its numbers whole. */
function quizOk(o: Quiz | null, n: number, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  return (
    ints(o.who, 3) &&
    o.who.every((k, i, all) => k >= 0 && k < n && all.indexOf(k) === i) &&
    ints(o.seats, 4) &&
    [0, 1, 2, 3].every((k) => o.seats.includes(k)) &&
    [o.from, o.q, o.at, o.got, o.until].every((x) => Number.isInteger(x)) &&
    o.from <= step &&
    o.at <= step &&
    o.until <= step + REVEAL_STEPS &&
    o.q >= -1 &&
    o.q < QUIZ_QUESTIONS &&
    o.got >= -1 &&
    o.got <= 3 &&
    ints(o.pts, 4) &&
    o.pts.every((x) => x >= 0) &&
    ints(o.said, 4) &&
    o.said.every((x) => x >= -1 && x <= 3)
  );
}

/** A tattoo sitting as a save holds it (P29). */
function inkOk(o: Ink | null, n: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  return [o.who, o.design, o.k, o.nx, o.nz, o.err, o.mine, o.seen].every((x) => Number.isInteger(x)) && o.who >= 0 && o.who < n && o.design >= 0 && o.design < DESIGNS.length && o.k >= 0 && o.err >= 0 && [o.mine, o.seen].every((x) => x === 0 || x === 1) && o.nx >= 0 && o.nx <= 1000 && o.nz >= 0 && o.nz <= 1000;
}

/** A hand of Cheat as a save holds it (P27): with someone, at a stake, its chips and cards as they can be. */
function cheatOk(c: Cheat | null, n: number): boolean {
  if (c === null) return true;
  if (!c || typeof c !== 'object') return false;
  const card = (x: unknown) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 4;
  const hand = (h: unknown) => Array.isArray(h) && h.length <= HAND && h.every(card);
  return (
    [c.who, c.stake, c.round, c.table, c.turn, c.at, c.by, c.pile, c.lead, c.laid, c.spent].every((x) => Number.isInteger(x)) &&
    c.who >= 0 && c.who < n && c.stake >= 0 && c.stake < STAKES.length && c.table >= 1 && c.table <= 3 && c.turn >= 0 && c.turn <= 2 && c.by >= -1 && c.by <= 1 && (c.lead === 0 || c.lead === 1) &&
    Array.isArray(c.chips) && c.chips.length === 2 && c.chips.every((x) => Number.isInteger(x) && x >= 1 && x <= CHIPS) &&
    hand(c.mine) && hand(c.theirs) && Array.isArray(c.last) && c.last.length <= CLAIM_MAX && c.last.every(card) && typeof c.tell === 'boolean' &&
    (c.due === undefined || (Number.isInteger(c.due) && c.due >= 0))
  );
}

/** The old-timer's board as a save holds it (P27): 32 squares of pieces, whose move, the rest in range. */
function boardOk(b: Board | null): boolean {
  if (b === null) return true;
  if (!b || typeof b !== 'object' || !Array.isArray(b.sq) || b.sq.length !== 32 || !b.sq.every((x) => Number.isInteger(x) && x >= 0 && x <= 4)) return false;
  return [b.turn, b.chain, b.quiet, b.plies, b.at, b.over].every((x) => Number.isInteger(x)) && (b.turn === 0 || b.turn === 1) && b.chain >= -1 && b.chain < 32 && b.over >= 0 && b.over <= 3 && typeof b.seated === 'boolean' && Array.isArray(b.last) && b.last.every((x) => Number.isInteger(x) && x >= 0 && x < 32);
}

/**
 * Items from a snapshot, fitted to this prison's containers (a map edit may add or remove
 * some): missing ones come in empty, extra ones are dropped, sizes follow the furniture.
 */
function fitItems(w: World, items: ItemState | undefined, rng: number): ItemState | undefined {
  if (!items) return undefined;
  const list = containersOf(w);
  const old = items.containers;
  items.containers = list.map((c, i) => {
    const was = old[i] ?? [];
    return Array.from({ length: c.slots }, (_, k) => was[k] ?? 0);
  });
  // Everyone's pockets after the furniture (a save from before pockets gets fresh ones).
  const fresh = startPockets(w, { rng });
  items.containers.push(...fresh.map((p, k) => (old.length === list.length + fresh.length ? old[list.length + k] : p)));
  items.rev ??= 0;
  return items;
}
