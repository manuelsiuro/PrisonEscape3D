import { JOBS } from '../content/jobs';
import { STEPS_PER_SECOND } from '../sim/tuning';
import { checkpointOf, shiftChange } from '../sim/systems/getaway';
import { lookingAway } from '../sim/systems/ways';
import { itemDef, itemNumber } from '../content/items';
import { ROUTINE } from '../content/routine';
import type { BadgeKind } from '../render/Character';
import type { Frame } from '../render/View';
import { ROOF_Y } from '../render/Structure';
import { rollCallShows } from '../render/ground';
import { DIR_X, DIR_Z, SLOT } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { personOf } from '../sim/systems/combat';
import { FAVOR_STATE, type Station } from '../sim/systems/economy';
import { alertOf, CHASE_SPEED, GUARD, stirSteps } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { itemOf, ownerOf, usesOf, type ItemState, type Target } from '../sim/systems/items';
import { seatSpot } from '../sim/systems/rest';
import { beamAt, cameraSees, cameraSweep, sniperOn } from '../sim/systems/security';
import type { ClimbTarget } from '../sim/systems/structure';
import { MEAL_STEPS, SCENT_STEPS, STEPS_PER_MINUTE, TRUST_IGNORE, UNIT, WALK_SPEED } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { LAYER, layerOfKey, MAP_W, tileOfKey } from '../sim/world/World';
import { press, targets } from './buttons';
import type { Game } from './game';
import { coachItems, coachOnce, seenTip } from './tips';
import { dayMinute, eventOn, fogNow, today, weatherNow } from '../sim/systems/calendar';
import { searchMinute } from '../sim/systems/delivery';
import { freezing } from '../sim/systems/weather';
import { DOG, dogAsleep, dogDazed } from '../sim/systems/k9';
import { inDuct, RAT } from '../sim/systems/rats';
import { smuggleFrame } from './smuggle';
import { diceRival, gamesDoing, gamesFrameOf } from './games';
import { pastimesDoing, pastimesFrameOf, pastimesPartner, rimInTiles, shooterNow } from './pastimes';
import { longFrameOf, petOnTrack } from './long';
import { teamFrameOf } from './team';
import { nightsFrameOf } from './nights';
import { INSTRUMENT } from '../content/nights';
import { sightFor } from '../sim/systems/football';
import { GUARD_SPEED as WALK_SPEED_GUARD } from '../sim/systems/guards';
import { carWaiting, commsOf } from '../sim/systems/phone';

/**
 * The frame record the view draws: everyone where they are between the last two steps, what
 * the player is doing, what is in focus, the security as the sim has it. One record, refilled
 * every frame (phones notice garbage).
 */

const BATON = itemNumber('baton');
const POUCH = itemNumber('pouch');
const LETTER = itemNumber('letter');
const MAGAZINE = itemNumber('magazine');

