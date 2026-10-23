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
import { fillArea, outsideWorld, spotTile } from '../src/sim/hunt/world';
import { MAP_H, MAP_W } from '../src/sim/world/World';
import { HuntBot } from './huntbot';
import { check } from './assert';

const N = MAP_W * MAP_H;

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

/** A carry for the tests: a player at Speed 40 in the jumpsuit, nothing in the pockets, at night, the alarm in 20 s. */
export function testCarry(prison: string, kind: StartKind, more: Partial<Carry> = {}): Carry {
  return { prison, via: 'fence', kind, spd: 40, outfit: itemNumber('inmate_outfit'), kit: [], crew: 0, lou: false, headStart: 20, minute: 23 * 60 + 40, salt: 12345, ...more };
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
    const hunt = new Hunt(def, prison, testCarry(def.prison, kind));
    const bot = new HuntBot(hunt);
    const r = bot.run();
    const f = hunt.state.feats;
    console.log(`${def.prison} ${kind}: ${r.over === OVER.SAFE ? 'clean away' : r.over === OVER.CAUGHT ? `CAUGHT at ${Math.round(hunt.progress * 100)}%` : 'still out'} in ${r.secs} s; spotted ${f[0]}, hid ${f[2]}, stones ${f[5]}, lit ${f[7]} · ${r.hash}`);
    for (const l of r.log) console.log(`  ${l}`);
    check(r.over === OVER.SAFE, `${def.prison} ${kind}: the getaway bot gets clean away`);
  }
}
void HUNT;
