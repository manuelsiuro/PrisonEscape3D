/**
 * The manhunt (P41): every outside map holds together (its picture, a start for every kind of
 * way out its prison has, the safe point and Lou's car reachable from each start with every
 * roadblock up, the searchers' beats walkable, washing lines and posts where they can be
 * reached), a getaway bot gets clean away from every start of every prison, the rules each do
 * what they say (the head start, the trail and the dogs, cover, a washing line, wire cut,
 * stones, roadblocks, the helicopter's light, the lookout, Lou's car, recapture and how close
 * it got), and a hunt is deterministic.
 */
import { HUNT, isLegal, LEGAL_ROUTES, startKindOf } from '../src/content/manhunt';
import { itemNumber } from '../src/content/items';
import { OUTSIDES, outsideOf } from '../src/content/outside';
import { START_KINDS, type StartKind } from '../src/content/outside/types';
import { escapesOf, PRISONS } from '../src/content/prisons';
import { Hunt, OVER, type Carry } from '../src/sim/hunt/Hunt';
import { fillArea, outsideWorld, pictureRows, spotTile } from '../src/sim/hunt/world';
import { MAP_H, MAP_W } from '../src/sim/world/World';
import { HuntBot } from './huntbot';
import { Sim } from '../src/sim/Sim';
import { carryFrom, headStartAt } from '../src/sim/hunt/carry';
import { HOUND, SEEK } from '../src/sim/hunt/Hunt';
import { slot } from '../src/sim/systems/items';
import { command, DIR_X, DIR_Z, EXT, OP, tossArgs } from '../src/sim/command';
import { Autopilot } from '../src/sim/ai/autopilot';
import { tileAt } from '../src/sim/ai/path';
import { lineOfSight } from '../src/sim/ai/sight';
import { LESSONS, type LessonCtx } from '../src/tutorial/lessons';
import { LessonProgress } from '../src/tutorial/progress';
import { check } from './assert';
import { TILE } from '../src/sim/world/tiles';

const N = MAP_W * MAP_H;
const cheb = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

/** Walking tiles from a tile over open ground (`open`), -1 unreached. */
function flood(from: number, open: (i: number) => boolean): Int32Array {
  const d = new Int32Array(N).fill(-1);
  d[from] = 0;
  const q = [from];
  for (let k = 0; k < q.length; k++) {
    const t = q[k];
    const x = t % MAP_W;
    for (const [j, ok] of [
      [t - 1, x > 0],
      [t + 1, x < MAP_W - 1],
      [t - MAP_W, t >= MAP_W],
      [t + MAP_W, t < MAP_W * (MAP_H - 1)],
    ] as const)
      if (ok && d[j] < 0 && open(j)) (d[j] = d[t] + 1), q.push(j);
  }
  return d;
}

/** A carry for the tests: a player at Speed 40 in the jumpsuit, nothing in the pockets, at night, the alarm after the longest head start. */
export function testCarry(prison: string, kind: StartKind, more: Partial<Carry> = {}): Carry {
  return { prison, via: 'fence', kind, spd: 40, outfit: itemNumber('inmate_outfit'), kit: [], crew: 0, lou: false, headStart: HUNT.headStartMax, minute: 23 * 60 + 40, salt: 1, ...more };
}

