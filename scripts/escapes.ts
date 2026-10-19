/**
 * The escape bots (escapetest runs them; dailytest under the Daily's twists).
 *
 * The four Center Perks escapes (GDD §12), each won by a bot from day 1 through the real
 * simulation, every guard on duty, with ordinary commands. Each bot keeps the routine like a
 * model prisoner with its escape kit hidden in the desk's compartment (the recipe graph and
 * the economy tests prove the kit can be had), then goes:
 * - perimeter cutout: Lights Out, the dummy in bed, a guard's uniform, plastic keys to the
 *   generator room; the power off, the electric fence cut before it comes back;
 * - tunnel: Lights Out, the dummy in bed, under the desk and north beneath the wall and the
 *   fence, braced every third tile, dug up onto the road;
 * - rooftop: Lights Out, the dummy in bed, the cell's grate unscrewed (a fake cover behind),
 *   the vents to the ladder, the roof's edge, a grapnel over the fence and a sheet rope down;
 * - takeover: Strength and Speed trained to 90, plated armor and nunchucks, two followers;
 *   one blow at a guard and every guard comes; all five out cold opens the gates.
 * Stalag Flucht and Shankton follow the same four routes on their own maps (`PLANS`); San
 * Pancho has its own three: the deep tunnel, the supply road's gate on cloned keys, the takeover.
 * The snapshot pins each run: when it got out, how, the heat's peak, and the tally.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { IRONGATE } from '../src/content/prisons/irongate';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { SHANKTON } from '../src/content/prisons/shankton';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import type { PrisonDef } from '../src/content/prisons/types';
import { placesOf } from '../src/sim/ai/places';
import { command, dirFromVector, EXT, OP, SLOT, TALK, tossArgs } from '../src/sim/command';
import { ESCAPES } from '../src/sim/Sim';
import { awake, GUARD } from '../src/sim/systems/guards';
import { itemOf, slot } from '../src/sim/systems/items';
import { maxHealth } from '../src/sim/systems/combat';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { Bot, DIR, n, resumes, tileOf } from './bots';
import { check } from './assert';
import { DAY as DAY_BITS, FEATS } from '../src/sim/systems/ledger';
import { DAY_EVENTS, WEATHERS } from '../src/content/days';
import { thorough } from '../src/sim/systems/delivery';
import { Sim } from '../src/sim/Sim';
import { shiftChange } from '../src/sim/systems/getaway';
import { BLUFF_HEAT } from '../src/content/getaways';

/** The run's ledger in a line (P16): counters that moved, and each day's bits. */
export function ledgerLine(feats: readonly number[], days: readonly number[]): string {
  const moved = FEATS.map((f, k) => (feats[k] && f !== 'walked' ? `${f} ${feats[k]}` : '')).filter(Boolean);
  const bits = days.map((b) => Object.entries(DAY_BITS).filter(([, v]) => b & v).map(([k]) => k.toLowerCase()).join('+') || 'quiet');
  return `${moved.join(', ') || 'nothing'}; walked ${Math.round(feats[FEATS.indexOf('walked')] / 1024)} tiles; days ${bits.join(' / ')}`;
}

const DAY = 1440 * STEPS_PER_MINUTE;

/** Bots run quietly (dailytest: under the Daily's twists): no report, no save-and-load replays, failures counted (assert.ts soft). */
export const quiet = { on: false };

function report(name: string, bot: Bot) {
  if (quiet.on) return;
  const st = bot.st;
  console.log(`== ${name}`);
  for (const l of bot.log) console.log(`  ${l}`);
  const [walls, dug, guards, cash] = st.tally;
  // Saved and loaded at four points of the run (the last two in the escape itself), the game ends the same.
  const at = resumes(bot, [0.5, 0.9, 0.98, 0.995]);
  console.log(`  saved and loaded at ${at.join(', ')}`);
  check(at.every((a) => a.endsWith('resumes')), `${name}: a game saved and loaded plays on exactly as before`);
  console.log(`  ledger: ${ledgerLine(st.feats, st.days)}`);
  console.log(`  → ${st.escaped ? `out ${bot.time} by ${ESCAPES[st.via]}` : `still inside, ${bot.time}, in the ${bot.sim.playerZone}`}; heat peak ${bot.heatPeak}%; walls ${walls}, tunnel tiles ${dug}, guards out cold ${guards}, cash $${cash}`);
}

/** The evening: roll call attended, the kit from the desk, the dummy in bed, Lights Out and the cell locked. */
function nightfall(bot: Bot, kitSize: number) {
  const places = placesOf(bot.sim.world);
  // Roll call is attended on arrival; then home.
  check(bot.routineUntil(1, 22 * 60 + 15), 'the day kept');
  check(bot.walkTo(places.deskside[1]), 'beside the desk');
  bot.face(DIR.EAST);
  check(bot.open(bot.desk), 'the desk opens');
  bot.takeAll(kitSize);
  bot.close();
  check(bot.walkTo(places.bedside[1]), 'beside the bed');
  bot.face(DIR.WEST);
  check(bot.open(bot.bed), 'the bed opens');
  bot.putIn('bed_dummy', 0);
  bot.close();
  check(itemOf(bot.st.items.containers[bot.bed][0]) === n('bed_dummy'), 'the dummy is in bed');
  // Lights Out: the door locks once the player is in.
  check(
    bot.until(() => bot.sim.cellsLocked && (bot.sim.world.lockedCells & 2n) !== 0n, 60 * STEPS_PER_MINUTE),
    'Lights Out, locked in',
  );
  bot.until(() => false, 10 * STEPS_PER_MINUTE);
}

export type Route = 'cutout' | 'tunnel' | 'rooftop' | 'takeover' | 'gate' | 'raft' | 'helicopter' | 'stowaway' | 'bluff' | 'glider';

