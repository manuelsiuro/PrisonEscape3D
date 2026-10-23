/**
 * The manhunt's balance (P41): the gauge. A plain careful getaway bot that knows only what is
 * within 12 tiles of it (what a screen shows: scripts/huntbot.ts, plain, with a view: the rules
 * review's limited bot) plays every start of every prison, by night and by day, with the head
 * start and seen going, in the jumpsuit and in a guard's uniform, over a few salts; the table is
 * how often it's caught and how long a getaway takes. The expert bot that knows everything gets
 * clean away from every start, by night and by day, head start or seen going, in the jumpsuit and
 * in the uniform (with one of the salts: the proof each has a careful line). Nobody ever
 * comes on within HUNT.clear tiles of the player or in their sight. Keeping still in the cover
 * nearest safety fails in the end (the search widens), and so does standing about in the open.
 */
import { HUNT } from '../src/content/manhunt';
import { itemNumber } from '../src/content/items';
import { OUTSIDES } from '../src/content/outside';
import { START_KINDS, type StartKind } from '../src/content/outside/types';
import { PRISONS } from '../src/content/prisons';
import { lineOfSight } from '../src/sim/ai/sight';
import { Hunt, OVER, type Carry } from '../src/sim/hunt/Hunt';
import { UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { HuntBot } from './huntbot';

const VIEW = 12;
const SALTS = [1, 2, 3];
/** The expert tries these in turn (the proof needs one run's draws where a careful line gets through). */
const EXPERT_SALTS = [1, 2, 3, 4, 5, 6];
const CONDS = [
  ['night', 'head start', 23 * 60 + 40, HUNT.headStartMax],
  ['night', 'seen going', 23 * 60 + 40, 0],
  ['day', 'head start', 14 * 60, HUNT.headStartMax],
  ['day', 'seen going', 14 * 60, 0],
] as const;
const OUTFITS = [
  ['jumpsuit', 'inmate_outfit'],
  ['uniform', 'guard_outfit'],
] as const;

const carry = (prison: string, kind: StartKind, more: Partial<Carry>): Carry => ({ prison, via: 'fence', kind, spd: 40, outfit: itemNumber('inmate_outfit'), kit: [], crew: 0, lou: false, headStart: HUNT.headStartMax, minute: 23 * 60 + 40, salt: 1, ...more });
const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

let caught = 0;
let runs = 0;
let fullFails = 0;
let expertMisses = 0;
const expertNotes: string[] = [];
let badSpawns = 0;
const safeSecs: number[] = [];
const byCond = new Map<string, [number, number]>();
const lines: string[] = [];
for (const def of OUTSIDES) {
  const prison = PRISONS.find((p) => p.id === def.prison)!;
  for (const kind of START_KINDS) {
    if (!def.starts[kind]) continue;
    let c = 0;
    let n = 0;
    const secs: number[] = [];
    const cells: string[] = [];
    for (const [light, how, minute, headStart] of CONDS)
      for (const [dress, outfit] of OUTFITS) {
        let cc = 0;
        for (const salt of SALTS) {
          const h = new Hunt(def, prison, carry(def.prison, kind, { minute, headStart, salt, outfit: itemNumber(outfit) }));
          const bot = new HuntBot(h, VIEW, true);
          for (let k = 0; k < 20 * 60 * 5 && !h.state.over; k++) {
            h.step(bot.next());
            // Nobody comes on where the player would see it happen.
            for (const e of h.events) {
              if (e.type !== 'out') continue;
              const m = h.state.searchers[e.who].body;
              const p = h.state.player;
              const d = Math.hypot(m.x - p.x, m.z - p.z) / UNIT;
              if (d <= HUNT.clear - 0.5 || (d < h.sight && lineOfSight(h.world, m.x, m.z, p.x, p.z))) {
                badSpawns++;
                check(false, `${def.prison} ${kind}: searcher ${e.who} came on ${d.toFixed(1)} tiles from the player`);
              }
            }
          }
          n++;
          if (h.state.over === OVER.CAUGHT) c++, cc++;
          else if (h.state.over !== OVER.RUNNING) secs.push(Math.round(h.state.step / 20));
          const key = `${light}, ${how}, ${dress}`;
          const b = byCond.get(key) ?? [0, 0];
          byCond.set(key, [b[0] + (h.state.over === OVER.CAUGHT ? 1 : 0), b[1] + 1]);
        }
        cells.push(String(cc));
        // The expert bot that knows everything: clean away (with the first salt, else another).
        let away = 0;
        for (const salt of EXPERT_SALTS) {
          const full = new HuntBot(new Hunt(def, prison, carry(def.prison, kind, { minute, headStart, salt, outfit: itemNumber(outfit) }))).run();
          if (full.over === OVER.SAFE) {
            away = salt;
            break;
          }
          expertMisses++;
        }
        if (away !== EXPERT_SALTS[0]) expertNotes.push(`${def.prison} ${kind} ${light} ${how} ${dress}: ${away ? `away with salt ${away}` : 'NOT AWAY'}`);
        if (!away) fullFails++;
        check(away > 0, `${def.prison} ${kind} ${light} ${how} ${dress}: the expert bot gets clean away (with one of the salts)`);
      }
    caught += c;
    runs += n;
    safeSecs.push(...secs);
    lines.push(`${`${def.prison} ${kind}`.padEnd(21)} caught ${String(c).padStart(2)}/${n} ${`${Math.round((100 * c) / n)}%`.padStart(4)} [${cells.join(' ')}]  away in ${avg(secs)} s (${secs.length ? `${Math.min(...secs)}–${Math.max(...secs)}` : '-'})`);
  }
}
console.log(`the careful bot (${VIEW}-tile view), ${SALTS.length} salts; caught per start, then by night/day × head start/seen going × jumpsuit/uniform:`);
for (const l of lines) console.log(`  ${l}`);
console.log(`all: caught ${caught}/${runs} (${Math.round((100 * caught) / runs)}%), away in ${avg(safeSecs)} s on average (${Math.min(...safeSecs)}–${Math.max(...safeSecs)}); nobody came on in sight (${badSpawns} did)`);
console.log(`the expert bot (it sees everything): away from ${runs / SALTS.length - fullFails}/${runs / SALTS.length}, ${expertNotes.length} of them not with the first salt:`);
for (const l of expertNotes) console.log(`  ${l}`);
console.log(`by condition: ${[...byCond].map(([k, [a, b]]) => `${k} ${Math.round((100 * a) / b)}%`).join('; ')}`);
check(caught / runs >= 0.15 && caught / runs <= 0.45, `the careful bot caught ${caught}/${runs}: about 20–40%`);

// Keeping still: in the cover nearest safety (no trail, the alarm up), and in the open where they came out. The search finds them in the end.
for (const def of OUTSIDES) {
  const prison = PRISONS.find((p) => p.id === def.prison)!;
  const kind = START_KINDS.find((k) => def.starts[k])!;
  const out: string[] = [];
  for (const [light, minute] of [['day', 14 * 60], ['night', 23 * 60 + 40]] as const) {
    const h = new Hunt(def, prison, carry(def.prison, kind, { headStart: 0, minute }));
    let best = -1;
    for (let i = 0; i < MAP_W * MAP_W; i++) if (h.out.cover[i] && h.toGoal[i] >= 0 && (best < 0 || h.toGoal[i] < h.toGoal[best])) best = i;
    const p = h.state.player;
    p.x = (best % MAP_W) * UNIT + UNIT / 2;
    p.z = Math.floor(best / MAP_W) * UNIT + UNIT / 2;
    h.state.at = best;
    for (let k = 0; k < 20 * 600 && !h.state.over; k++) h.step(0);
    check(h.state.over === OVER.CAUGHT, `${def.prison} ${light}: still in the cover nearest safety, caught in the end`);
    const camp = h.state.over === OVER.CAUGHT ? `${Math.round(h.state.overAt / 20)} s` : 'never';
    const o = new Hunt(def, prison, carry(def.prison, kind, { minute }));
    for (let k = 0; k < 20 * 600 && !o.state.over; k++) o.step(0);
    check(o.state.over === OVER.CAUGHT, `${def.prison} ${light}: standing in the open where they came out, caught in the end`);
    // (And in a guard's uniform: it fools them only so long.)
    const u = new Hunt(def, prison, carry(def.prison, kind, { minute, outfit: itemNumber('guard_outfit') }));
    for (let k = 0; k < 20 * 600 && !u.state.over; k++) u.step(0);
    check(u.state.over === OVER.CAUGHT && u.state.overAt <= 20 * 240, `${def.prison} ${light}: standing in the open in a guard's uniform, caught within 4 minutes`);
    const when = (x: Hunt) => (x.state.over === OVER.CAUGHT ? `${Math.round(x.state.overAt / 20)} s` : 'never');
    out.push(`${light}: in cover ${h.toGoal[best]} tiles from safety caught at ${camp}, in the open at the start ${when(o)} (in a guard's uniform ${when(u)})`);
  }
  console.log(`keeping still, ${def.prison}: ${out.join('; ')}`);
}