const focusAt = { x0: 0, z0: 0, x1: 0, z1: 0 };
function focusOf(sim: Sim, target: Target, climb: ClimbTarget | null = null, station: Station | null = null) {
  if (station && !climb) {
    if (station.prop < 0) {
      focusAt.x0 = (station.tile % MAP_W) + 0.06;
      focusAt.z0 = Math.floor(station.tile / MAP_W) + 0.06;
      focusAt.x1 = focusAt.x0 + 0.88;
      focusAt.z1 = focusAt.z0 + 0.88;
      return focusAt;
    }
    const p = sim.world.props[station.prop];
    focusAt.x0 = p.x;
    focusAt.z0 = p.z;
    focusAt.x1 = p.x + p.w;
    focusAt.z1 = p.z + p.d;
    return focusAt;
  }
  if (climb) {
    focusAt.x0 = (climb.tile % MAP_W) + 0.08;
    focusAt.z0 = Math.floor(climb.tile / MAP_W) + 0.08;
    focusAt.x1 = focusAt.x0 + 0.84;
    focusAt.z1 = focusAt.z0 + 0.84;
    return focusAt;
  }
  if (!target) return null;
  if (target.kind === 'pockets') {
    // Lying where they fell, head back along the way they faced.
    const b = personOf(sim.state, target.who)!.body;
    const cx = b.x / UNIT - (DIR_X[b.facing] / 1024) * 0.62;
    const cz = b.z / UNIT - (DIR_Z[b.facing] / 1024) * 0.62;
    const along = Math.abs(DIR_X[b.facing]) > Math.abs(DIR_Z[b.facing]);
    focusAt.x0 = cx - (along ? 0.82 : 0.5);
    focusAt.x1 = cx + (along ? 0.82 : 0.5);
    focusAt.z0 = cz - (along ? 0.5 : 0.82);
    focusAt.z1 = cz + (along ? 0.5 : 0.82);
    return focusAt;
  }
  if (target.kind === 'person') {
    const b = personOf(sim.state, target.who)!.body;
    focusAt.x0 = b.x / UNIT - 0.45;
    focusAt.z0 = b.z / UNIT - 0.45;
    focusAt.x1 = focusAt.x0 + 0.9;
    focusAt.z1 = focusAt.z0 + 0.9;
    return focusAt;
  }
  if (target.kind === 'fixture') {
    const p = sim.world.props[target.index];
    focusAt.x0 = p.x;
    focusAt.z0 = p.z;
    focusAt.x1 = p.x + p.w;
    focusAt.z1 = p.z + p.d;
    return focusAt;
  }
  if (target.kind === 'ground') {
    const tile = tileOfKey(sim.state.items.ground[target.index][0]);
    focusAt.x0 = (tile % MAP_W) + 0.2;
    focusAt.z0 = Math.floor(tile / MAP_W) + 0.2;
    focusAt.x1 = focusAt.x0 + 0.6;
    focusAt.z1 = focusAt.z0 + 0.6;
    return focusAt;
  }
  const p = containersOf(sim.world)[target.index].prop;
  focusAt.x0 = p.x;
  focusAt.z0 = p.z;
  focusAt.x1 = p.x + p.w;
  focusAt.z1 = p.z + p.d;
  return focusAt;
}
const groundFrame: Array<{ x: number; z: number; item: number }> = [];
/** Firecrackers burning (P14): their tiles. */
const fuseFrame: number[] = [];
/** The player's trail (P19): [tile, freshness], refilled. */
const scentFrame: Array<[number, number]> = [];

const frameData: Frame = {
  x: 0,
  z: 0,
  facing: 0,
  moving: false,
  minuteOfDay: 0,
  rollCall: false,
  surface: 0,
  inmates: [],
  guide: null,
  tap: null,
  alarm: false,
  ground: groundFrame,
  groundRev: -1,
  focus: null,
  held: 0,
  outfit: 0,
  sleeping: false,
  knockedOut: false,
  guards: [],
  layer: LAYER.GROUND,
  tilesRev: -1,
  wearRev: -1,
  deskAside: false,
  wear: {},
  lock: -1,
  lockHostile: false,
  lockFar: false,
  doing: 0,
  trainAt: null,
  restBed: null,
  reps: 0,
  puddles: [],
  planters: new Map(),
  puddlesRev: 0,
  craters: [],
  security: { power: true, fence: true, arches: true, gens: [true, true], cams: [], beams: null, aim: -1, px: 0, pz: 0, hook: null },
  takeover: false,
  fuses: fuseFrame,
  weather: { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0, snow: false },
  events: { movie: false, foodFight: false, inspection: false },
  delivery: { t: -1, at: 0, search: 0, until: 0, stowed: false },
  dogs: [],
  scent: scentFrame,
  rats: [],
  smuggle: null,
  games: { bout: null, dice: null, taps: 0, sports: false, lock: null },
  pastimes: { spot: -1, ball: null, holding: null, cards: null, board: null },
  long: null,
  team: { pitch: null, theme: '', ball: null, mates: [], rivals: [] },
  nights: { stage: null, quiz: null, backed: false, stageUp: false, quizUp: false, lights: [0, 0, 0, 0] },
  phone: { offHook: false, car: false },
  inked: [],
  getaway: { shift: false, waved: false, glide: null },
};
/** Contraband in the pockets, weapon or outfit, and no pouch in the hotbar to shield it (what a detector would catch). */
function carriesUnshielded(it: ItemState): boolean {
  let found = false;
  for (let k = 0; k <= SLOT.OUTFIT; k++) {
    const n = itemOf(it.inv[k]);
    if (!n) continue;
    if (n === POUCH && k < 6) return false;
    if (itemDef(n).contraband) found = true;
  }
  return found;
}
/** Searchlight pools (tiles), refilled every frame. */
const beamFrames: Array<{ x: number; z: number }> = [];
const beamAt0 = { x: 0, z: 0 };
const hookAt = { x: 0, y: 0, z: 0 };
/** Where the player stands while training on a treadmill (on its belt), refilled. */
const trainAt = { x: 0, z: 0, facing: 0, y: 0 };
/** Where the player sits (refilled when the seat or the body changes), and an infirmary bed's pose. */
const seatAt = { x: 0, z: 0, facing: 0, y: 0 };
const seatMemo = { seat: -1, x: 0, z: 0 };
const restBed = { x: 0, z: 0, angle: 0 };
const tapAt = { x: 0, z: 0 };

