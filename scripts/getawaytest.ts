/**
 * Bluff & glider (P24), rule by rule:
 * - the data: a checkpoint's window is floor just inside its first gate, its gates are perimeter
 *   gates, its booth stands where nobody walks; out through its gates (and Irongate's drawbridge)
 *   is the road; every prison lists `bluff` exactly where it has a checkpoint and `glider` exactly
 *   where a glide off the roof the ladder reaches can land out; the recipes and the phone's card;
 * - the bluff: only at the window with papers in the hotbar; refused outside 19:50–20:10, out of
 *   uniform, at 40% heat, wanted or in a lockdown (nothing lost); waved through, the gates open for
 *   the player alone (inmates still can't pass, the drawbridge stays water to them) for 60 s, never
 *   shut on the player standing in one, shut at once when wanted; out through them is `bluff`;
 *   a save made waved through plays on the same;
 * - the glider: how far the wind carries it (every heading, strength and weather); only at a roof's
 *   edge with two tiles of run-up, never in a storm; brought down before a roof or a tower, short
 *   of a fence; what the button promises (where, how far, out or not) is where the sim lands, at
 *   every edge, in every wind; out on the road is `glider`, alone (no crew); forced wind days;
 * - the achievements and the ledger.
 */
import { BLUFF_HEAT, GLIDE_BASE, GLIDE_MAX, RUN_UP, SHIFT_FROM, SHIFT_TO, WAVED_STEPS } from '../src/content/getaways';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { IRONGATE } from '../src/content/prisons/irongate';
import { SHANKTON } from '../src/content/prisons/shankton';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { TRAINING } from '../src/content/prisons/training';
import type { PrisonDef } from '../src/content/prisons/types';
import { RECIPES } from '../src/content/recipes';
import { CATALOGUE } from '../src/content/smuggling';
import { ACHIEVEMENTS } from '../src/content/achievements';
import { routineAt } from '../src/content/routine';
import { command, OP, SLOT } from '../src/sim/command';
import { ESCAPES, Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { dayPlan, today } from '../src/sim/systems/calendar';
import { crewEscape } from '../src/sim/systems/crew';
import { atWindow, bluffRefusal, checkpointOf, launchSpots, shiftChange } from '../src/sim/systems/getaway';
import { slot } from '../src/sim/systems/items';
import { FEAT } from '../src/sim/systems/ledger';
import { glideFrom, glideReach, toolTarget, type Air } from '../src/sim/systems/structure';
import { CHASE_HEAT, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W, placeKey, World } from '../src/sim/world/World';
import { n } from './bots';
import { check } from './assert';

const at = (x: number, z: number) => z * MAP_W + x;
/** The step a minute of prison day 1 falls on (08:00 is step 0). */
const minute = (m: number) => ((m - 8 * 60 + 1440) % 1440) * STEPS_PER_MINUTE;
const FACINGS = [1, 5, 9, 13] as const;
/** Everyone about on the ground floor (what the sim and the button both land around). */
const bodiesOf = (sim: Sim) => [...sim.state.inmates.map((m) => m.body), ...sim.state.guards.map((g) => g.body)];
const DIR8: Record<number, number> = { 1: 2, 5: 4, 9: 6, 13: 0 };

// ------------------------------------------------------------------ data
for (const def of [...PRISONS, TRAINING]) {
  const w = new World(def);
  const c = def.checkpoint;
  const routes = def.escapes ?? ['fence', 'tunnel', 'roof', 'takeover'];
  check(routes.includes('bluff') === !!c, `${def.id}: the bluff listed exactly where there's a checkpoint`);
  // The glider: listed exactly where a glide off the ladder's roof lands out in some wind.
  let out = false;
  const b = { x: 0, z: 0, facing: 1, moving: false };
  for (const [t, facing] of launchSpots(w))
    for (let wind = 0; wind < 8 && !out; wind++)
      for (const force of [0, 1, 2]) {
        Object.assign(b, { x: (t % MAP_W) * UNIT + UNIT / 2, z: Math.floor(t / MAP_W) * UNIT + UNIT / 2, facing });
        const g = glideFrom(w, b, { wind, force, weather: 'clear' });
        if (g && !g.why && g.out) out = true;
      }
  check(routes.includes('glider') === out, `${def.id}: the glider listed exactly where it can land out (${out})`);
  // 2.5.1: every landing, in every wind and weather, out on the road or on ground walked to from the
  // player's cell (never between two fences: neither in nor out); 2.5.0's could be (Shankton's).
  let landings = 0;
  let penned = 0;
  let pennedOld = 0;
  for (const [t, facing] of launchSpots(w))
    for (let wind = 0; wind < 8; wind++)
      for (const force of [0, 1, 2, 3])
        for (const weather of ['clear', 'rain'] as const)
          for (const old of [false, true]) {
            Object.assign(b, { x: (t % MAP_W) * UNIT + UNIT / 2, z: Math.floor(t / MAP_W) * UNIT + UNIT / 2, facing });
            const g = glideFrom(w, b, { wind, force, weather, old });
            if (!g?.dist) continue;
            const [sx, sz] = facing === 1 ? [1, 0] : facing === 5 ? [0, 1] : facing === 9 ? [-1, 0] : [0, -1];
            const land = t + (sz * MAP_W + sx) * g.dist;
            const bad = !g.out && !w.afoot(land);
            if (old) pennedOld += bad ? 1 : 0;
            else {
              landings++;
              penned += bad ? 1 : 0;
            }
          }
  check(penned === 0, `${def.id}: every glide comes down out or on ground that walks home (${landings} landings, ${penned} between; 2.5.0: ${pennedOld})`);
  if (def.id === 'shankton') check(pennedOld > 0, 'shankton: 2.5.0 could come down between the fences (the case is covered)');
  if (!c) continue;
  for (const q of c.window) check(!w.blocked(q.x, q.z) && w.ground.kind[at(q.x, q.z)] !== TILE.DOOR, `${def.id}: the window ${q.x},${q.z} is floor to stand on`);
  check(c.window.some((q) => c.gates.some((g) => Math.abs(g.x - q.x) + Math.abs(g.z - q.z) === 1)), `${def.id}: the window is beside the first gate`);
  for (const q of c.gates) check(w.ground.kind[at(q.x, q.z)] === TILE.DOOR && w.gate[at(q.x, q.z)] === 1, `${def.id}: ${q.x},${q.z} is a perimeter gate`);
  // The booth stands where nobody walks: outdoors, off every guard's way and the delivery's road and bay, not on the way out.
  const bt = at(c.booth.x, c.booth.z);
  const stops = def.guards.flatMap((g) => [...g.beat, ...(g.night ?? []), ...Object.values(g.posts ?? {})]);
  check(TILE_INFO[w.ground.kind[bt]].outdoor && !w.checkpoint[bt] && !c.window.some((q) => at(q.x, q.z) === bt) && !stops.some((p) => Math.abs(p.x - c.booth.x) <= 1 && Math.abs(p.z - c.booth.z) <= 1), `${def.id}: the booth stands out of everyone's way`);
  const road = def.delivery?.road ?? [];
  check(!road.some((p, k) => k > 0 && Math.min(p.x, road[k - 1].x) - 1 <= c.booth.x && c.booth.x <= Math.max(p.x, road[k - 1].x) + 1 && Math.min(p.z, road[k - 1].z) <= c.booth.z && c.booth.z <= Math.max(p.z, road[k - 1].z)), `${def.id}: the booth is off the delivery's road`);
  // Waved through, the window walks out to the road (the gates, the drawbridge): and not without.
  const walkOut = (waved: boolean) => {
    w.setWaved(waved);
    const seen = new Uint8Array(MAP_W * MAP_H);
    const q = [at(c.window[0].x, c.window[0].z)];
    seen[q[0]] = 1;
    for (let k = 0; k < q.length; k++) {
      const t = q[k];
      if (w.zoneAt(t % MAP_W, Math.floor(t / MAP_W)) === 'outside') return true;
      for (const j of [t - 1, t + 1, t - MAP_W, t + MAP_W]) if (j >= 0 && j < MAP_W * MAP_H && !seen[j] && !w.block[j]) (seen[j] = 1), q.push(j);
    }
    return false;
  };
  check(walkOut(true) && !walkOut(false), `${def.id}: waved through the window walks out to the road (and not without)`);
  w.setWaved(false);
}
const card = CATALOGUE.findIndex((c) => c.item === 'blank_id');
check(card === 9 && CATALOGUE[card].price === 80, 'the blank ID card on the phone at $80 (appended)');
const recipe = (id: string) => RECIPES.find((r) => r.result === id)!;
check([...recipe('fake_id').ingredients].sort().join() === 'blank_id,ink,magazine' && recipe('fake_id').int === 50, 'a fake ID: a blank card, ink and a magazine, Intellect 50');
check([...recipe('glider_frame').ingredients].sort().join() === 'balsa,balsa,timber' && recipe('glider_frame').int === 60, 'a glider frame: two balsa and a timber, Intellect 60');
check([...recipe('glider').ingredients].sort().join() === 'bed_sheet,duct_tape,glider_frame' && recipe('glider').int === 80, 'a glider: the frame, a bed sheet and duct tape, Intellect 80');
console.log(`data: checkpoints at ${PRISONS.filter((p) => p.checkpoint).map((p) => p.id).join(', ')}; gliders out of ${PRISONS.filter((p) => p.escapes?.includes('glider')).map((p) => p.id).join(', ')}; the card $80, the ID Int 50, the frame Int 60, the glider Int 80`);

// ------------------------------------------------------------------ the bluff
/** A game at 19:40 on day 1 with the player at the checkpoint's window, in uniform with papers (setup only). */
function atTheWindow(def: PrisonDef, seed = 1): Sim {
  const sim = new Sim(def, seed);
  const c = def.checkpoint!;
  // (The clock moved on to 19:40 with the day's blocks kept: no roll call missed.)
  sim.state.step = minute(19 * 60 + 40);
  sim.state.routine = routineAt(19 * 60 + 40);
  sim.state.attended = true;
  sim.restore(sim.snapshot());
  const s = sim.state;
  s.player.x = c.window[0].x * UNIT + UNIT / 2;
  s.player.z = c.window[0].z * UNIT + UNIT / 2;
  s.player.facing = 5;
  s.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
  s.items.inv[1] = slot(n('fake_id'));
  return sim;
}
const events = (sim: Sim) => sim.events as SimEvent[];
const refusedWhy = (sim: Sim) => events(sim).find((e): e is Extract<SimEvent, { type: 'refused' }> => e.type === 'refused')?.why ?? null;
const showAt = (sim: Sim, m: number) => {
  sim.state.step = minute(m) - 1;
  sim.step(command(0, OP.INTERACT));
};

{
  const base = atTheWindow(CENTER_PERKS).snapshot();
  const fresh = () => {
    const sim = new Sim(CENTER_PERKS, 1);
    sim.restore(base);
    return sim;
  };
  // Only at the window, only with the papers in the hotbar.
  let sim = fresh();
  check(atWindow(sim), 'at the window with papers, Interact shows them');
  sim.state.items.inv[1] = 0;
  check(!atWindow(sim), 'no papers in the hotbar: nothing to show');
  sim = fresh();
  sim.state.player.z -= UNIT;
  check(!atWindow(sim), 'a step back from the window: nothing to show');
  // The shift change: 19:50 up to 20:10.
  const when: string[] = [];
  for (const m of [SHIFT_FROM - 1, SHIFT_FROM, SHIFT_TO - 1, SHIFT_TO]) {
    sim = fresh();
    showAt(sim, m);
    when.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} ${sim.state.waved > 0 ? 'waved' : refusedWhy(sim)}`);
  }
  check(when.join() === '19:49 notShift,19:50 waved,20:09 waved,20:10 notShift', `the shift change only (${when.join(', ')})`);
  check(shiftChange(minute(SHIFT_FROM)) && !shiftChange(minute(SHIFT_FROM) - 1) && shiftChange(minute(SHIFT_TO) - 1) && !shiftChange(minute(SHIFT_TO)), 'the shift change: 19:50–20:10');
  // Out of uniform, too hot, wanted, a lockdown: refused, nothing lost.
  const refusals: string[] = [];
  const tryWith = (label: string, set: (s: Sim['state']) => void) => {
    const x = fresh();
    set(x.state);
    const cash = x.state.cash;
    showAt(x, SHIFT_FROM + 2);
    refusals.push(`${label} ${x.state.waved > 0 ? 'waved' : refusedWhy(x)}`);
    check(x.state.items.inv[1] === slot(n('fake_id')) && x.state.cash === cash, `${label}: the papers kept, nothing paid`);
  };
  tryWith('orange', (s) => (s.items.inv[SLOT.OUTFIT] = slot(n('inmate_outfit'))));
  tryWith(`heat ${BLUFF_HEAT}`, (s) => (s.heat = BLUFF_HEAT));
  tryWith(`heat ${BLUFF_HEAT - 1}`, (s) => (s.heat = BLUFF_HEAT - 1));
  tryWith('wanted', (s) => (s.heat = CHASE_HEAT));
  tryWith('lockdown', (s) => (s.lockdown = true));
  check(refusals.join() === `orange notGuard,heat 40 papersHot,heat 39 waved,wanted hunted,lockdown hunted`, `refusals (${refusals.join(', ')})`);
  // Waved through: the gates open for the player alone, for WAVED_STEPS.
  sim = fresh();
  showAt(sim, SHIFT_FROM + 1);
  const s = sim.state;
  const gates = CENTER_PERKS.checkpoint!.gates.map((q) => at(q.x, q.z));
  check(s.waved === s.step + WAVED_STEPS && events(sim).some((e) => e.type === 'bluff' && e.on), 'waved through for 60 s');
  check(gates.every((g) => !sim.world.block[g]) && gates.every((g) => sim.world.npcBlock[g] === 1), 'the gates open for the player, not for inmates');
  // Shown again: nothing new.
  const was = s.waved;
  sim.step(command(0, OP.INTERACT));
  check(s.waved === was, 'shown again while waved through: nothing new');
  // A save made now plays on the same as the game it was made from.
  const mid = sim.snapshot();
  const twin = new Sim(CENTER_PERKS, 1);
  twin.restore(JSON.parse(JSON.stringify(mid)) as Snapshot);
  for (let k = 0; k < WAVED_STEPS + 40; k++) {
    sim.step(0);
    twin.step(0);
  }
  check(sim.hash() === twin.hash(), 'a save made waved through plays on exactly the same');
  check(s.waved === 0 && gates.every((g) => sim.world.block[g] === 1), 'a minute later the gates shut again');
  // Standing in a gate when the minute runs out: it stays open until the player is off it.
  sim = fresh();
  showAt(sim, SHIFT_FROM + 1);
  sim.state.player.z = 61 * UNIT + UNIT / 2;
  sim.state.waved = sim.state.step + 2;
  for (let k = 0; k < 40; k++) sim.step(0);
  check(sim.state.waved > 0 && !sim.world.block[at(30, 61)], 'never shut on the player standing in a gate');
  sim.state.player.z = 60 * UNIT + UNIT / 2;
  sim.step(0);
  check(sim.state.waved === 0 && sim.world.block[at(30, 61)] === 1, 'shut once they step back off it');
  // Wanted while waved through: shut at once.
  sim = fresh();
  showAt(sim, SHIFT_FROM + 1);
  sim.state.heat = CHASE_HEAT;
  sim.step(0);
  check(sim.state.waved === 0 && events(sim).some((e) => e.type === 'bluff' && !e.on), 'wanted: the gates shut at once');
  // Out through them: the bluff, alone (a follower at the player's heels stays behind).
  sim = fresh();
  showAt(sim, SHIFT_FROM + 1);
  sim.state.followers = [0];
  Object.assign(sim.state.inmates[0].body, { x: sim.state.player.x + UNIT, z: sim.state.player.z });
  check(crewEscape(sim, 'bluff').length === 0 && crewEscape(sim, 'glider').length === 0 && crewEscape(sim, 'gate').length === 1, 'the bluff and the glider are solo (the same follower would go through a gate)');
  sim.state.followers = [];
  for (let k = 0; k < 200 && !sim.state.escaped; k++) sim.step(command(5));
  const outBy = ESCAPES[sim.state.via];
  check(outBy === 'bluff' && sim.state.crewOut.length === 0, `out through the gate: ${outBy}`);
  // Not waved: the gate stays shut.
  sim = fresh();
  for (let k = 0; k < 200 && !sim.state.escaped; k++) sim.step(command(5));
  check(!sim.state.escaped, 'not waved through: the gate stays shut');
  // Something else at the window: it comes first outside the shift change, the papers at it.
  {
    const x = fresh();
    const tile = at(30, 60);
    x.state.items.ground.push([placeKey(LAYER.GROUND, tile), slot(n('sock'))]);
    x.state.items.rev++;
    x.state.step = minute(SHIFT_FROM - 5);
    x.step(command(0, OP.INTERACT));
    check(events(x).some((e) => e.type === 'pickup') && !refusedWhy(x), 'outside the shift change, Interact picks up what lies at the window');
    const y = fresh();
    y.state.items.ground.push([placeKey(LAYER.GROUND, tile), slot(n('sock'))]);
    showAt(y, SHIFT_FROM + 1);
    check(y.state.waved > 0, 'at the shift change, the papers first');
  }
  // A save from before P24 loads shut.
  const old = fresh().snapshot();
  delete (old.state as { waved?: number }).waved;
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(old);
  check(loaded.state.waved === 0, 'a save from before the bluff loads with the gates shut');
  check(!checkpointOf(new Sim(TRAINING, 1)), 'no checkpoint in the Training Block');
  console.log(`bluff: ${when.join(', ')}; ${refusals.join(', ')}; the gates for the player alone, 60 s, never shut on them, at once when wanted; out by ${outBy}`);
}
// Irongate: the drawbridge comes down for the player alone; Shankton: the shell's gate and both of the gatehouse's.
{
  const sim = atTheWindow(IRONGATE);
  showAt(sim, SHIFT_FROM + 1);
  const bridge = at(30, 57);
  check(!sim.world.block[bridge] && sim.world.npcBlock[bridge] === 1 && sim.world.guardBlock[bridge] === 1, 'Irongate: the drawbridge down for the player alone');
  for (let k = 0; k < 300 && !sim.state.escaped; k++) sim.step(command(5));
  check(ESCAPES[sim.state.via] === 'bluff', `Irongate: out over the drawbridge (${ESCAPES[sim.state.via]})`);
  const sh = atTheWindow(SHANKTON);
  showAt(sh, SHIFT_FROM + 1);
  check(SHANKTON.checkpoint!.gates.every((q) => !sh.world.block[at(q.x, q.z)]), 'Shankton: the shell gate and both gatehouse gates open');
  for (let k = 0; k < 400 && !sh.state.escaped; k++) sh.step(command(5));
  check(ESCAPES[sh.state.via] === 'bluff', `Shankton: out through the gatehouse (${ESCAPES[sh.state.via]})`);
  // Off the drawbridge onto the rock beside it: never shut out there (only the way back leads in).
  const rock = atTheWindow(IRONGATE);
  showAt(rock, SHIFT_FROM + 1);
  Object.assign(rock.state.player, { x: 33 * UNIT + UNIT / 2, z: 57 * UNIT + UNIT / 2 });
  rock.state.waved = rock.state.step + 2;
  for (let k = 0; k < 40; k++) rock.step(0);
  check(rock.state.waved > 0 && !rock.world.block[at(30, 57)], 'Irongate: on the rock past the gate, the drawbridge stays down until the player is back');
  Object.assign(rock.state.player, { x: 30 * UNIT + UNIT / 2, z: 54 * UNIT + UNIT / 2 });
  rock.step(0);
  check(rock.state.waved === 0, 'back on the walkway: the gate shuts');
  check(!rock.world.pastCheckpoint(at(30, 54)) && !rock.world.pastCheckpoint(at(30, 59)) && rock.world.pastCheckpoint(at(33, 57)), 'past the checkpoint: the rock outside, not the walkway or the landing');
  const sh2 = new Sim(SHANKTON, 1);
  check(sh2.world.pastCheckpoint(at(52, 60)) && !sh2.world.pastCheckpoint(at(40, 56)), 'Shankton: the gatehouse is past the checkpoint, the gravel round the shell is not');
  console.log(`checkpoints: Irongate's drawbridge for the player alone, out over it, never shut on the rock past it; Shankton's three gates, its gatehouse held open`);
}

// ------------------------------------------------------------------ the glider
// How far the wind carries it: every heading against every wind, by strength.
{
  const rows: string[] = [];
  for (const weather of ['clear', 'rain'] as const)
    for (let force = 0; force <= 3; force++) {
      const by: number[] = [];
      for (let off = 0; off < 8; off++) by.push(glideReach({ wind: (0 + off + 4) % 8, force, weather }, 0));
      rows.push(`${weather} ${force}: ${by.join(' ')}`);
    }
  const want = (off: number, f: number, rain: boolean) => {
    const wind = off === 0 ? 2 * f : off === 1 || off === 7 ? f : off === 4 ? -f : off === 3 || off === 5 ? -Math.floor(f / 2) : 0;
    return Math.max(1, Math.min(GLIDE_MAX, GLIDE_BASE + wind - (rain ? 1 : 0)));
  };
  let ok = true;
  for (let heading = 0; heading < 8; heading += 2)
    for (let wind = 0; wind < 8; wind++)
      for (let force = 0; force <= 3; force++)
        for (const weather of ['clear', 'rain', 'fog'] as const) {
          const off = ((((wind + 4) % 8) - heading) % 8 + 8) % 8;
          if (glideReach({ wind, force, weather }, heading) !== want(off, force, weather === 'rain')) ok = false;
        }
  check(ok, 'glide reach: 3, +2 a point from behind (+1 a quarter behind), −1 a point ahead (half from a quarter ahead), −1 in rain, 1 to 10');
  console.log(`glide reach (tailwind, quarter tail, cross, quarter head, head, quarter head, cross, quarter tail):\n  ${rows.join('\n  ')}`);
}
// Where it goes and doesn't, at Stalag Flucht's generator hut.
{
  const sim = new Sim(STALAG_FLUCHT, 1);
  const w = sim.world;
  const s = sim.state;
  const still: Air = { wind: 0, force: 0, weather: 'clear' };
  const east: Air = { wind: 6, force: 1, weather: 'clear' };
  const body = (x: number, z: number, facing: number) => ({ x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2, facing, moving: false });
  const G = n('glider');
  const tt = (x: number, z: number, facing: number, air: Air, layer: number = LAYER.ROOF) => toolTarget(w, layer, body(x, z, facing), G, [], [slot(G)], air);
  check(tt(58, 24, 1, east)?.action === 'glide' && tt(58, 24, 1, east)!.fits && tt(58, 24, 1, east)!.glide!.out, 'the hut’s east edge, a west wind: out');
  check(tt(57, 24, 1, east) === null, 'a tile back from the edge: no glide');
  check(tt(58, 24, 1, east, LAYER.GROUND) === null, 'on the ground: no glide');
  check(tt(58, 24, 1, { ...east, weather: 'storm' })?.glide?.why === 'storm', 'in a storm: grounded');
  // The run-up: off Irongate's outer wall (a roof one tile wide), facing out to sea: no room to run.
  const iw = new World(IRONGATE);
  const runUp = glideFrom(iw, body(20, 4, 13), still);
  check(!!runUp && runUp.why === 'runUp', `no run-up behind: can't go (${runUp && runUp.why})`);
  // Nowhere to land: off that wall into the sea, room to run or not.
  const sea = glideFrom(iw, body(20, 4, 13), { wind: 4, force: 0, weather: 'clear' });
  check(!!sea && (sea.why === 'runUp' || sea.why === 'noLanding'), 'off the outer wall: nowhere to land but the sea');
  // Still air: 3 tiles, onto the snow by the wire (61 is the fence: down at 60, short).
  const g = glideFrom(w, body(58, 24, 1), still)!;
  check(g.reach === 3 && g.dist === 2 && g.short && !g.out, `still air: a fence where it would land, down short (${g.dist} of ${g.reach})`);
  // What the button says is what happens: flown at every edge the ladder's roof reaches, every wind.
  const snap = sim.snapshot();
  let flown = 0;
  let agree = 0;
  for (const [t, facing] of launchSpots(w))
    for (let wind = 0; wind < 8; wind += 3)
      for (const force of [0, 2]) {
        const twin = new Sim(STALAG_FLUCHT, 1);
        twin.restore(snap);
        const ts = twin.state;
        ts.calendar = [[1, -1, -1, wind, force]];
        ts.layer = LAYER.ROOF;
        Object.assign(ts.player, body(t % MAP_W, Math.floor(t / MAP_W), facing));
        ts.items.inv[0] = slot(G);
        ts.items.hand = 0;
        const plan = today(twin);
        const promise = toolTarget(twin.world, LAYER.ROOF, ts.player, G, bodiesOf(twin), ts.items.inv, { wind: plan.wind, force: plan.windForce, weather: plan.weather });
        twin.step(command(0, OP.USE, 1));
        flown++;
        if (!promise || promise.action !== 'glide') continue;
        const ev = (twin.events as SimEvent[]).find((e): e is Extract<SimEvent, { type: 'glide' }> => e.type === 'glide');
        const landed = Math.floor(ts.player.z / UNIT) * MAP_W + Math.floor(ts.player.x / UNIT);
        const same = promise.fits ? !!ev && ts.layer === LAYER.GROUND && landed === promise.tile && ev.dist === promise.glide!.dist && ev.short === promise.glide!.short && (ts.escaped > 0) === promise.glide!.out && (ts.escaped > 0 ? ESCAPES[ts.via] === 'glider' : true) && ts.items.inv[0] === 0 : !ev && ts.layer === LAYER.ROOF && ts.items.inv[0] === slot(G);
        if (same) agree++;
        else check(false, `the promise at ${t % MAP_W},${Math.floor(t / MAP_W)} facing ${facing}, wind ${wind}/${force}: ${promise.fits ? `${promise.tile} ${promise.glide!.out}` : promise.glide!.why} vs ${landed} ${ts.escaped}`);
      }
  check(agree > 0, 'some glides flown');
  // Someone standing where it would land: down on the tile before, as the button says.
  {
    const twin = new Sim(STALAG_FLUCHT, 1);
    twin.restore(snap);
    const ts = twin.state;
    ts.calendar = [[1, -1, -1, 6, 1]];
    ts.layer = LAYER.ROOF;
    Object.assign(ts.player, body(58, 24, 1));
    ts.items.inv[0] = slot(G);
    ts.items.hand = 0;
    const p = today(twin);
    const air = { wind: p.wind, force: p.windForce, weather: p.weather };
    const clear = toolTarget(twin.world, LAYER.ROOF, ts.player, G, bodiesOf(twin), ts.items.inv, air)!;
    Object.assign(ts.inmates[0].body, { x: (clear.tile % MAP_W) * UNIT + UNIT / 2, z: Math.floor(clear.tile / MAP_W) * UNIT + UNIT / 2 });
    const promise = toolTarget(twin.world, LAYER.ROOF, ts.player, G, bodiesOf(twin), ts.items.inv, air)!;
    twin.step(command(0, OP.USE, 1));
    const landed = Math.floor(ts.player.z / UNIT) * MAP_W + Math.floor(ts.player.x / UNIT);
    check(promise.tile !== clear.tile && landed === promise.tile, `never down on someone: ${clear.tile % MAP_W} taken, down at ${landed % MAP_W} as promised`);
  }
  console.log(`glider: the button's promise agrees with the flight ${agree}/${flown - (flown - agree)} times off Stalag Flucht's hut; still air ${g.dist} of ${g.reach} (a fence in the way)`);
  void s;
  void RUN_UP;
}
// Every glider prison: what the button says, flown, at a sample of edges and winds; the crew stays behind.
{
  const tally: string[] = [];
  for (const def of [CENTER_PERKS, SHANKTON]) {
    const sim = new Sim(def, 2);
    const snap = sim.snapshot();
    const spots = launchSpots(sim.world);
    let agree = 0;
    let outs = 0;
    let ins = 0;
    for (let k = 0; k < spots.length; k += 13) {
      const [t, facing] = spots[k];
      for (const [wind, force] of [
        [(DIR8[facing] + 4) % 8, 2],
        [(DIR8[facing] + 4) % 8, 1],
        [DIR8[facing], 2],
      ]) {
        const twin = new Sim(def, 2);
        twin.restore(snap);
        const ts = twin.state;
        ts.calendar = [[1, -1, -1, wind, force]];
        ts.layer = LAYER.ROOF;
        Object.assign(ts.player, { x: (t % MAP_W) * UNIT + UNIT / 2, z: Math.floor(t / MAP_W) * UNIT + UNIT / 2, facing, moving: false });
        ts.items.inv[0] = slot(n('glider'));
        ts.items.hand = 0;
        const p = today(twin);
        const promise = toolTarget(twin.world, LAYER.ROOF, ts.player, n('glider'), bodiesOf(twin), ts.items.inv, { wind: p.wind, force: p.windForce, weather: p.weather })!;
        twin.step(command(0, OP.USE, 1));
        const landed = Math.floor(ts.player.z / UNIT) * MAP_W + Math.floor(ts.player.x / UNIT);
        const ok = promise.fits ? landed === promise.tile && (ts.escaped > 0) === promise.glide!.out : ts.layer === LAYER.ROOF;
        check(ok, `${def.id}: the promise at ${t % MAP_W},${Math.floor(t / MAP_W)} facing ${facing} in wind ${wind}/${force}`);
        if (ok) agree++;
        if (ts.escaped) {
          outs++;
          check(ESCAPES[ts.via] === 'glider' && ts.crewOut.length === 0, `${def.id}: out on a glider, alone`);
        } else if (promise.fits) {
          ins++;
          check(ts.feats[FEAT.glidesIn] === 1 && ts.feats[FEAT.glides] === 1, `${def.id}: a glide down inside counted`);
        }
      }
    }
    tally.push(`${def.id} ${agree} agree (${outs} out, ${ins} down inside)`);
  }
  console.log(`promises flown: ${tally.join('; ')}`);
}
// Forced wind days (bots, tests): the wind and its strength as forced, still calm in fog.
{
  const p = dayPlan('center-perks', 7, 3, [[3, -1, -1, 6, 2]]);
  const fog = dayPlan('center-perks', 7, 3, [[3, -1, 1, 6, 2]]);
  check(p.wind === 6 && p.windForce === 2 && fog.wind === 6 && fog.windForce === 0, 'a forced wind: from where it says, as strong (calm in fog)');
  const s = new Sim(CENTER_PERKS, 1);
  s.state.calendar = [[1, -1, -1, 2, 1]];
  const snap = s.snapshot();
  const t2 = new Sim(CENTER_PERKS, 1);
  t2.restore(JSON.parse(JSON.stringify(snap)) as Snapshot);
  check(today(t2).wind === 2 && today(t2).windForce === 1, 'a forced wind kept in a save');
  console.log('forced wind: kept, calm in fog, saved');
}

// ------------------------------------------------------------------ achievements
{
  const find = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;
  const run = (feat: string, v: number) => {
    const feats: number[] = [];
    feats[FEAT[feat as keyof typeof FEAT]] = v;
    return { prison: 'center-perks', feats, days: [], str: 40, spd: 40, int: 40 };
  };
  const esc = (via: string) => ({ ...run('glides', 0), via, day: 3, medal: null });
  check(find('papersPlease').escape!(esc('bluff')) && !find('papersPlease').escape!(esc('gate')), 'Papers, Please: out by the bluff');
  check(find('wingIt').escape!(esc('glider')) && !find('wingIt').escape!(esc('roof')), 'Wing It: out on a glider');
  check(find('tailwind').run!(run('glideFar', 7)) && !find('tailwind').run!(run('glideFar', 6)), 'Tailwind: a glide of 7 tiles');
  check(find('grounded').hidden === true && find('grounded').run!(run('glidesIn', 1)), 'Grounded: hidden, a glide down inside');
  console.log('achievements: Papers, Please; Wing It; Tailwind (7 tiles); Grounded (hidden)');
}

void MAP_H;
void bluffRefusal;