// ------------------------------------------------------------------ the maps
check(OUTSIDES.length === PRISONS.length && PRISONS.every((p) => !!outsideOf(p.id)), 'every campaign prison has its outside');
check(LEGAL_ROUTES.every((r) => isLegal(r)) && !isLegal('fence'), 'legal releases end at the wall');
for (const def of OUTSIDES) {
  const prison = PRISONS.find((p) => p.id === def.prison)!;
  const o = outsideWorld(def, prison);
  const { ox, oz } = o;
  const T = (s: { x: number; z: number }) => spotTile(s, ox, oz);
  // The roads out of the map and the edges: nobody walks off it.
  for (let i = 0; i < N; i++) if (!o.inside[i]) check(o.base[i] === 1, `${def.prison}: past the picture is solid`);
  // Roads and tracks run unbroken (v2.21.4 review: hedges drawn across tracks, tracks stopping a tile short of the road):
  // nothing standing or growing across one between two of its tiles, and no track (one or two wide) ending a tile or two before a road it runs at.
  {
    const rows = pictureRows(def);
    const at = (x: number, z: number) => rows[z]?.[x] ?? '';
    const way = (c: string) => c === ',' || c === 'a' || c === 'd';
    for (let z = 0; z < rows.length; z++)
      for (let x = 0; x < rows[0].length; x++) {
        const c = at(x, z);
        // (Crates stand in the yards' asphalt and wagons on the rails: those are no road.)
        if ('hTko'.includes(c))
          for (const [dx, dz] of [[1, 0], [0, 1]]) {
            const p = at(x - dx, z - dz);
            check(!(way(p) && p === at(x + dx, z + dz) && (way(at(x - 2 * dx, z - 2 * dz)) || way(at(x + 2 * dx, z + 2 * dz)))), `${def.prison}: '${c}' across a road or track at (${x},${z})`);
          }
        if (c !== 'd') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          // (A track: running this way, at most two wide across it.)
          if (at(x - dx, z - dz) !== 'd' || way(at(x + dx, z + dz))) continue;
          const wide = [1, 2, 3].filter((k) => at(x + dz * k, z + dx * k) === 'd' || at(x - dz * k, z - dx * k) === 'd').length;
          if (wide > 1) continue;
          for (const k of [2, 3]) {
            const t = at(x + dx * k, z + dz * k);
            if (t === ',' || t === 'a' || t === 'u') check(false, `${def.prison}: the track at (${x},${z}) stops ${k - 1} short of the road`);
            if (t !== '.' ) break;
          }
        }
      }
  }
  // Every roadblock up.
  const shut = o.base.slice();
  for (const r of def.roadblocks) fillArea(shut, r.area, ox, oz);
  const open = (i: number) => !shut[i];
  const kinds = [...new Set(escapesOf(prison).filter((r) => !isLegal(r)).map((r) => startKindOf(r, prison)))];
  for (const kind of START_KINDS) check(kinds.includes(kind) === !!def.starts[kind], `${def.prison}: a start for ${kind} exactly when a way out needs it`);
  const lines: string[] = [];
  for (const kind of kinds) {
    const from = T(def.starts[kind]!);
    check(!o.base[from], `${def.prison} ${kind}: the start is open ground`);
    const d = flood(from, open);
    let best = -1;
    for (let i = 0; i < N; i++) if (o.safe[i] && d[i] >= 0 && (best < 0 || d[i] < best)) best = d[i];
    check(best > 0, `${def.prison} ${kind}: the safe point reachable with every roadblock up, no wire cut`);
    const lou = d[T(def.lou)];
    // (Nearer from where the walls leave the player; a glider, a van or a helicopter may set them down past it.)
    check(lou > 0 && (lou < best || !['wall', 'gate', 'sea'].includes(kind)), `${def.prison} ${kind}: Lou's car reachable, and nearer than the safe point (${lou} against ${best})`);
    lines.push(`${kind} ${best} (Lou ${lou})`);
  }
  // Lou's car (drawn on its spot, 2.8 tiles long the way it faces): its spot and a tile either way along it open ground.
  {
    const fx = Math.round(DIR_X[def.lou.face ?? 5] / 1024);
    const fz = Math.round(DIR_Z[def.lou.face ?? 5] / 1024);
    const foot = [-1, 0, 1].map((k) => T({ x: def.lou.x + k * fx, z: def.lou.z + k * fz }));
    check(foot.every((i) => !o.base[i] && o.inside[i] && !o.cover[i]), `${def.prison}: Lou's car stands on open ground`);
    // (On a road or a track, along it: a car parked out on the sand or the verge read wrong.)
    const k = o.world.ground.kind;
    check(foot.every((i) => k[i] === TILE.ROAD || k[i] === TILE.ASPHALT || k[i] === TILE.DIRT), `${def.prison}: Lou's car stands on a road or track`);
  }
  const anyStart = T(Object.values(def.starts)[0]!);
  const all = flood(anyStart, (i) => !o.base[i]);
  for (const [k, l] of def.lines.entries()) check(all[T(l)] >= 0, `${def.prison}: washing line ${k} reachable`);
  check(all[T(def.lookout)] >= 0, `${def.prison}: the lookout's spot reachable`);
  for (const [k, r] of def.roadblocks.entries()) {
    const [x0, z0, x1, z1] = r.area;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) check(!o.base[(z + oz) * MAP_W + x + ox], `${def.prison}: roadblock ${k} stands on open ground`);
    check(!shut[T(r.post)], `${def.prison}: roadblock ${k}'s officer stands beside it`);
  }
  // The searchers' beats: each stop open ground, walkable from the first (keeping out of cover, as they do).
  for (const s of def.searchers) {
    const d = flood(T(s.beat[0]), (i) => !o.base[i] && !o.cover[i]);
    for (const b of s.beat) check(d[T(b)] >= 0, `${def.prison}: ${s.name}'s stop ${b.x},${b.z} walkable from his first`);
  }
  for (const r of def.heli.route) check(r.x >= 0 && r.z >= 0 && r.x < o.w && r.z < o.h, `${def.prison}: the helicopter's sweep over the map`);
  const covers = Array.from(o.cover).filter(Boolean).length;
  console.log(`${def.prison}: ${o.w}×${o.h}, ${def.searchers.length} searchers (${def.searchers.filter((s) => s.dog).length} dogs), ${def.roadblocks.length} roadblocks, ${def.lines.length} washing lines, ${covers} cover tiles; to safety: ${lines.join(', ')}`);
}