/** Where each route goes in a prison: tiles as [x, z], with a facing where it matters. */
export interface Plan {
  def: PrisonDef;
  /** The first bot's seed (the others take the next ones). */
  seed: number;
  name: (route: string) => string;
  /** The routes this prison has (default: cutout, tunnel, rooftop, takeover). */
  routes?: Route[];
  /** Cutout: the keys from the cell to the generator, where to stand at it, the fence tile to cut from and which way. Gate: the keys out by the gates. */
  keys: string[];
  generator?: [number, number];
  generatorFace?: number;
  fence?: [number, number, number];
  /** A chain-link fence inside the electric one (Shankton's double perimeter), cut first: where to stand and which way. */
  inner?: [number, number, number];
  /** Detector arches on the way (Shankton): a contraband pouch in the kit. */
  pouch?: boolean;
  /** Tunnel: the desk, the tile above the toilet, the tunnel's tiles in order with the way each is dug. */
  desk?: [number, number];
  toilet?: [number, number];
  dig?: Array<[number, number, number]>;
  /** Raft (Irongate): where to stand at GEN-2 and which way, the dock fence to cut from and which way, the pier's end and the sea's way; the walkway guard to let go by first (its night round's west end). */
  power2?: [number, number, number];
  dock?: [number, number, number];
  pier?: [number, number, number];
  walkwayGuard?: number;
  /** Helicopter (Irongate): the north roof's edge over the yard and the way across, the edge over the helipad court and the way down, the tile beside the pad (west of it). */
  chasm?: [number, number, number];
  court?: [number, number, number];
  pad?: [number, number];
  /** Rooftop: the cell's grate (none: the ladder is reached on foot, the power off first), the ladder, the roof's edge and which way the fence is. */
  grate?: [number, number];
  ladder?: [number, number];
  edge?: [number, number, number];
  /** Where the grapnel lands on a roof beyond the fence (Shankton's gatehouse): its far edge, and the way down the sheet rope. */
  rope?: [number, number, number];
  /** Takeover: where to wait for the first guard (out of the snipers' range), a tile outside the open gates. */
  rally?: [number, number];
  /** Takeover: the first blow by hand, the chocolate only once it has raised the alarm (a guard knocked out unseen calls nobody in: San Pancho's lawless interior). */
  alarmFirst?: boolean;
  /** Takeover and gate: a tile outside the open gates (on the road). */
  gates: [number, number];
  /** Strength and Speed trained to (default 90, GDD §12: 90+), and whether to recruit the two strongest inmates. */
  trained?: number;
  strongest?: boolean;
  /** Molten chocolate in the pockets (GDD §10.1: thrown, out cold at once), for a guard force too big to beat by hand. */
  chocolate?: number;
  /** Takeover: the hour (game minutes) to go to the rally point at, the routine kept till then (Irongate: after roll call, not in the middle of every guard). */
  startAt?: number;
  /** Takeover: the chocolate kept for the riot guards (Irongate's armored four), the rest beaten by hand; and every chaser beaten before walking out (a riot guard catches a player who runs). */
  riotCups?: boolean;
  /** Stowaway (P18): what the delivery's vehicle takes (keys and a uniform from the desk), the tile to wait at before slipping to the tail. */
  stowKit?: string[];
  /** Stowaway on a day its search would be thorough: a firecracker thrown here (from the tail) at 14:21 draws the supervisor off before the search. */
  stowLure?: [number, number];
  /** The bluff (P24): what gets the player to the checkpoint's window in uniform with papers (keys, a pouch through the arches). */
  bluffKit?: string[];
  /** The glider (P24): the roof's edge to glide off and which way, and the day's wind forced for it (where from, how strong). */
  glide?: [number, number, number];
  glideWind?: [number, number];
}