/** Reps so far, counted across sets (the view pumps the arms on each). */
let repCount = 0;
let repLast = 0;
function trainReps(reps: number): number {
  if (reps > repLast) repCount++;
  repLast = reps;
  return repCount;
}

/**
 * The badge over an inmate (GDD §13.2): the letter the player carries for them, a favor done
 * (hand it in) or on offer, a merchant open for business.
 */
const badgeMemo = { step: -1, rev: -1, kinds: [] as BadgeKind[] };
export function badgeOf(sim: Sim, who: number): BadgeKind {
  const s = sim.state;
  // Worked out once a step (or when the items change), not every frame.
  if (badgeMemo.step !== s.step || badgeMemo.rev !== s.items.rev) {
    badgeMemo.step = s.step;
    badgeMemo.rev = s.items.rev;
    for (let k = 0; k < s.inmates.length; k++) badgeMemo.kinds[k] = badgeNow(sim, k);
  }
  return badgeMemo.kinds[who] ?? '';
}
function badgeNow(sim: Sim, who: number): BadgeKind {
  const s = sim.state;
  const m = s.inmates[who];
  if (m.ko > 0 || m.angry > 0) return '';
  if (sim.onDuty && s.mail.includes(who) && s.items.inv.slice(0, 6).some((v) => itemOf(v) === LETTER && usesOf(v) - 1 === who)) return 'mail';
  const f = s.favors.find((x) => x.by === who);
  if (f && (f.state === FAVOR_STATE.DONE || ((f.kind === 0 || f.kind === 1) && f.state === FAVOR_STATE.TAKEN && s.items.inv.slice(0, 6).some((v) => itemOf(v) === f.item)))) return 'done';
  if (f?.state === FAVOR_STATE.OFFERED) return 'favor';
  if (sim.shopsOpen && sim.merchantOf(who) >= 0 && s.shops[sim.merchantOf(who)].some((v) => v)) return 'shop';
  // (A follower's badge is the crew's chip now, P23: their line of work, ui/crew.ts.)
  return '';
}

/**
 * Fills the frame record: `a` is how far the clock is between the last step and the next, `tile`
 * the player's tile, `busy` whether the player can't act (asleep, out cold, in solitary, paused,
 * over), `held` the item in hand. The buttons' targets are worked out already (updateTargets).
 */