// ------------------------------------------------------------------ the getaway bots
for (const def of OUTSIDES) {
  const prison = PRISONS.find((p) => p.id === def.prison)!;
  for (const kind of START_KINDS) {
    if (!def.starts[kind]) continue;
    // (If not on the first salt, on another: the run's draws move the searchers about.)
    let r = null;
    for (const salt of [1, 2, 3, 4, 5, 6]) {
      const hunt = new Hunt(def, prison, testCarry(def.prison, kind, { salt }));
      r = new HuntBot(hunt).run();
      const f = hunt.state.feats;
      console.log(`${def.prison} ${kind}, salt ${salt}: ${r.over === OVER.SAFE ? 'clean away' : r.over === OVER.CAUGHT ? `CAUGHT at ${Math.round(hunt.progress * 100)}%` : 'still out'} in ${r.secs} s; spotted ${f[0]}, hid ${f[2]}, stones ${f[5]}, lit ${f[7]} · ${r.hash}`);
      for (const l of r.log) console.log(`  ${l}`);
      if (r.over === OVER.SAFE) break;
    }
    check(r?.over === OVER.SAFE, `${def.prison} ${kind}: the getaway bot gets clean away`);
  }
  // Seen going (the alarm up at once), by day: away all the same (if not on the first salt, on another: hunttest tries every start so).
  const kind = (Object.keys(def.starts) as StartKind[])[0];
  const tries: string[] = [];
  let away = false;
  for (const salt of [1, 2, 3, 4, 5, 6]) {
    const seen = new Hunt(def, prison, testCarry(def.prison, kind, { headStart: 0, minute: 14 * 60, salt }));
    const r = new HuntBot(seen).run();
    tries.push(`salt ${salt} ${r.over === OVER.SAFE ? 'clean away' : `CAUGHT at ${Math.round(seen.progress * 100)}%`} in ${r.secs} s · ${r.hash}`);
    if ((away = r.over === OVER.SAFE)) break;
  }
  console.log(`${def.prison} ${kind}, seen going, by day: ${tries.join('; ')}`);
  check(away, `${def.prison} ${kind}: away even seen going, by day`);
}

// ------------------------------------------------------------------ the rules, one by one
const CP = PRISONS[0];
const CPO = outsideOf('center-perks')!;
const SF = PRISONS[1];
const SFO = outsideOf('stalag-flucht')!;
/** A hunt to try a rule on: only these searchers out (by their place in the list), no roadblocks, no helicopter unless asked. */
const lab = (def = CPO, prison = CP, more: Partial<Carry> = {}, opts: { searchers?: number[]; heli?: boolean; roadblocks?: boolean } = { searchers: [], heli: false, roadblocks: false }) => new Hunt(def, prison, testCarry(def.prison, 'wall', { headStart: 0, ...more }), opts);
/** Puts the player on a picture tile (facing a way). */
const put = (h: Hunt, x: number, z: number, face = 13) => {
  const p = h.state.player;
  p.x = (x + h.out.ox) * 1024 + 512;
  p.z = (z + h.out.oz) * 1024 + 512;
  p.facing = face;
  h.state.at = h.tile;
};
/** Steps (the command's operation on the first only), and the events seen. */
const steps = (h: Hunt, n: number, cmd = 0) => {
  const seen: string[] = [];
  for (let k = 0; k < n && !h.state.over; k++) {
    h.step(k === 0 ? cmd : cmd & 31);
    for (const e of h.events) seen.push(e.type === 'refused' ? `refused:${e.why}` : e.type);
  }
  return seen;
};

// The head start: to the next headcount, at least 5 s, at most HUNT.headStartMax.
{
  const at = [[23 * 60 + 40, 'night'], [8 * 60 + 58, 'just before breakfast'], [14 * 60, 'afternoon'], [3 * 60 + 50, 'before the 04:00 bed check']] as const;
  console.log(`head start: ${at.map(([m, what]) => `${what} ${headStartAt(m)} s`).join(', ')}`);
  check(headStartAt(23 * 60 + 40) === HUNT.headStartMax && headStartAt(8 * 60 + 58) === 5, 'head start capped and floored');
}

// What carries over from the wall: the way out and its start, Speed, clothes, the kit, the crew, Lou, the head start.
{
  const sim = new Sim(CP, 3);
  const s = sim.state;
  s.via = 1;
  s.spd = 52;
  s.items.inv[0] = slot(itemNumber('light_cutters'));
  s.items.inv[1] = slot(itemNumber('jerky'));
  s.items.inv[7] = slot(itemNumber('guard_outfit'));
  s.crewOut = [2];
  s.lou[5] = -1;
  const c = carryFrom(sim);
  console.log(`carry: ${c.via} → ${c.kind}, Speed ${c.spd}, outfit ${c.outfit === itemNumber('guard_outfit') ? 'guard' : c.outfit}, kit ${c.kit.length}, crew ${c.crew}, Lou ${c.lou}, head start ${c.headStart} s at ${c.minute}`);
  check(c.kind === 'wall' && c.spd === 52 && c.kit.length === 2 && c.crew === 1 && c.lou, 'carry: what the player brings out');
  s.lockdown = true;
  check(carryFrom(sim).headStart === 0, 'carry: seen going in a lockdown, no head start');
  const h = new Hunt(CPO, CP, c);
  check(h.state.clothes === 1 && h.state.cutters && h.state.treats[0] === 1, "the hunt: a guard's uniform, cutters, a jerky");
}

// Every way out of every prison: a start, or ends at the wall (legal).
console.log(`starts: ${PRISONS.map((p) => `${p.id} ${escapesOf(p).map((r) => `${r}→${isLegal(r) ? 'legal' : startKindOf(r, p)}`).join(' ')}`).join('; ')}`);