export const PLANS: Plan[] = [
  {
    def: CENTER_PERKS,
    seed: 11,
    name: (r) => r,
    routes: ['cutout', 'tunnel', 'rooftop', 'takeover', 'stowaway', 'bluff', 'glider'],
    keys: ['plastic_key_yellow', 'plastic_key_purple', 'plastic_key_green'],
    bluffKit: ['plastic_key_green', 'guard_outfit', 'fake_id'],
    glide: [57, 39, DIR.EAST],
    glideWind: [6, 1],
    generator: [8, 41],
    generatorFace: DIR.SOUTH,
    fence: [27, 60, DIR.SOUTH],
    desk: [10, 7],
    toilet: [10, 9],
    dig: [6, 5, 4, 3, 2, 1].map((z) => [10, z, DIR.NORTH]),
    grate: [9, 9],
    ladder: [13, 39],
    edge: [6, 39, DIR.WEST],
    gates: [30, 62],
  },
  // Stalag Flucht (GDD §4.2): the generator is in the guards' compound past the inner gate,
  // the whole wire is live; the tunnel bends round the boulders north of cabin A; the cabin's
  // roof is a grapnel's throw from the north wire.
  {
    def: STALAG_FLUCHT,
    seed: 21,
    name: (r) => `${STALAG_FLUCHT.id}: ${r}`,
    routes: ['cutout', 'tunnel', 'rooftop', 'takeover', 'stowaway', 'glider'],
    keys: ['plastic_key_yellow', 'plastic_key_purple'],
    glide: [58, 24, DIR.EAST],
    glideWind: [6, 1],
    generator: [54, 26],
    generatorFace: DIR.NORTH,
    fence: [60, 30, DIR.EAST],
    desk: [8, 7],
    toilet: [8, 9],
    dig: [
      [8, 6, DIR.NORTH],
      [9, 6, DIR.EAST],
      [10, 6, DIR.EAST],
      [10, 5, DIR.NORTH],
      [10, 4, DIR.NORTH],
      [10, 3, DIR.NORTH],
      [10, 2, DIR.NORTH],
      [10, 1, DIR.NORTH],
    ],
    ladder: [57, 23],
    edge: [58, 24, DIR.EAST],
    rally: [21, 32],
    trained: 100,
    strongest: true,
    gates: [20, 62],
  },
  // Shankton (GDD §4.3): no wall of the shell can be chipped. The generator room's own door
  // leads out to the gravel, a chain-link fence and the live one beyond (the pouch gets the
  // kit through the corridors' detectors); the tunnel runs under the shell and both fences;
  // the vent maze reaches the generator room's ladder, the grapnel swings across onto the
  // gatehouse roof astride both fences, a sheet rope down from there. Eight guards are too
  // many to beat by hand: four cups of molten chocolate thrown, the rest with nunchucks.
  {
    def: SHANKTON,
    seed: 31,
    name: (r) => `${SHANKTON.id}: ${r}`,
    routes: ['cutout', 'tunnel', 'rooftop', 'takeover', 'bluff', 'glider'],
    keys: ['plastic_key_yellow', 'plastic_key_purple'],
    bluffKit: ['plastic_key_red', 'guard_outfit', 'fake_id', 'pouch'],
    glide: [38, 55, DIR.SOUTH],
    glideWind: [0, 2],
    pouch: true,
    generator: [34, 49],
    generatorFace: DIR.SOUTH,
    inner: [36, 57, DIR.SOUTH],
    fence: [36, 60, DIR.SOUTH],
    desk: [12, 9],
    toilet: [12, 11],
    dig: [8, 7, 6, 5, 4, 3, 2, 1].map((z) => [12, z, DIR.NORTH]),
    grate: [10, 11],
    ladder: [38, 49],
    edge: [53, 55, DIR.SOUTH],
    rope: [53, 62, DIR.SOUTH],
    rally: [16, 25],
    chocolate: 4,
    gates: [51, 63],
  },
  // San Pancho (GDD §4.4): no fence to cut, no roof to swing from. The deep tunnel runs north
  // from the desk under the compound wall, the walkway, the inner wall, the minefield and the
  // outer wall, to come up on the road; the supply road is walked at night in a guard's
  // uniform on cloned keys (yellow out of the cell and the wing, red through the control room
  // and the inner wall, green through the outer gate); the takeover is fought in the plaza,
  // out of the towers' reach, the first blow by hand where the guard sees it (a guard
  // knocked out unseen in the lawless compound calls nobody in).
  {
    def: SAN_PANCHO,
    seed: 41,
    name: (r) => `${SAN_PANCHO.id}: ${r}`,
    routes: ['tunnel', 'gate', 'takeover', 'stowaway'],
    stowKit: ['plastic_key_red', 'guard_outfit'],
    keys: ['plastic_key_yellow', 'plastic_key_red', 'plastic_key_green'],
    desk: [15, 12],
    toilet: [15, 14],
    dig: [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((z) => [15, z, DIR.NORTH]),
    rally: [31, 40],
    alarmFirst: true,
    trained: 100,
    strongest: true,
    chocolate: 4,
    gates: [31, 62],
  },
  // HMP Irongate (GDD §4.5): no tunnel (the sea floods it), no fence onto a road. The raft: a
  // guard's uniform and cloned keys (yellow out of the cell, purple into GEN-2, red through
  // the sally port and the dock's door), a pouch through the arches; GEN-2 off, the dock's
  // dead fence cut, the raft launched off the pier's end. The helicopter: the vents to GEN-1's
  // ladder, a grapnel across the yard onto the south roofs, a sheet rope down into the court,
  // the two riot guards put down with molten chocolate, aboard in uniform. The takeover in the
  // cell block's vestibule, a chokepoint, once roll call is over (ten guards, four in riot
  // gear: chocolate for the riot guards, every one put down), out by the sally port, the ferry gate and the
  // lowered drawbridge.
  {
    def: IRONGATE,
    seed: 51,
    name: (r) => `${IRONGATE.id}: ${r}`,
    routes: ['raft', 'helicopter', 'takeover', 'stowaway', 'bluff'],
    bluffKit: ['plastic_key_red', 'guard_outfit', 'fake_id', 'pouch'],
    stowKit: ['plastic_key_red', 'guard_outfit', 'pouch', 'firecracker'],
    stowLure: [33, 50],
    keys: ['plastic_key_yellow', 'plastic_key_purple', 'plastic_key_red'],
    power2: [43, 45, DIR.SOUTH],
    dock: [59, 28, DIR.EAST],
    pier: [62, 28, DIR.EAST],
    walkwayGuard: 7,
    grate: [9, 11],
    ladder: [51, 17],
    chasm: [36, 21, DIR.SOUTH],
    court: [32, 44, DIR.EAST],
    pad: [34, 45],
    rally: [30, 18],
    trained: 100,
    strongest: true,
    chocolate: 5,
    startAt: 9 * 60 + 5,
    riotCups: true,
    pouch: true,
    gates: [30, 59],
  },
];

// ------------------------------------------------------------------ 1. the perimeter cutout
function cutout(p: Plan) {
  const bot = new Bot(p.def, p.seed);
  const pouch = p.pouch ? ['pouch'] : [];
  bot.stash(...p.keys, ...pouch, 'sturdy_cutters', 'bed_dummy', 'guard_outfit');
  nightfall(bot, p.keys.length + pouch.length + 3);
  // Into the guard's uniform.
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
  // The generator: off.
  check(bot.walkTo(tileOf(...p.generator!)), 'at the generator');
  bot.face(p.generatorFace!);
  bot.act();
  check(!bot.sim.power, 'the power is off');
  const cutAt = bot.st.step;
  // Through the chain-link first, where there is one inside the wire.
  if (p.inner) {
    const [ix, iz, iface] = p.inner;
    check(bot.walkTo(tileOf(ix, iz)), 'at the inner fence');
    bot.face(iface);
    const mesh = tileOf(ix + (iface === DIR.EAST ? 1 : 0), iz + (iface === DIR.SOUTH ? 1 : 0));
    check(bot.sim.world.ground.kind[mesh] === TILE.FENCE, 'facing the chain-link');
    check(bot.strikeUntil('sturdy_cutters', () => bot.sim.world.ground.kind[mesh] === TILE.FENCE_CUT), 'the chain-link cut');
  }
  // To the electric stretch of the fence, and through it.
  const [fx, fz, face] = p.fence!;
  check(bot.walkTo(tileOf(fx, fz)), 'at the electric fence');
  bot.face(face);
  const wire = tileOf(fx + (face === DIR.EAST ? 1 : 0), fz + (face === DIR.SOUTH ? 1 : 0));
  check(bot.sim.world.ground.kind[wire] === TILE.ELECTRIC, 'facing the electric fence');
  const cut = bot.strikeUntil('sturdy_cutters', () => bot.sim.world.ground.kind[wire] === TILE.FENCE_CUT);
  check(cut && !bot.sim.power === true, 'cut through before the power came back');
  console.log(`  cutout: the fence cut ${((bot.st.step - cutAt) / 20).toFixed(1)} s after the power went off`);
  bot.walkTo(tileOf(fx + (face === DIR.EAST ? 2 : 0), fz + (face === DIR.SOUTH ? 2 : 0)), 200);
  report(p.name('perimeter cutout'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'fence', 'escaped through the fence');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 2. the tunnel
function tunnel(p: Plan) {
  const bot = new Bot(p.def, p.seed + 1);
  bot.stash('sturdy_shovel', 'timber_brace', 'timber_brace', 'timber_brace', 'bed_dummy');
  nightfall(bot, 5);
  const places = placesOf(bot.sim.world);
  const st = bot.st;
  // The entrance under the desk, from beside it.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  const desk = tileOf(...p.desk!);
  check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.ground.kind[desk] === TILE.SHAFT), 'the entrance under the desk');
  // Its dirt down the toilet.
  bot.walkTo(tileOf(...p.toilet!));
  bot.face(DIR.SOUTH);
  bot.hold('dirt');
  bot.act();
  check(bot.slotOf('dirt') < 0, 'the dirt flushed');
  // Down through the desk's panel.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  bot.open(bot.desk);
  bot.act(1);
  check(st.layer === LAYER.UNDER, 'down the tunnel');
  // Under the wall and the fence (round the boulders): a brace on every third tile.
  p.dig!.forEach(([x, z, face], k) => {
    if (k % 3 === 2) {
      bot.hold('timber_brace');
      bot.use();
    }
    bot.face(face);
    const ok = bot.strikeUntil('sturdy_shovel', () => bot.sim.world.layers[LAYER.UNDER].kind[tileOf(x, z)] !== TILE.SOIL || bot.sim.events.some((e) => e.type === 'caveIn'));
    check(ok && bot.sim.world.layers[LAYER.UNDER].kind[tileOf(x, z)] !== TILE.SOIL, `tile ${p.def === CENTER_PERKS ? z : `${x},${z}`} dug`);
    check(bot.walkTo(tileOf(x, z), 400), `along to ${p.def === CENTER_PERKS ? z : `${x},${z}`}`);
  });
  // Facing back along it, up through the road.
  bot.face(DIR.SOUTH);
  check(bot.strikeUntil('sturdy_shovel', () => bot.done || st.layer === LAYER.GROUND), 'dug up');
  report(p.name('tunnel'), bot);
  check(bot.done && ESCAPES[st.via] === 'tunnel', 'escaped through the tunnel');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 3. the rooftop grapnel
function rooftop(p: Plan) {
  const bot = new Bot(p.def, p.seed + 2);
  if (!p.grate) return generatorRoof(p, bot);
  bot.stash('screwdriver', 'fake_vent', 'grapnel', 'sheet_rope', 'bed_dummy');
  nightfall(bot, 5);
  const st = bot.st;
  // The cell's grate, from the floor under it.
  const grate = tileOf(...p.grate);
  check(bot.walkTo(grate), 'under the grate');
  check(bot.strikeUntil('screwdriver', () => bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_OPEN), 'the grate unscrewed');
  bot.act();
  check(st.layer === LAYER.VENTS, 'up into the vents');
  // The fake cover over the hole behind.
  bot.hold('fake_vent');
  bot.use();
  check(bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_FAKE, 'a fake cover over the grate');
  // Crawl to the ladder and up.
  const [lx, lz] = p.ladder!;
  check(bot.walkTo(tileOf(lx, lz - 1), 3000), 'along the ducts to the ladder');
  check(bot.walkTo(tileOf(lx, lz), 200), 'at the ladder');
  bot.act();
  check(st.layer === LAYER.ROOF, 'up on the roof');
  overTheWire(p, bot);
}

/** From the roof: to its edge, the fence a few tiles beyond, and over on the grapnel. */
function overTheWire(p: Plan, bot: Bot) {
  const edge = p.edge!;
  check(bot.walkTo(tileOf(edge[0], edge[1]), 600), 'at the roof’s edge');
  bot.face(edge[2]);
  bot.hold('grapnel');
  bot.use();
  // Swung across onto a roof beyond the fence: to its far edge, and down the sheet rope.
  if (p.rope) {
    check(bot.st.layer === LAYER.ROOF, 'across onto the gatehouse roof');
    check(bot.walkTo(tileOf(p.rope[0], p.rope[1]), 400), 'at the gatehouse roof’s far edge');
    bot.face(p.rope[2]);
    bot.hold('sheet_rope');
    bot.use();
  }
  report(p.name('rooftop grapnel'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'roof', 'escaped over the fence on the grapnel');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

/**
 * The roof where the whole wire is live (Stalag Flucht): Lights Out, the dummy in bed, a
 * guard's uniform and keys to the generator hut; the power off, up its ladder, and over the
 * dead wire on the grapnel before it comes back.
 */
function generatorRoof(p: Plan, bot: Bot) {
  bot.stash(...p.keys, 'grapnel', 'sheet_rope', 'bed_dummy', 'guard_outfit');
  nightfall(bot, p.keys.length + 4);
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(bot.walkTo(tileOf(...p.generator!)), 'at the generator');
  bot.face(p.generatorFace!);
  bot.act();
  check(!bot.sim.power, 'the power is off');
  const [lx, lz] = p.ladder!;
  check(bot.walkTo(tileOf(lx, lz + 1), 400), 'at the ladder');
  bot.face(DIR.NORTH);
  bot.act();
  check(bot.st.layer === LAYER.ROOF, 'up on the roof');
  overTheWire(p, bot);
  check(!bot.sim.power, 'over before the power came back');
}

// ------------------------------------------------------------------ 4. the takeover
function takeover(p: Plan) {
  const bot = new Bot(p.def, p.seed + 3);
  const st = bot.st;
  const places = placesOf(bot.sim.world);
  // Trained up (GDD §12: Strength and Speed 90+), armed and armored, two friends at 80+ opinion.
  st.str = p.trained ?? 90;
  st.spd = p.trained ?? 90;
  st.health = maxHealth(st.str);
  const cups = Array<string>(p.chocolate ?? 0).fill('molten_chocolate');
  // Irongate's takeover also carries a pouch through the arches (and takes its kit in two goes: too much for the pockets at once).
  const pouch = p.riotCups && p.pouch ? ['pouch'] : [];
  bot.stash('nunchucks', 'plated_outfit', ...cups, ...pouch);
  // Two friends: the first two inmates, or the two strongest (GDD §12: allies that can fight).
  const friends = p.strongest ? st.inmates.map((m, i) => ({ i, str: m.str })).sort((a, b) => b.str - a.str || a.i - b.i).slice(0, 2).map((f) => f.i) : [0, 1];
  for (const id of friends) st.inmates[id].opinion = 90;
  // Roll call first (attended on arrival), then the friends, recruited where they stand.
  check(bot.routineUntil(1, 8 * 60 + 20), 'roll call kept');
  for (const id of friends) {
    const m = st.inmates[id];
    for (let k = 0; k < 40 && st.talk !== id; k++) {
      bot.pilot.goTo(Math.floor(m.body.z / UNIT) * MAP_W + Math.floor(m.body.x / UNIT));
      bot.until(() => Math.abs(m.body.x - st.player.x) + Math.abs(m.body.z - st.player.z) < UNIT, 60, () => command(bot.pilot.dir(st.player)));
      bot.pilot.stop();
      bot.step(command(0));
      bot.act();
    }
    bot.op(OP.TALK, TALK.RECRUIT);
    bot.op(OP.CLOSE);
  }
  check(st.followers.length === 2, `two followers (${st.followers.length})`);
  // Armed up at the desk.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  bot.open(bot.desk);
  if (p.riotCups) {
    bot.takeAll(2);
    bot.op(OP.EQUIP, bot.slotOf('nunchucks'));
    bot.op(OP.EQUIP, bot.slotOf('plated_outfit'));
    // The orange outfit back in the drawer, the rest of the kit out.
    bot.putIn('inmate_outfit', 12);
    bot.takeAll(2 + cups.length + pouch.length);
    bot.close();
  } else {
    bot.takeAll(2 + cups.length);
    bot.close();
    bot.op(OP.EQUIP, bot.slotOf('nunchucks'));
    bot.op(OP.EQUIP, bot.slotOf('plated_outfit'));
  }
  check(itemOf(st.items.inv[SLOT.WEAPON]) === n('nunchucks') && itemOf(st.items.inv[SLOT.OUTFIT]) === n('plated_outfit'), 'armed and armored');
  // Nothing in hand on the way (a cup of molten chocolate is contraband in plain sight): an empty slot, or the pouch.
  if (cups.length) bot.op(OP.SELECT, pouch.length ? bot.slotOf('pouch') : st.items.inv.slice(0, 6).indexOf(0));
  // The routine kept until the fight's hour, where the plan says.
  if (p.startAt) check(bot.routineUntil(1, p.startAt), 'the routine kept till the fight');
  // Somewhere out of the towers' reach, near the gates, for the first guard to come by.
  if (p.rally) {
    check(bot.walkTo(tileOf(...p.rally), 2000), 'at the rally point');
    check(bot.until(() => st.guards.some((g) => awake(g) && Math.max(Math.abs(g.body.x - st.player.x), Math.abs(g.body.z - st.player.z)) < 3 * UNIT), 60 * STEPS_PER_MINUTE), 'a guard comes by');
  }
  // The fight: the nearest guard standing, each in turn (the first blow is seen: every guard comes).
  const inmates = st.inmates.length;
  const nearestGuard = () => {
    let best = -1;
    let bestD = Infinity;
    st.guards.forEach((g, k) => {
      if (!awake(g)) return;
      const d = Math.max(Math.abs(g.body.x - st.player.x), Math.abs(g.body.z - st.player.z));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return { k: best, d: bestD };
  };
  let fights = 0;
  // On until the gates open with no guard still on its feet close by (one at the player's heels would catch them on the way out); with riot guards about, none still chasing at all.
  const clear = () => st.takeover && (p.riotCups ? st.guards.every((g) => !awake(g)) : nearestGuard().d > 6 * UNIT);
  for (let k = 0; k < 8000 && !clear() && st.ko === 0; k++) {
    const { k: g, d } = nearestGuard();
    if (g < 0) {
      bot.step(0);
      continue;
    }
    const gb = st.guards[g].body;
    if (d > 3 * UNIT) {
      // Far: walk there (re-planned now and then).
      if (k % 20 === 0) bot.pilot.goTo(Math.floor(gb.z / UNIT) * MAP_W + Math.floor(gb.x / UNIT));
      bot.step(command(bot.pilot.dir(st.player)));
      continue;
    }
    bot.pilot.stop();
    if (st.lock !== inmates + g) bot.op(OP.LOCK, 2 + inmates + g);
    // A cup of molten chocolate left (once the alarm is up, where it has to be raised first): thrown from where the player stands.
    if (cups.length && (!p.alarmFirst || st.lockdown) && (!p.riotCups || p.def.guards[g].riot) && bot.slotOf('molten_chocolate') >= 0 && d < 2.8 * UNIT && st.lock === inmates + g) {
      bot.hold('molten_chocolate');
      bot.op(OP.USE, 1);
      continue;
    }
    // In reach: swing; else close in.
    if (d < 1.2 * UNIT) bot.op(OP.USE, fights++ === 0 ? 1 : 0);
    else bot.step(command(dirFromVector(gb.x - st.player.x, gb.z - st.player.z)));
  }
  check(st.takeover, 'every guard out cold at once: the takeover');
  console.log(`  takeover: health ${st.health}/${maxHealth(st.str)}, guards down ${st.guards.filter((g) => g.ko > 0).length}/${st.guards.length}, ${st.guards.map((g) => g.mode === GUARD.CHASE ? 'C' : g.ko > 0 ? 'x' : '.').join('')}`);
  // Out through the open gates.
  check(bot.walkTo(tileOf(...p.gates), 800), 'out through the gates');
  report(p.name('takeover'), bot);
  check(bot.done && ESCAPES[st.via] === 'takeover', 'escaped in the takeover');
}

// ------------------------------------------------------------------ 5. the gate (San Pancho's supply road)
/**
 * Lights Out, the dummy in bed, a guard's uniform; the cloned keys open every door from the
 * cell to the road: out of the wing, across the plaza, through the control room, over the
 * walkway, down the paved corridor between the mines and out of the outer gate.
 */
function gate(p: Plan, seed: number) {
  const bot = new Bot(p.def, seed);
  bot.stash(...p.keys, 'bed_dummy', 'guard_outfit');
  nightfall(bot, p.keys.length + 2);
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
  check(bot.walkTo(tileOf(...p.gates), 6000), 'down the supply road and out of the gate');
  report(p.name('supply road gate'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'gate', 'escaped through the gate');
  check(!bot.st.craters.length, 'never set foot on a mine');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 6. the raft (Irongate)
/**
 * An escape kit too big for the pockets in one go: the uniform and the dummy first (worn and
 * put to bed), then the rest. The evening roll call kept, Lights Out, locked in.
 */
function nightfallBig(bot: Bot, kit: string[]) {
  const places = placesOf(bot.sim.world);
  bot.stash('guard_outfit', 'bed_dummy', ...kit);
  check(bot.routineUntil(1, 22 * 60 + 15), 'the day kept');
  check(bot.walkTo(places.deskside[1]), 'beside the desk');
  bot.face(DIR.EAST);
  check(bot.open(bot.desk), 'the desk opens');
  bot.takeAll(2);
  bot.close();
  check(bot.walkTo(places.bedside[1]), 'beside the bed');
  bot.face(DIR.WEST);
  check(bot.open(bot.bed), 'the bed opens');
  bot.putIn('bed_dummy', 0);
  bot.close();
  // Into the uniform at the desk, the orange outfit left in the compartment, the rest of the kit out.
  check(bot.walkTo(places.deskside[1]), 'back at the desk');
  bot.face(DIR.EAST);
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
  bot.open(bot.desk);
  // Whatever the day left in the pockets (the woodshop's timber, the orange outfit) goes in the drawers.
  for (let k = 0, at = 10; k < 6; k++) if (bot.st.items.inv[k]) bot.op(OP.MOVE, k, SLOT.CONTAINER + at++);
  bot.takeAll(2 + kit.length);
  bot.close();
  check(kit.every((id) => bot.slotOf(id) >= 0), `the kit in the pockets (${kit.filter((id) => bot.slotOf(id) < 0).join(', ') || 'all'})`);
  check(
    bot.until(() => bot.sim.cellsLocked && (bot.sim.world.lockedCells & 2n) !== 0n, 60 * STEPS_PER_MINUTE),
    'Lights Out, locked in',
  );
  bot.until(() => false, 15 * STEPS_PER_MINUTE);
}

/**
 * Lights Out, the dummy in bed, a guard's uniform, cloned keys and a pouch: GEN-2 off (once
 * the south walkway's guard has gone by), out by the sally port, round the walkway to the
 * dock's door, the dead fence cut, the raft launched off the pier's end.
 */
function raft(p: Plan, seed: number) {
  const bot = new Bot(p.def, seed);
  nightfallBig(bot, [...p.keys, 'pouch', 'sturdy_cutters', 'raft']);
  bot.hold(p.keys[0]);
  const [gx, gz, gface] = p.power2!;
  check(bot.walkTo(tileOf(gx, gz), 3000), 'at GEN-2');
  bot.face(gface);
  // The south walkway's guard at the far end of its round, walking away from the way out.
  const g = bot.st.guards[p.walkwayGuard!];
  check(bot.until(() => g.body.x < 24 * UNIT, 20 * STEPS_PER_MINUTE), 'the walkway guard at its west end');
  bot.act();
  check(bot.st.powerOff2 > 0 && bot.st.powerOff === 0, 'GEN-2 off (GEN-1 still running)');
  const offAt = bot.st.step;
  const [fx, fz, face] = p.dock!;
  check(bot.walkTo(tileOf(fx, fz), 3000), 'at the dock fence');
  bot.face(face);
  const wire = tileOf(fx + 1, fz);
  check(bot.sim.world.ground.kind[wire] === TILE.ELECTRIC, 'facing the electric fence');
  check(bot.strikeUntil('sturdy_cutters', () => bot.sim.world.ground.kind[wire] === TILE.FENCE_CUT) && bot.st.powerOff2 > 0, 'cut through before GEN-2 came back');
  console.log(`  raft: the dock fence cut ${((bot.st.step - offAt) / 20).toFixed(1)} s after GEN-2 went off`);
  const [px, pz, pface] = p.pier!;
  check(bot.walkTo(tileOf(px, pz), 200), 'at the pier’s end');
  bot.face(pface);
  bot.hold('raft');
  bot.use();
  report(p.name('raft'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'raft', 'away on the raft');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 7. the helicopter (Irongate)
/**
 * Lights Out, the dummy in bed, a guard's uniform: the cell's grate, the vents to GEN-1's
 * ladder, the north roof; a grapnel across the yard onto the south roofs, a sheet rope down
 * into the helipad court; both riot guards put down (molten chocolate), aboard.
 */
function helicopter(p: Plan, seed: number) {
  const bot = new Bot(p.def, seed);
  nightfallBig(bot, ['screwdriver', 'fake_vent', 'grapnel', 'sheet_rope', 'molten_chocolate', 'molten_chocolate']);
  const st = bot.st;
  const grate = tileOf(...p.grate!);
  check(bot.walkTo(grate), 'under the grate');
  check(bot.strikeUntil('screwdriver', () => bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_OPEN), 'the grate unscrewed');
  bot.act();
  check(st.layer === LAYER.VENTS, 'up into the vents');
  bot.hold('fake_vent');
  bot.use();
  check(bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_FAKE, 'a fake cover over the grate');
  const [lx, lz] = p.ladder!;
  check(bot.walkTo(tileOf(lx, lz - 1), 3000), 'along the ducts to the ladder');
  check(bot.walkTo(tileOf(lx, lz), 200), 'at the ladder');
  bot.act();
  check(st.layer === LAYER.ROOF, 'up on the north roof');
  const [cx, cz, cface] = p.chasm!;
  check(bot.walkTo(tileOf(cx, cz), 800), 'at the roof’s edge over the yard');
  bot.face(cface);
  bot.hold('grapnel');
  bot.use();
  check(st.layer === LAYER.ROOF && bot.slotOf('sheet_rope') >= 0, 'across the yard onto the south roofs, the rope kept');
  const [kx, kz, kface] = p.court!;
  check(bot.walkTo(tileOf(kx, kz), 800), 'at the edge over the helipad court');
  bot.face(kface);
  bot.hold('sheet_rope');
  bot.use();
  check(st.layer === LAYER.GROUND && bot.sim.playerZone === 'helipad', 'down the rope into the court');
  // The two riot guards: a cup of molten chocolate each, thrown from where the player stands.
  const inmates = st.inmates.length;
  const helipad = p.def.guards.map((d, k) => (d.helipad ? k : -1)).filter((k) => k >= 0);
  for (const k of helipad) {
    const g = st.guards[k];
    for (let t = 0; t < 600 && g.ko === 0; t++) {
      const d = Math.max(Math.abs(g.body.x - st.player.x), Math.abs(g.body.z - st.player.z));
      if (d > 2.5 * UNIT) {
        if (t % 10 === 0) bot.pilot.goTo(Math.floor(g.body.z / UNIT) * MAP_W + Math.floor(g.body.x / UNIT));
        bot.step(command(bot.pilot.dir(st.player)));
        continue;
      }
      bot.pilot.stop();
      if (st.lock !== inmates + k) bot.op(OP.LOCK, 2 + inmates + k);
      bot.hold('molten_chocolate');
      bot.op(OP.USE, 1);
    }
    check(g.ko > 0, `helipad guard ${k} out cold`);
  }
  const [ax, az] = p.pad!;
  check(bot.walkTo(tileOf(ax, az), 400), 'beside the pad');
  bot.face(DIR.EAST);
  bot.act();
  report(p.name('helicopter'), bot);
  check(bot.done && ESCAPES[st.via] === 'helicopter', 'away in the helicopter');
}

// ------------------------------------------------------------------ 8. the stowaway (P18)
/**
 * Delivery day forced on day 1: the morning kept, then (with the kit from the desk: keys and a
 * uniform where the vehicle stands behind staff doors, a pouch through the arches) to the
 * vehicle's tail; in as soon as no guard is looking, and away with it at 14:31 on a day its
 * search is a quick look. Irongate's helicopter, on a day its search is thorough: out again at
 * 14:21, a firecracker thrown across the court, back in; the supervisor still looking where it
 * went off at 14:30, nobody searches.
 */
function stowaway(p: Plan, from: number) {
  const d = p.def.delivery!;
  const lure = p.stowLure;
  // The first seed from `from` whose day-1 search is a quick look (thorough, with a lure).
  let seed = from;
  while (thorough(new Sim(p.def, seed, Bot.mods), 1) !== !!lure) seed++;
  const bot = new Bot(p.def, seed);
  bot.st.calendar = [[1, DAY_EVENTS.indexOf('delivery'), WEATHERS.indexOf('clear')]];
  const kit = p.stowKit ?? [];
  if (kit.length) bot.stash(...kit);
  check(bot.routineUntil(1, 12 * 60 + 35), 'the morning kept, the vehicle in');
  if (kit.length) {
    const places = placesOf(bot.sim.world);
    check(bot.walkTo(places.deskside[1]), 'beside the desk');
    bot.face(DIR.EAST);
    check(bot.open(bot.desk), 'the desk opens');
    bot.takeAll(kit.length);
    bot.close();
    if (kit.includes('guard_outfit')) {
      bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
      check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
    }
  }
  check(bot.walkTo(tileOf(d.tail.x, d.tail.z), 4000), `at the ${d.vehicle}'s tail`);
  check(bot.until(() => !bot.st.seen && !bot.st.guards.some((g) => g.mode === GUARD.CHASE), 60 * STEPS_PER_MINUTE), 'nobody looking');
  bot.act();
  check(bot.st.stowed, `hidden in the ${d.vehicle}`);
  if (lure) {
    check(bot.routineUntil(1, 14 * 60 + 21) || bot.st.stowed, '14:21');
    bot.act();
    check(!bot.st.stowed && bot.hold('firecracker'), 'out again, the firecracker in hand');
    const [tb, tc] = tossArgs(tileOf(...lure));
    bot.step(command(0, OP.EXT, EXT.THROW, tb, tc));
    check(bot.st.fuses.length === 1, 'thrown across the court, lit');
    check(bot.until(() => !bot.st.seen, 60 * STEPS_PER_MINUTE), 'nobody looking');
    bot.act();
    check(bot.st.stowed, 'back in');
  }
  check(bot.until(() => bot.done, 3 * 60 * STEPS_PER_MINUTE), 'away with it');
  report(p.name('stowaway'), bot);
  console.log(`  seed ${seed}: the search ${lure ? `thorough, the supervisor drawn off (${bot.st.feats[FEATS.indexOf('slipped')]} slipped through)` : 'a quick look'}`);
  check(bot.done && ESCAPES[bot.st.via] === 'stowaway', 'away as a stowaway');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 9. the bluff (P24)
/**
 * The day kept, then (in a guard's uniform from the desk, with keys to the checkpoint and a fake
 * ID, a pouch where arches stand on the way) to the checkpoint's window in evening free time; the
 * papers shown as the gate changes shifts at 19:50, and out through the gates opened for the player.
 */
function bluff(p: Plan, seed: number) {
  const c = p.def.checkpoint!;
  const bot = new Bot(p.def, seed);
  const kit = p.bluffKit!;
  bot.stash(...kit);
  check(bot.routineUntil(1, 19 * 60 + 5), 'the day kept');
  const places = placesOf(bot.sim.world);
  check(bot.walkTo(places.deskside[1]), 'beside the desk');
  bot.face(DIR.EAST);
  check(bot.open(bot.desk), 'the desk opens');
  bot.takeAll(kit.length);
  bot.close();
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
  check(bot.walkTo(tileOf(c.window[0].x, c.window[0].z), 6000), 'at the checkpoint’s window');
  bot.face(DIR.SOUTH);
  check(bot.until(() => shiftChange(bot.st.step), 60 * STEPS_PER_MINUTE), 'the gate changing shifts');
  bot.act();
  check(bot.st.waved > 0, 'waved through');
  check(bot.walkTo(tileOf(...p.gates), 800) || bot.done, 'out through the gates');
  report(p.name('bluff'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'bluff', 'waved out through the checkpoint');
  check(bot.heatPeak < BLUFF_HEAT, 'never too hot for the papers');
}

// ------------------------------------------------------------------ 10. the glider (P24)
/**
 * Lights Out, the dummy in bed, up on the roof (the cell's grate and the vents to the ladder, or
 * keys to the ladder's room in a guard's uniform), to the edge and off it, on a night the wind
 * blows the right way (forced for the bot: the forecast tells it).
 */
function glider(p: Plan, seed: number) {
  const bot = new Bot(p.def, seed);
  const [wind, force] = p.glideWind!;
  bot.st.calendar = [[1, -1, -1, wind, force]];
  const st = bot.st;
  if (p.grate) {
    bot.stash('screwdriver', 'fake_vent', 'glider', 'bed_dummy');
    nightfall(bot, 4);
    const grate = tileOf(...p.grate);
    check(bot.walkTo(grate), 'under the grate');
    check(bot.strikeUntil('screwdriver', () => bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_OPEN), 'the grate unscrewed');
    bot.act();
    check(st.layer === LAYER.VENTS, 'up into the vents');
    bot.hold('fake_vent');
    bot.use();
    const [lx, lz] = p.ladder!;
    check(bot.walkTo(tileOf(lx, lz - 1), 3000), 'along the ducts to the ladder');
    check(bot.walkTo(tileOf(lx, lz), 200), 'at the ladder');
    bot.act();
  } else {
    bot.stash(...p.keys, 'glider', 'bed_dummy', 'guard_outfit');
    nightfall(bot, p.keys.length + 3);
    bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
    const [lx, lz] = p.ladder!;
    check(bot.walkTo(tileOf(lx, lz + 1), 3000), 'at the ladder');
    bot.face(DIR.NORTH);
    bot.act();
  }
  check(st.layer === LAYER.ROOF, 'up on the roof');
  const [ex, ez, face] = p.glide!;
  check(bot.walkTo(tileOf(ex, ez), 1200), 'at the roof’s edge');
  bot.face(face);
  bot.hold('glider');
  bot.use();
  report(p.name('glider'), bot);
  const flight = bot.sim.events.find((e) => e.type === 'glide');
  console.log(`  the wind from the ${['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][wind]}, strength ${force}: ${flight && flight.type === 'glide' ? `${flight.dist} tiles` : 'no glide'}`);
  check(bot.done && ESCAPES[st.via] === 'glider', 'away on the glider');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

/** Runs one route's bot in a prison (its seed as escapetest gives it); the bot, done or not. */
export function runRoute(p: Plan, route: Route): Bot | null {
  Bot.last = null;
  if (route === 'cutout') cutout(p);
  else if (route === 'tunnel') tunnel(p);
  else if (route === 'rooftop') rooftop(p);
  else if (route === 'gate') gate(p, p.seed + 4);
  else if (route === 'raft') raft(p, p.seed + 5);
  else if (route === 'helicopter') helicopter(p, p.seed + 6);
  else if (route === 'takeover') takeover(p);
  else if (route === 'stowaway') stowaway(p, p.seed + 7);
  else if (route === 'bluff') bluff(p, p.seed + 8);
  else if (route === 'glider') glider(p, p.seed + 9);
  return Bot.last;
}

/** Every prison's routes in order (ONLY=<prison id> runs one prison's, while working on them). */
export function runAll() {
  for (const p of PLANS) {
    if (process.env.ONLY && p.def.id !== process.env.ONLY) continue;
    if (p.def !== CENTER_PERKS) console.log(`== ${p.def.id}`);
    for (const r of p.routes ?? ['cutout', 'tunnel', 'rooftop', 'takeover']) runRoute(p, r);
  }
}

void DAY;
void slot;