export function buildFrame(g: Game, a: number, tile: { x: number; z: number }, busy: boolean, held: number): Frame {
  const sim = g.rec.sim;
  const p = sim.state.player;
  const clock = sim.clock;
  const lerp = (from: number, to: number) => (from + (to - from) * a) / UNIT;
  const st = sim.state;
  const f = frameData;
  f.x = lerp(g.prev.x, p.x);
  f.z = lerp(g.prev.z, p.z);
  f.facing = Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]);
  f.moving = p.moving && !g.paused;
  f.minuteOfDay = clock.minuteOfDay + ((st.step % STEPS_PER_MINUTE) + a) / STEPS_PER_MINUTE;
  f.rollCall = rollCallShows(sim, clock.minuteOfDay);
  f.layer = st.layer;
  f.tilesRev = sim.tilesRev;
  f.wearRev = sim.wearRev;
  f.deskAside = st.deskAside;
  f.wear = st.wear;
  // Footsteps: earth in the tunnels, steel in the vents, the floor's own sound elsewhere.
  f.surface = st.layer === LAYER.UNDER ? TILE.DIRT : st.layer === LAYER.GROUND ? sim.world.ground.kind[tile.z * MAP_W + tile.x] : TILE.CONCRETE;
  f.inmates.length = st.inmates.length;
  st.inmates.forEach((m, k) => {
    const o = (f.inmates[k] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, cell: 0, angry: false, badge: '' });
    const q = g.prevInmates[k];
    o.x = lerp(q?.x ?? m.body.x, m.body.x);
    o.z = lerp(q?.z ?? m.body.z, m.body.z);
    o.facing = Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]);
    // (Walking only if it got anywhere this step: a stall at arm's length, a fraction of a unit short, stands still.)
    o.moving = m.body.moving && !g.paused && (!q || q.x !== m.body.x || q.z !== m.body.z);
    // (Jogging the track, P31: running as it goes.)
    o.doing = o.moving && m.then === DOING.JOG ? DOING.RUN : m.doing;
    o.cell = m.cell;
    o.angry = m.angry > 0;
    o.badge = badgeOf(sim, k);
  });
  // The side games (P22): the dice partner crouches over the dice with the player (the arm-wrestle's pose is the view's, from the bout).
  const rival = diceRival(sim);
  if (rival >= 0 && f.inmates[rival] && st.talk === rival) f.inmates[rival].doing = DOING.DICE;
  // Card sharks (P27): the one across the cards or the board crouches over them too, facing the player (and the player them).
  const across = pastimesPartner(sim);
  const partner = across && f.inmates[across.who] && st.talk === across.who ? f.inmates[across.who] : null;
  if (partner && across) {
    partner.doing = across.doing;
    partner.facing = Math.atan2(f.x - partner.x, f.z - partner.z);
    f.facing = Math.atan2(partner.x - f.x, partner.z - f.z);
  }
  // (A shootout's inmate taking his shot: arms up, facing the rim, a moment as the ball goes.)
  const shooter = shooterNow();
  const rimAt = shooter !== null ? rimInTiles(sim) : null;
  if (shooter !== null && shooter >= 0 && rimAt && f.inmates[shooter]) {
    const m = f.inmates[shooter];
    m.doing = DOING.SHOOT;
    m.facing = Math.atan2(rimAt.x - m.x, rimAt.z - m.z);
  }
  f.guards.length = st.guards.length;
  st.guards.forEach((m, k) => {
    const o = (f.guards[k] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, alert: 0, pace: 1, held: 0, hasKey: true, away: false, awayLeft: 0, stir: 0, range: 7 });
    const q = g.prevGuards[k];
    o.x = lerp(q?.x ?? m.body.x, m.body.x);
    o.z = lerp(q?.z ?? m.body.z, m.body.z);
    o.facing = Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]);
    // (Walking only if it got anywhere this step: a stall at arm's length, a fraction of a unit short, stands still.)
    o.moving = m.body.moving && !g.paused && (!q || q.x !== m.body.x || q.z !== m.body.z);
    o.doing = m.doing;
    o.alert = alertOf(m);
    o.away = lookingAway(m, st.step);
    o.awayLeft = o.away ? m.bribed - st.step : 0;
    o.stir = m.doze > 0 ? Math.min(1, m.stir / stirSteps(sim.state)) : 0;
    // How far it sees now (P17): the cone is drawn exactly that long.
    // (P29: watching a match, half that for the player off the pitch.)
    o.range = sightFor(sim, m, st.player.x, st.player.z) / UNIT;
    const chasing = m.mode === GUARD.CHASE;
    o.pace = (chasing ? CHASE_SPEED : m.speed) / WALK_SPEED;
    o.held = chasing ? BATON : 0;
    // Its key on its belt while it's in its pockets (taken from a guard out cold, it's gone).
    const pocket = st.items.containers[st.items.containers.length - st.guards.length + k];
    o.hasKey = !!pocket && (itemOf(pocket[0]) === g.guardKeys[k] || itemOf(pocket[1]) === g.guardKeys[k] || itemOf(pocket[2]) === g.guardKeys[k] || itemOf(pocket[3]) === g.guardKeys[k]);
  });
  // The dogs (P19): where they are, what they're up to; the player's trail, fresher the brighter.
  f.dogs.length = st.dogs.length;
  st.dogs.forEach((d, k) => {
    const o = (f.dogs[k] ??= { x: 0, z: 0, facing: 0, moving: false, pace: 1, pose: 'kennel', friend: false });
    const q = g.prevDogs[k];
    o.x = lerp(q?.x ?? d.body.x, d.body.x);
    o.z = lerp(q?.z ?? d.body.z, d.body.z);
    o.facing = Math.atan2(DIR_X[d.body.facing], DIR_Z[d.body.facing]);
    o.moving = d.body.moving && !g.paused;
    o.pose = dogAsleep(d, st.step) ? 'asleep' : dogDazed(d, st.step) ? 'dazed' : d.mode === DOG.POINT ? 'point' : d.mode === DOG.TRACK || d.mode === DOG.RAT ? 'track' : d.mode === DOG.KENNEL ? 'kennel' : 'heel';
    o.pace = q ? Math.hypot(d.body.x - q.x, d.body.z - q.z) / WALK_SPEED_GUARD : 1;
    o.friend = d.trust >= TRUST_IGNORE;
  });
  // The rats (P20): from where they were to where they are (not across a jump: off the shoulder, back on it).
  f.rats.length = st.rats.length;
  st.rats.forEach((r, k) => {
    const o = (f.rats[k] ??= { x: 0, z: 0, facing: 0, mode: 'hidden', carry: 0 });
    const q = g.prevRats[k];
    const glide = !!q && q.mode !== RAT.SHOULDER && r.mode !== RAT.SHOULDER && Math.abs(q.x - r.x) + Math.abs(q.z - r.z) < UNIT;
    o.x = lerp(glide ? q!.x : r.x, r.x);
    o.z = lerp(glide ? q!.z : r.z, r.z);
    o.facing = Math.atan2(DIR_X[r.facing], DIR_Z[r.facing]);
    const t = Math.floor(r.z / UNIT) * MAP_W + Math.floor(r.x / UNIT);
    o.mode = r.mode === RAT.SHOULDER ? 'shoulder' : r.mode === RAT.WAIT || inDuct(sim.world, t) ? 'hidden' : r.mode === RAT.LOOSE ? 'loose' : 'run';
    // (P28: the pet away on the track, racing or running its laps: drawn there, not on the shoulder.)
    if (!r.wild && r.mode === RAT.SHOULDER && petOnTrack(sim)) o.mode = 'hidden';
    o.carry = itemOf(r.carry);
  });
  scentFrame.length = st.scent.length;
  for (let k = 0; k < st.scent.length; k++) {
    const e = (scentFrame[k] ??= [0, 0]);
    e[0] = st.scent[k][0];
    e[1] = Math.max(0, 1 - (st.step - st.scent[k][1]) / SCENT_STEPS);
  }
  f.lock = st.lock;
  // The ring reads the fight: red while they're after the player, dim out of reach.
  f.lockHostile = st.lock >= 0 && (st.lock < st.inmates.length ? st.inmates[st.lock].angry > 0 : st.guards[st.lock - st.inmates.length].mode === GUARD.CHASE);
  // (The tool button as the last frame left it: it's worked out after the draw.)
  f.lockFar = !!press.toolNow?.attack && !press.toolNow.fits;
  f.knockedOut = st.ko > 0;
  // (Hidden in the delivery's vehicle, P18: nowhere to be led.)
  f.guide = st.stowed ? null : g.guide;
  const dest = g.pilot.destination;
  if (dest >= 0) {
    tapAt.x = (dest % MAP_W) + 0.5;
    tapAt.z = Math.floor(dest / MAP_W) + 0.5;
  }
  f.tap = dest >= 0 ? tapAt : null;
  f.alarm = st.lockdown;
  // Items: the floor (of the player's layer), the hand, the outfit, and what the action button would use.
  const it = st.items;
  let n = 0;
  for (const [key, v] of it.ground) {
    if (layerOfKey(key) !== st.layer) continue;
    const tileIndex = tileOfKey(key);
    const o = (groundFrame[n++] ??= { x: 0, z: 0, item: 0 });
    o.x = (tileIndex % MAP_W) + 0.5;
    o.z = Math.floor(tileIndex / MAP_W) + 0.5;
    o.item = itemOf(v);
  }
  groundFrame.length = n;
  // A layer change redraws the floor items too.
  f.groundRev = it.rev * 4 + st.layer;
  fuseFrame.length = 0;
  for (const [key] of st.fuses) fuseFrame.push(tileOfKey(key));
  const memo = targets;
  const climb = memo.climb;
  const target = memo.target;
  // The frame stays on an open container (what the panel shows), else on what is in reach.
  const openWho = ownerOf(sim.world, it.open);
  f.focus =
    it.open >= 0
      ? focusOf(sim, openWho >= 0 ? { kind: 'pockets', index: it.open, who: openWho } : { kind: 'container', index: it.open })
      : st.talk >= 0
        ? focusOf(sim, { kind: 'person', who: st.talk })
        : st.train >= 0 || st.seat >= 0
          ? null
          : focusOf(sim, target, climb, memo.station);
  // Training (GDD §3.2): the pose, onto the treadmill's belt, a book in hand at the shelf.
  const trainKind = st.train >= 0 ? sim.world.props[st.train].kind : '';
  f.doing = trainKind === 'weights' || trainKind === 'pullup' ? DOING.LIFT : trainKind === 'treadmill' ? DOING.RUN : trainKind === 'shelf' ? DOING.READ : DOING.NOTHING;
  f.restBed = null;
  // Seated (GDD §3.1): on the seat's tile facing the table, eating while the meal lasts; resting on an infirmary bed: lying on it.
  const seated = st.seat >= 0 ? sim.world.props[st.seat] : null;
  if (seated?.kind === 'bed') {
    restBed.x = seated.x + seated.w / 2;
    restBed.z = seated.z + seated.d / 2;
    restBed.angle = (seated.rot * Math.PI) / 2;
    f.restBed = restBed;
    f.doing = DOING.SLEEP;
    f.trainAt = null;
  } else if (seated) {
    if (seatMemo.seat !== st.seat || seatMemo.x !== p.x || seatMemo.z !== p.z) {
      const spot = seatSpot(sim.world, st.seat, p);
      Object.assign(seatMemo, { seat: st.seat, x: p.x, z: p.z });
      seatAt.x = spot.x + 0.5;
      seatAt.z = spot.z + 0.5;
      seatAt.y = seated.kind === 'chair' ? 0.1 : 0;
      seatAt.facing = Math.atan2(DIR_X[spot.facing], DIR_Z[spot.facing]);
    }
    const meal = ROUTINE[st.routine].id === 'breakfast' || ROUTINE[st.routine].id === 'dinner';
    f.doing = seated.kind === 'seat' && meal && st.eaten < MEAL_STEPS && sim.playerZone === 'canteen' ? DOING.EAT : DOING.SIT;
    f.trainAt = seatAt;
  } else if (sim.showering) f.doing = DOING.SHOWER;
  // The side games (P22): at a lock, in an arm-wrestle, over the dice.
  const game = gamesDoing(sim);
  if (game >= 0 && !seated) f.doing = game;
  // (P27: over the cards, at the board, the ball up for a shot: facing the rim.)
  // (And a moment after letting go: the follow-through.)
  const past = shooter === -1 && !seated ? DOING.SHOOT : pastimesDoing(sim);
  if (past >= 0 && !seated) f.doing = past;
  if (past === DOING.SHOOT) {
    const rim = rimInTiles(sim);
    if (rim) f.facing = Math.atan2(rim.x - f.x, rim.z - f.z);
  }
  // (P29: a kick wound up; at work on a tattoo, or being inked, facing the other.)
  if (!seated && st.match?.hold) f.doing = DOING.FOOTBALL;
  // (P30: on the stage, the instrument played; at the quiz, the buzzer, facing the way the places do.)
  if (!seated && st.show) f.doing = st.show.inst === INSTRUMENT.GUITAR ? DOING.GUITAR : DOING.DRUMS;
  if (!seated && st.quiz) {
    f.doing = DOING.QUIZ;
    const qf = sim.world.def.leisure?.quiz?.face ?? 5;
    if (!p.moving) f.facing = qf === 1 ? Math.PI / 2 : qf === 9 ? -Math.PI / 2 : qf === 13 ? Math.PI : 0;
  }
  // (P34: on the pay phone, the handset at the ear, facing the phone on its wall.)
  const comms = st.call !== null && !seated ? commsOf(sim) : null;
  if (comms) {
    f.doing = DOING.PHONE;
    const ph = comms.phone;
    if (!p.moving) f.facing = Math.atan2(ph.x + 0.5 + DIR_X[ph.face] / 2048 - f.x, ph.z + 0.5 + DIR_Z[ph.face] / 2048 - f.z);
  }
  if (!seated && st.ink) {
    f.doing = DOING.TATTOO;
    const m = st.inmates[st.ink.who];
    if (m && (m.body.x !== p.x || m.body.z !== p.z)) f.facing = Math.atan2(m.body.x - p.x, m.body.z - p.z);
  }
  if (!seated && trainKind === 'treadmill') {
    const tp = sim.world.props[st.train];
    trainAt.x = tp.x + tp.w / 2;
    trainAt.z = tp.z + tp.d / 2 + 0.1;
    trainAt.y = 0.14;
    trainAt.facing = Math.PI;
    f.trainAt = trainAt;
  } else if (!seated && trainKind === 'pullup') {
    // (P31: at the pull-up bar, just in front of it facing it, hands up on it, lifted a little off the grass:
    // a step back from it, or the see-through cut round the player would take the bar away.)
    const tp = sim.world.props[st.train];
    trainAt.x = tp.x + tp.w / 2;
    trainAt.z = tp.z + tp.d / 2 + 0.55;
    trainAt.y = 0.2;
    trainAt.facing = Math.PI;
    f.trainAt = trainAt;
  } else if (!seated || seated.kind === 'bed') f.trainAt = null;
  f.reps = trainReps(st.reps);
  f.puddles = st.puddles;
  // (P31: the gardener's planters growing what was planted in them.)
  const grow = f.planters as Map<number, number>;
  grow.clear();
  for (const k in st.machines) {
    const i = Number(k);
    if (sim.world.props[i]?.kind !== 'planter') continue;
    grow.set(i, Math.max(0, Math.min(1, 1 - (st.machines[i] - st.step) / (JOBS.gardener.cycle! * STEPS_PER_SECOND))));
  }
  f.craters = st.craters;
  f.puddlesRev = st.puddles.length * 4096 + (st.puddles[0] ?? 0);
  // (P30: on the stage, at the quiz's table, empty-handed: the instrument, the buzzer.)
  f.held = st.show || st.quiz ? 0 : trainKind === 'shelf' ? MAGAZINE : held;
  f.outfit = itemOf(it.inv[SLOT.OUTFIT]);
  coachItems(f.held, f.outfit);
  f.sleeping = st.sleeping;
  // Security (GDD §5.4–5.6) as the sim has it: cameras on their sweep, the searchlights at night, a sniper's aim.
  const sec = f.security;
  // What has power (Irongate's two generators each run their half, P12).
  sec.power = sim.powered('lights');
  sec.fence = sim.powered('fence');
  sec.arches = sim.powered('detectors');
  sec.gens[0] = st.powerOff === 0;
  sec.gens[1] = st.powerOff2 === 0;
  sec.px = f.x;
  sec.pz = f.z;
  const cams = sim.prison.cameras ?? [];
  sec.cams.length = cams.length;
  cams.forEach((c, k) => {
    const o = (sec.cams[k] ??= { facing: 0, on: false, sees: false, taped: false });
    o.taped = st.cams[k] > 0;
    o.facing = Math.PI / 2 - ((c.face - 1 + cameraSweep(k, st.step + a)) * Math.PI * 2) / 16;
    o.on = sim.powered('cameras') && !st.cams[k];
    o.sees = o.on && st.layer === LAYER.GROUND && !g.over && cameraSees(sim.world, c, k, st.step, p);
    // The first time a camera has the player in its eye: what cameras do, and how to blind one.
    if (o.sees && !busy) coachOnce('camera', 'hint.camera');
  });
  // (P31: the first time out on the sports ground, or in the garden: what's there.)
  if (st.layer === LAYER.GROUND && !busy) {
    const here = sim.playerZone;
    if (here === 'sports') coachOnce('sports', 'hint.sports');
    else if (here === 'garden') coachOnce('gardenPlace', 'hint.gardenPlace');
  }
  // Walking up to a live detector arch with contraband and no pouch (GDD §5.4): a warning, once.
  if (memo.step === st.step && sim.powered('detectors') && st.layer === LAYER.GROUND && !busy && !seenTip('detectorAhead') && carriesUnshielded(it)) {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (sim.world.ground.kind[(tile.z + dz) * MAP_W + tile.x + dx] === TILE.DETECTOR) coachOnce('detectorAhead', 'hint.detectorAhead');
  }
  const lights = sim.prison.searchlights;
  if (lights && sim.powered('searchlights') && ROUTINE[st.routine].id === 'lightsOut') {
    beamFrames.length = lights.length;
    lights.forEach((path, k) => {
      beamAt(path, st.step + a, beamAt0);
      const o = (beamFrames[k] ??= { x: 0, z: 0 });
      o.x = beamAt0.x / UNIT;
      o.z = beamAt0.z / UNIT;
    });
    sec.beams = beamFrames;
  } else sec.beams = null;
  sec.aim = st.sniperAt > 0 && !busy ? sniperOn(sim.world, p, st.layer) : -1;
  // A grapnel ready at a roof's edge: where it would land.
  const hook = memo.tool?.action === 'grapnel' ? memo.tool.tile : -1;
  if (hook >= 0) {
    hookAt.x = (hook % MAP_W) + 0.5;
    hookAt.z = Math.floor(hook / MAP_W) + 0.5;
    // Onto a roof (Shankton's gatehouse), the landing is up there.
    hookAt.y = memo.tool!.layer === LAYER.ROOF ? ROOF_Y : 0;
  }
  sec.hook = hook >= 0 ? hookAt : null;
  f.takeover = st.takeover;
  frameA = a;
  dayFrame(sim, f);
  getawayFrame(sim, f);
  // Smuggling (P21): the drone, the drops, visiting day.
  f.smuggle = smuggleFrame(sim, a);
  // The side games (P22): the bout, the dice between the two, the pick's taps, sports day.
  f.games = gamesFrameOf(sim, f.x, f.z, rival >= 0 ? f.inmates[rival] ?? null : null);
  // Card sharks (P27): the court, the ball, the cards between the two, the board.
  f.pastimes = pastimesFrameOf(sim, f.x, f.z, partner, partner);
  // Long games (P28): the garden's beds, the track and its racers, the pet's laps, tipsy.
  f.long = longFrameOf(sim, a);
  // Team & ink (P29): the pitch, the ball.
  f.team = teamFrameOf(sim, a);
  // Stage nights (P30): the stage set up, the buzzers.
  f.nights = nightsFrameOf(sim);
  // The pay phone (P34): off the hook while an inmate's call has begun or the player's is on; Lou's car on its night.
  f.phone.offHook = (st.booth[0] >= 0 && st.booth[1] > 0) || st.call !== null;
  f.phone.car = carWaiting(st);
  f.inked = st.inked;
  return f;
}