// Cover: still in a hedge for a moment, hidden; a searcher's eyes on it see nothing.
{
  const h = lab(CPO, CP, {}, { searchers: [3], heli: false, roadblocks: false });
  put(h, 18, 50);
  const ev = steps(h, HUNT.settle + 2);
  const m = h.state.searchers[3];
  m.mode = SEEK.BEAT;
  m.body.x = h.state.player.x - 3 * 1024;
  m.body.z = h.state.player.z;
  m.body.facing = 1;
  steps(h, 1);
  check(h.state.hidden && ev.includes('hidden') && !m.sees, 'cover: hidden in a hedge, unseen by eyes on it');
  console.log(`cover: hidden after ${HUNT.settle} still steps, a searcher 3 tiles off looking right at the hedge sees nothing`);
}

// Spotted in the open, the meter fills; a chase; caught at arm's length.
{
  const h = lab(CPO, CP, {}, { searchers: [3], heli: false, roadblocks: false });
  put(h, 20, 54);
  steps(h, 1);
  const m = h.state.searchers[3];
  // (On his beat, heading west along the wall, for the player's tile.)
  m.mode = SEEK.BEAT;
  m.k = 1;
  m.body.x = h.state.player.x + 4 * 1024;
  m.body.z = h.state.player.z;
  m.body.facing = 9;
  m.goal = -2;
  const ev = steps(h, 200);
  check(ev.includes('spotted') && h.state.over === OVER.CAUGHT, 'caught: spotted standing in the open, then caught');
  console.log(`caught: spotted, then caught after ${h.state.overAt} steps; ${Math.round(h.progress * 100)}% of the way`);
}

// The trail and the dogs: a dog crossing it tracks it to a player hidden at its end, points, and its handler finds them.
{
  const h = lab(CPO, CP, {}, { searchers: [2], heli: false, roadblocks: false });
  // A trail laid north from the wall to the thicket, the player hidden in it.
  const walk = new Autopilot(h.world, () => h.grid);
  walk.goTo((50 + h.out.oz) * 64 + 18 + h.out.ox);
  for (let k = 0; k < 400 && walk.active; k++) h.step(command(walk.dir(h.state.player)));
  // The handler and his dog brought to where the trail began.
  const m = h.state.searchers[2];
  const d = h.state.dogs[0];
  for (const b of [m.body, d.body]) {
    b.x = (14 + h.out.ox) * 1024 + 512;
    b.z = (54 + h.out.oz) * 1024 + 512;
  }
  m.mode = SEEK.BEAT;
  m.path = [];
  m.goal = -2;
  const ev = steps(h, 30 * 20);
  console.log(`dogs: ${['track', 'point', 'caught'].map((e) => `${e} ${ev.includes(e) ? 'yes' : 'no'}`).join(', ')} (hidden ${h.state.hidden})`);
  check(ev.includes('track') && ev.includes('point') && h.state.over === OVER.CAUGHT, 'dogs: a trail followed into the thicket, found');
}

// A washing line: other clothes, the trail gone; used once.
{
  const h = lab();
  put(h, 13, 19, 1);
  h.state.trail = [[h.tile, 1]];
  const ev = steps(h, 1, command(0, OP.INTERACT));
  const again = steps(h, 1, command(0, OP.INTERACT));
  check(ev.includes('swap') && h.state.clothes === 2 && h.state.trail.length <= 1 && again.includes('refused:nothing'), 'a washing line: clothes, the trail washed, used once');
  console.log('washing line: other clothes, the trail gone, nothing more to take');
}

// Wire: no cutters, no way through; cutters, two seconds standing at it.
{
  const h = lab(SFO, SF);
  put(h, 20, 9, 13);
  const wire = h.wireAhead();
  const none = steps(h, 1, command(0, OP.INTERACT));
  check(wire >= 0 && none.includes('refused:noCutters'), 'wire: no cutters, refused');
  const h2 = lab(SFO, SF, { kit: [itemNumber('light_cutters')] });
  put(h2, 20, 9, 13);
  const ev = steps(h2, HUNT.cutSteps + 2, command(0, OP.INTERACT));
  check(ev.includes('cut') && h2.state.cut.length === 1 && !h2.grid[wire], 'wire: cut through with cutters');
  console.log(`wire: refused without cutters; cut in ${HUNT.cutSteps} steps with them, heard ${HUNT.cutNoise} tiles off`);
}

// A stone: heard where it lands; not again so soon.
{
  const h = lab(CPO, CP, {}, { searchers: [1], heli: false, roadblocks: false });
  steps(h, 1);
  const m = h.state.searchers[1];
  put(h, 52, 13, 13);
  m.body.x = h.state.player.x;
  m.body.z = h.state.player.z - 9 * 1024;
  const t = h.stoneTarget();
  const [b, c] = tossArgs(t);
  const ev = steps(h, 1, command(0, OP.EXT, EXT.HUNT_THROW, b, c));
  const soon = steps(h, 1, command(0, OP.EXT, EXT.HUNT_THROW, b, c));
  check(ev.includes('stone') && ev.includes('heard') && m.mode === SEEK.LOOK && soon.includes('refused:stoneSoon'), 'a stone: heard, looked into; not again so soon');
  const ahead = cheb(t, h.tile);
  // He walks to where it landed, looks round there, and goes back to his beat (the player well away by then).
  put(h, 5, 50);
  const thrown = h.state.step;
  let reached = -1;
  let back = -1;
  for (let k = 0; k < 40 * 20 && back < 0; k++) {
    h.step(0);
    if (reached < 0 && cheb(tileAt(m.body.x, m.body.z), t) <= 1) reached = h.state.step;
    if (reached > 0 && m.mode === SEEK.BEAT) back = h.state.step;
  }
  check(reached > 0 && back > 0 && back - thrown >= HUNT.look, `a stone: he walks there, looks round, back to his beat (there at ${reached}, back at ${back})`);
  console.log(`stone: lands ${ahead} tiles ahead, heard ${HUNT.stoneNoise} walking tiles round; again after ${HUNT.stoneEvery / 20} s; the searcher there in ${((reached - thrown) / 20).toFixed(1)} s, back on his beat ${((back - thrown) / 20).toFixed(1)} s after`);
}

// Treats: jerky calms a dog, pepper dazes it, sleepy jerky puts it to sleep.
{
  const out: string[] = [];
  for (const what of [0, 1, 2]) {
    const h = lab(CPO, CP, { kit: [itemNumber(['jerky', 'pepper', 'sleepy_jerky'][what])] }, { searchers: [2], heli: false, roadblocks: false });
    put(h, 40, 40);
    steps(h, 2);
    h.state.searchers[2].mode = SEEK.BEAT;
    const d = h.state.dogs[0];
    d.body.x = h.state.player.x;
    d.body.z = h.state.player.z + 3 * 1024;
    const ev = steps(h, 1, command(0, OP.EXT, EXT.HUNT_TREAT, h.dogInReach(), what));
    out.push(`${['jerky', 'pepper', 'sleepy jerky'][what]} ${['heel', 'track', 'point', 'calm', 'dazed', 'asleep'][d.mode]}`);
    check(ev.includes('treat') && d.mode === [HOUND.CALM, HOUND.DAZED, HOUND.ASLEEP][what], `treat ${what}: the dog's state`);
  }
  console.log(`treats: ${out.join(', ')}`);
}

// Roadblocks go up at their time (never on the player), the way shut; the helicopter's light; the lookout's whistle.
{
  const h = new Hunt(CPO, CP, testCarry('center-perks', 'wall', { headStart: 0 }), { searchers: [], heli: false });
  steps(h, (Math.max(...CPO.roadblocks.map((b) => b.at)) + 1) * 20);
  const r = CPO.roadblocks[0];
  check(h.state.blocks === (1 << CPO.roadblocks.length) - 1 && !!h.grid[(r.area[1] + h.out.oz) * 64 + r.area[0] + h.out.ox], 'roadblocks up, their tiles shut');
  const h2 = new Hunt(CPO, CP, testCarry('center-perks', 'wall', { headStart: 0 }), { searchers: [], heli: true, roadblocks: false });
  steps(h2, CPO.heli.at * 20 + 1);
  h2.state.heli.x = h2.state.player.x;
  h2.state.heli.z = h2.state.player.z;
  const lit = steps(h2, 1);
  put(h2, 18, 50);
  h2.state.heli.x = h2.state.player.x;
  h2.state.heli.z = h2.state.player.z;
  steps(h2, HUNT.settle + 2);
  check(lit.includes('lit') && h2.state.hidden && !h2.state.heli.lit, 'the helicopter: lit in the open, not in cover');
  // The lookout whistles at a searcher coming close that they see from their rise; one out of their sight goes unwarned.
  const watch = (seen: boolean, px: number, pz: number) => {
    for (let dz = -6; dz <= 6; dz++)
      for (let dx = -6; dx <= 6; dx++) {
        const h3 = new Hunt(CPO, CP, testCarry('center-perks', 'wall', { headStart: 0, crew: 1 }), { searchers: [3], heli: false, roadblocks: false });
        put(h3, px, pz);
        steps(h3, 1);
        const at = spotTile({ x: px + dx, z: pz + dz }, h3.out.ox, h3.out.oz);
        const look = spotTile(CPO.lookout, h3.out.ox, h3.out.oz);
        if (h3.grid[at] || h3.out.cover[at] || Math.hypot(dx, dz) > HUNT.lookoutWarn - 1 || Math.hypot(dx, dz) < 3) continue;
        const sees = cheb(at, look) <= HUNT.lookoutSight - 2 && lineOfSight(h3.world, (look % MAP_W) * 1024 + 512, Math.floor(look / MAP_W) * 1024 + 512, (at % MAP_W) * 1024 + 512, Math.floor(at / MAP_W) * 1024 + 512);
        if (sees !== seen) continue;
        const m = h3.state.searchers[3];
        m.mode = SEEK.BEAT;
        m.body.x = (at % MAP_W) * 1024 + 512;
        m.body.z = Math.floor(at / MAP_W) * 1024 + 512;
        return steps(h3, 1).includes('whistle');
      }
    return null;
  };
  check(watch(true, 28, 47) === true, 'the lookout whistles at a searcher coming close that they see');
  check(watch(false, 8, 50) === false, "a searcher out of the lookout's sight goes unwarned");
  console.log(`roadblocks: ${CPO.roadblocks.map((b) => `${b.at} s`).join(', ')} after the alarm; the helicopter's light: on in the open, off in cover; the lookout whistles at ${HUNT.lookoutWarn} tiles`);
}