/**
 * The day in the picture (P17): rain (1) or a storm (2), fog while it lies thick, a
 * heatwave's haze by day, the wind (a heading in the view: where it blows to), and the
 * event on (the screen, the food, the inspectors).
 */
/** The step's fraction (the frame's interpolation) for the day's clocks. */
/** Bluff & glider (P24): the checkpoint's shift change and the player waved through; a glider at a roof's edge, where it would come down (the sim's own target). */
const glidePreview = { fromX: 0, fromZ: 0, toX: 0, toZ: 0, go: false, out: false };
function getawayFrame(sim: Sim, f: Frame) {
  const st = sim.state;
  const gw = f.getaway;
  gw.shift = !!checkpointOf(sim) && shiftChange(st.step);
  gw.waved = st.waved > 0;
  const tt = targets.tool;
  const g = tt?.action === 'glide' ? tt.glide : undefined;
  if (!g || !g.dist || st.layer !== LAYER.ROOF) {
    gw.glide = null;
    return;
  }
  const here = tt!.over!;
  glidePreview.fromX = (here % MAP_W) + 0.5;
  glidePreview.fromZ = Math.floor(here / MAP_W) + 0.5;
  glidePreview.toX = (tt!.tile % MAP_W) + 0.5;
  glidePreview.toZ = Math.floor(tt!.tile / MAP_W) + 0.5;
  glidePreview.go = tt!.fits;
  glidePreview.out = g.out;
  gw.glide = glidePreview;
}