// Cover, moving: seen there only close by (HUNT.coverSeen), the meter at a third of the pace; a chaser who saw them go in catches them there.
{
  const h = lab(CPO, CP, {}, { searchers: [3], heli: false, roadblocks: false });
  // A hedge tile with open ground north of it, a searcher there looking south.
  const open = (i: number) => i >= 0 && !h.grid[i] && !h.out.cover[i];
  let a = -1;
  for (let i = 6 * MAP_W; i < N && a < 0; i++) if (h.out.cover[i] && [1, 2, 3, 4, 5, 6].every((j) => open(i - j * MAP_W))) a = i;
  const ax = (a % MAP_W) - h.out.ox;
  const az = Math.floor(a / MAP_W) - h.out.oz;
  const m = h.state.searchers[3];
  // Shifting about in it (never still), the searcher held where he stands looking: seen close by, not further off.
  const watch = (tiles: number) => {
    m.mode = SEEK.BEAT;
    m.notice = 0;
    let seen = 0;
    for (let k = 0; k < 20; k++) {
      put(h, ax, az, 5);
      m.body.x = h.state.player.x;
      m.body.z = h.state.player.z - tiles * 1024;
      m.body.facing = 5;
      m.goal = -2;
      m.path = [];
      h.step(command(k % 2 ? 1 : 9));
      if (m.sees) seen++;
    }
    return seen;
  };
  const close = watch(HUNT.coverSeen - 1);
  const far = watch(HUNT.coverSeen + 2);
  check(close > 0 && far === 0 && !h.state.hidden, `cover, moving: seen ${close} steps of 20 from ${HUNT.coverSeen - 1} tiles, ${far} from ${HUNT.coverSeen + 2}`);
  // A chaser after them as they go in: caught in the hedge, still or not.
  const h2 = lab(CPO, CP, {}, { searchers: [3], heli: false, roadblocks: false });
  put(h2, ax, az, 5);
  steps(h2, HUNT.settle + 2);
  const c = h2.state.searchers[3];
  c.mode = SEEK.CHASE;
  c.last = h2.tile;
  c.body.x = h2.state.player.x;
  c.body.z = h2.state.player.z - 3 * 1024;
  const ev = steps(h2, 5 * 20);
  check(h2.state.hidden && h2.state.over === OVER.CAUGHT && ev.includes('caught'), 'cover: a chaser who saw them go in catches them in it, hidden or not');
  console.log(`cover, moving: seen from ${HUNT.coverSeen} tiles at most (${close} of 20 steps from ${HUNT.coverSeen - 1}, ${far} from ${HUNT.coverSeen + 2}); a chaser catches in it at ${HUNT.found} tiles`);
}

// A dog under whose nose the player stands in the open points; its handler gives chase (no capture on the spot).
{
  const h = lab(CPO, CP, {}, { searchers: [2], heli: false, roadblocks: false });
  // (On the county road, running west along it.)
  put(h, 30, 32);
  steps(h, 1);
  const m = h.state.searchers[2];
  const d = h.state.dogs[0];
  m.mode = SEEK.BEAT;
  m.body.x = h.state.player.x + 2 * 1024;
  m.body.z = h.state.player.z;
  d.body.x = h.state.player.x + 2 * 1024;
  d.body.z = h.state.player.z + 1024;
  let pointAt = -1;
  let chaseAt = -1;
  for (let k = 0; k < 5 * 20 && !h.state.over; k++) {
    h.step(command(9));
    for (const e of h.events) {
      if (e.type === 'point' && pointAt < 0) pointAt = h.state.step;
      if (e.type === 'spotted' && chaseAt < 0) chaseAt = h.state.step;
    }
  }
  const caughtAfter = h.state.over === OVER.CAUGHT ? h.state.overAt - pointAt : -1;
  check(pointAt > 0 && chaseAt >= pointAt && (caughtAfter < 0 || caughtAfter >= 10), `a dog in the open: it points, its handler chases (caught ${caughtAfter} steps after)`);
  console.log(`a dog in the open: points at ${pointAt}, its handler after them at ${chaseAt}; ${caughtAfter < 0 ? 'got away' : `caught ${(caughtAfter / 20).toFixed(1)} s later`}`);
}