let frameA = 0;
function dayFrame(sim: Sim, f: Frame) {
  const plan = today(sim);
  const w = f.weather;
  const now = weatherNow(sim);
  w.rain = now === 'storm' ? 2 : now === 'rain' ? 1 : 0;
  w.fog = fogNow(sim) ? 1 : 0;
  const m = dayMinute(sim.state.step);
  w.heat = plan.weather === 'heatwave' && m >= 60 && m < 690;
  // From a bearing (0 north, clockwise in eighths) it blows the other way: east +x, south +z.
  const b = (plan.wind * Math.PI) / 4;
  w.windAngle = Math.atan2(Math.cos(b), -Math.sin(b));
  w.windForce = plan.windForce;
  // (P26: a Big Freeze Daily snows on any prison, as Stalag Flucht always does.)
  w.snow = freezing(sim);
  const e = f.events;
  e.movie = eventOn(sim, 'movie');
  e.foodFight = eventOn(sim, 'foodFight');
  e.inspection = eventOn(sim, 'inspection');
  // Delivery day (P18): the vehicle's day, in fractional minutes (it drives in before 12:30 and out after 14:31).
  const d = f.delivery;
  const st = sim.state;
  d.t = plan.event === 'delivery' && sim.prison.delivery && !sim.prison.rules?.relaxed ? (st.step % (1440 * STEPS_PER_MINUTE)) / STEPS_PER_MINUTE + frameA / STEPS_PER_MINUTE : -1;
  d.at = plan.at;
  d.until = plan.until;
  d.search = searchMinute(plan);
  d.stowed = st.stowed;
}