// A ford: into the water, the trail is gone, and a dog tracking it loses it there (Stalag Flucht's river).
{
  const h = lab(SFO, SF, {}, { searchers: [2], heli: false, roadblocks: false });
  let ford = -1;
  for (let i = 0; i < N && ford < 0; i++) if (h.out.ford[i]) ford = i;
  const fx = (ford % MAP_W) - h.out.ox;
  const fz = Math.floor(ford / MAP_W) - h.out.oz;
  let south = fz;
  while (h.out.ford[(south + h.out.oz) * MAP_W + fx + h.out.ox]) south++;
  const T = (x: number, z: number) => (z + h.out.oz) * MAP_W + x + h.out.ox;
  // Just south of the river, a trail behind them twelve tiles long, the dog and its handler at its far end.
  put(h, fx, south + 3, 13);
  steps(h, 40);
  h.state.trail = Array.from({ length: 12 }, (_, k) => [T(fx, south + 15 - k), h.state.step - 12 + k] as [number, number]);
  const m = h.state.searchers[2];
  const d = h.state.dogs[0];
  m.mode = SEEK.BEAT;
  for (const b of [m.body, d.body]) {
    b.x = (fx + h.out.ox) * 1024 + 512;
    b.z = (south + 16 + h.out.oz) * 1024 + 512;
  }
  let tracked = false;
  let washed = false;
  let lostAt = -1;
  // North across the ford and on a few tiles.
  const pilot = new Autopilot(h.world, () => h.grid);
  pilot.goTo(T(fx, fz - 3));
  for (let k = 0; k < 40 * 20 && !h.state.over && pilot.active; k++) {
    h.step(command(pilot.dir(h.state.player)));
    if (d.mode === HOUND.TRACK) tracked = true;
    if (h.out.ford[h.tile] && !washed) washed = h.state.trail.length === 0;
    if (tracked && lostAt < 0 && d.mode === HOUND.HEEL) lostAt = h.state.step;
  }
  // Waiting across the river: the dog doesn't come.
  const ev = steps(h, 15 * 20);
  check(tracked && washed && lostAt > 0 && !ev.includes('point') && h.state.over === OVER.RUNNING, `a ford: the trail washed, the dog loses it (tracked ${tracked}, washed ${washed}, lost at ${lostAt}, over ${h.state.over})`);
  console.log(`ford: the trail gone in the water; the dog on it lost it at the river, ${ev.includes('point') ? 'found them' : 'never found them across it'}`);
}

// A roadblock waits for a player loitering by it, but only HUNT.blockWait; a washing line in a guard's uniform says it's a worse disguise.
{
  const h = new Hunt(CPO, CP, testCarry('center-perks', 'wall', { headStart: 0 }), { searchers: [], heli: false });
  const r = CPO.roadblocks[0];
  put(h, r.area[0] - 1, r.area[1]);
  let upAt = -1;
  for (let k = 0; k < 60 * 20 && upAt < 0; k++) {
    h.step(0);
    if (h.events.some((e) => e.type === 'roadblock' && e.k === 0)) upAt = h.state.step;
  }
  check(upAt > 0 && upAt <= (r.at + HUNT.jitter) * 20 + HUNT.blockWait + 1, `a roadblock loitered by: up at ${upAt}`);
  const u = lab(CPO, CP, { outfit: itemNumber('guard_outfit') });
  put(u, CPO.lines[0].x, CPO.lines[0].z, 1);
  u.step(command(0, OP.INTERACT));
  check(u.events.some((e) => e.type === 'swap' && e.uniform) && u.state.clothes === 2, "a guard's uniform: the line swaps it, and says it's a worse disguise");
  console.log(`roadblock: loitered by, up ${((upAt - r.at * 20) / 20).toFixed(1)} s after its time all the same; out of a guard's uniform at a line, told the eyes know you further off`);
}

// Lou's car: away in it when he's there; nothing there when he isn't.
{
  const h = lab(CPO, CP, { lou: true });
  put(h, CPO.lou.x, CPO.lou.z);
  steps(h, 1);
  const h2 = lab(CPO, CP, { lou: false });
  put(h2, CPO.lou.x, CPO.lou.z);
  steps(h2, 1);
  check(h.state.over === OVER.LOU && h2.state.over === OVER.RUNNING, "Lou's car: away in it, only when he waits");
  console.log("Lou's car: away in it when a call set it up; an empty track otherwise");
}

// The same hunt, the same commands: the same run.
{
  const a = new HuntBot(new Hunt(SFO, SF, testCarry('stalag-flucht', 'gate'))).run();
  const b = new HuntBot(new Hunt(SFO, SF, testCarry('stalag-flucht', 'gate'))).run();
  check(a.hash === b.hash && a.secs === b.secs, 'a hunt is deterministic');
  console.log(`deterministic: stalag-flucht gate twice, ${a.hash} both times`);
}

// The lesson: into the woods, a thicket while a searcher goes by, clothes off the line, Lou's car.
{
  const index = LESSONS.findIndex((l) => l.id === 'manhunt');
  const lesson = LESSONS[index];
  const spec = lesson.hunt!;
  const sim = new Sim(lesson.prison ?? CP, lesson.seed ?? 7 + index);
  lesson.setup(sim);
  const h = new Hunt(CPO, CP, { ...testCarry('center-perks', spec.kind, { headStart: spec.headStart, minute: spec.minute, lou: spec.lou }), salt: 41 }, { searchers: spec.searchers, heli: false, roadblocks: false });
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim, craftOpen: false, hunt: h };
  const pilot = new Autopilot(h.world, () => h.grid);
  const T = (x: number, z: number) => (z + h.out.oz) * 64 + x + h.out.ox;
  const go = (x: number, z: number, limit = 600) => {
    pilot.goTo(T(x, z));
    for (let k = 0; k < limit && pilot.active && !h.state.over; k++) {
      h.step(command(pilot.dir(h.state.player)));
      progress.update(ctx);
    }
  };
  const wait = (test: () => boolean, limit: number) => {
    for (let k = 0; k < limit && !test() && !h.state.over; k++) {
      h.step(0);
      progress.update(ctx);
    }
  };
  progress.update(ctx);
  go(18, 50);
  wait(() => progress.k >= 2, 40 * 20);
  go(25, 39);
  h.step(command(0, OP.INTERACT));
  progress.update(ctx);
  go(CPO.lou.x, CPO.lou.z);
  progress.update(ctx);
  check(progress.done && !progress.verdict(ctx), `the manhunt lesson: every step done (stuck at ${progress.k}: ${progress.step?.text}, over ${h.state.over})`);
  console.log(`lesson manhunt: ${lesson.steps.length} steps done in ${Math.round(h.state.step / 20)} s`);
}

// Review of v2.21.3: straight to Lou's car, the lesson's other steps skipped: tried again (it sat on its second step for ever).
{
  const index = LESSONS.findIndex((l) => l.id === 'manhunt');
  const lesson = LESSONS[index];
  const spec = lesson.hunt!;
  const sim = new Sim(lesson.prison ?? CP, lesson.seed ?? 7 + index);
  lesson.setup(sim);
  const h = new Hunt(CPO, CP, { ...testCarry('center-perks', spec.kind, { headStart: spec.headStart, minute: spec.minute, lou: spec.lou }), salt: 41 }, { searchers: spec.searchers, heli: false, roadblocks: false });
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim, craftOpen: false, hunt: h };
  const pilot = new Autopilot(h.world, () => h.grid);
  pilot.goTo(spotTile(CPO.lou, h.out.ox, h.out.oz));
  for (let k = 0; k < 20 * 120 && pilot.active && !h.state.over; k++) {
    h.step(command(pilot.dir(h.state.player)));
    progress.update(ctx);
  }
  // (The thicket step's floor arrows lead into cover; the line's to a line.)
  const hide = lesson.steps.find((s) => s.text === 'lesson.manhunt.hide')!;
  const cover = hide.huntGoal!(h)!;
  check(h.state.over === OVER.LOU && progress.verdict(ctx) === 'lesson.outEarly', `straight to Lou's car: the lesson is tried again (over ${h.state.over}, verdict ${progress.verdict(ctx)})`);
  check(Array.from({ length: N }, (_, i) => i).some((i) => h.out.cover[i] && cover(i)), 'the thicket step leads to cover');
  console.log(`lesson manhunt, straight to Lou: ${progress.verdict(ctx)}`);
}

// Review of v2.21.3: a crunch nobody hears tells the search nothing; clothes off a line fool them till the search has widened once more than a uniform does.
{
  const def = outsideOf('shankton')!;
  const pr = PRISONS.find((p) => p.id === 'shankton')!;
  const h = new Hunt(def, pr, testCarry('shankton', 'gate', { headStart: 0 }));
  // Far from every searcher, onto the rail yard's gravel.
  const far = (i: number) => h.state.searchers.every((m) => m.mode === SEEK.OFF || cheb(tileAt(m.body.x, m.body.z), i) > HUNT.crunch + 6);
  let at = -1;
  for (let i = 0; i < N && at < 0; i++) if (h.out.noisy[i] && !h.grid[i] && far(i) && !h.grid[i + 1] && !h.out.noisy[i + 1] && far(i + 1)) at = i + 1;
  check(at >= 0, 'a quiet tile beside gravel far from everyone');
  const p = h.state.player;
  p.x = (at % MAP_W) * 1024 + 512;
  p.z = Math.floor(at / MAP_W) * 1024 + 512;
  h.state.at = at;
  const known = h.state.known;
  for (let k = 0; k < 12; k++) h.step(command(9));
  check(h.state.known === known || h.state.searchers.some((m) => m.mode === SEEK.LOOK), `gravel heard by nobody: the search still doesn't know where they are (known ${h.state.known})`);
  h.state.clothes = 2;
  h.state.heat = HUNT.uniformHeat;
  check(h.knownAt === HUNT.disguised, 'clothes off a line still fool them when a uniform no longer does');
  h.state.heat = HUNT.uniformHeat + 1;
  check(h.knownAt === h.sight, 'a widening later, clothes off a line fool nobody either');
  console.log('gravel unheard tells nothing; line clothes known a widening after a uniform');
}

// Review of v2.21.3: cover with no open ground right beside it (Shankton's hedge along the map's edge) is swept too: a dog team casts about from the nearest place; keeping still there fails in the end.
{
  const def = outsideOf('shankton')!;
  const pr = PRISONS.find((p) => p.id === 'shankton')!;
  for (const salt of [1, 2]) {
    const h = new Hunt(def, pr, testCarry('shankton', 'wall', { headStart: 0, salt }));
    const at = spotTile({ x: 59, z: 44 }, h.out.ox, h.out.oz);
    check(h.out.cover[at] === 1, 'Shankton (59,44) is cover');
    const p = h.state.player;
    p.x = (at % MAP_W) * 1024 + 512;
    p.z = Math.floor(at / MAP_W) * 1024 + 512;
    h.state.at = at;
    h.state.trail = [];
    for (let k = 0; k < 20 * 1200 && !h.state.over; k++) h.step(0);
    check(h.state.over === OVER.CAUGHT, `hidden in Shankton's edge hedge (salt ${salt}): found in the end (over ${h.state.over})`);
    console.log(`Shankton's edge hedge, salt ${salt}: found after ${Math.round(h.state.overAt / 20)} s`);
  }
}
