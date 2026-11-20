import { DIR_X, DIR_Z } from '../../sim/command';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { BUILD, COMFORT, PIECE, PIECES, pieceOf, type PieceDef } from '../content/build';
import { cityItem, cityItemNumber } from '../content/items';
import { LIGHT_KIND } from '../content/light';
import { TRAP } from '../content/rush';
import { BAG, knowsManual, manualExists } from './gear';
import { growingOp, newGrowing } from './survival';
import { STEPS_PER_MINUTE } from '../../sim/tuning';
import { TUNNEL } from '../gen/tunnel';
import type { City, Stack } from './City';
import { noise } from './dead';
import { addLight, lightsHere, relight } from './light';

/**
 * Building a base (C5 batch 2, 2.67), a part of the city's simulation: pieces put up on the tile faced, a few seconds' hammering
 * with a hammer carried, heard; walls and barricades stop everyone, a built door the dead only, a chest holds things, a camp bed
 * is slept in, a workbench works as any, a campfire burns and cooks. Repaired a quarter at a time, taken down for half of what
 * they took. The dead after someone go round them when they can, and pound the one in their way when they can't. A sleeper's
 * comfort is what's built (and a light burning) round them. Kept by district in the save: [tile, kind, health, facing, more]
 * (more: a campfire's burning till, in steps).
 */

const N = MAP_W * MAP_H;
const HAMMER = cityItemNumber('hammer');
const PLANK = cityItemNumber('plank');
const CROSSBOW = cityItemNumber('crossbow');
const BOLT = cityItemNumber('bolt');

/** A piece as the save keeps it. */
export type Built = [tile: number, kind: number, hp: number, facing: number, more: number];

export const freshBuild = () => ({ built: {} as Record<string, Built[]> });

/** A save's pieces made sound before the city is built from it. */
export function soundBuild(st: { built?: unknown }) {
  const out: Record<string, Built[]> = {};
  if (typeof st.built === 'object' && st.built && !Array.isArray(st.built))
    for (const [d, list] of Object.entries(st.built as Record<string, unknown>)) {
      if (!/^[0-8]$/.test(d) || !Array.isArray(list)) continue;
      const seen = new Set<number>();
      out[d] = list.filter((p): p is Built => {
        if (!Array.isArray(p) || p.length !== 5 || !p.every(Number.isInteger)) return false;
        const [tile, kind, hp, facing, more] = p as number[];
        const def = pieceOf(kind);
        if (!def || tile < 0 || tile >= N || hp < 1 || hp > def.hp || facing < 0 || facing > 16 || more < 0 || seen.has(tile)) return false;
        seen.add(tile);
        return true;
      });
    }
  st.built = out;
}

/** The pieces of the district the player is in. */
export const builtHere = (c: City): Built[] => (c.state.built[c.state.district] ??= []);
/** The same, for the view: nothing written into the state. */
export const builtList = (c: City): readonly Built[] => c.state.built[c.state.district] ?? [];
export const pieceAtTile = (c: City, tile: number): Built | undefined => builtHere(c).find((p) => p[0] === tile);

/**
 * The world as the pieces stand: the solid ones stop everyone (and walls the dead's sight), doors only the dead. Called when a
 * district is entered and when a piece goes up or comes down. `c.pieceAt` gives each tile's piece (+1) for the dead and the view.
 */
export function applyBuilt(c: City) {
  c.pieceAt.fill(0);
  for (const [tile, kind] of c.state.built[c.state.district] ?? []) {
    const def = pieceOf(kind);
    if (!def) continue;
    c.pieceAt[tile] = kind + 1;
    // (A wall stops sight as well as bodies, as what stands in the streets does; a table, a chest, a barricade only bodies.)
    if (def.solid && def.veil) c.world.parked[tile] = 1;
    else if (def.solid) c.world.propSolid[tile] = 1;
  }
}

/** The tile a piece would go on: the one faced, square on (a slant faces the tile along its larger part). */
export function buildSpot(c: City): number {
  const p = c.state.player;
  const here = c.tile;
  const dx = DIR_X[p.facing] ?? 0;
  const dz = DIR_Z[p.facing] ?? 0;
  if (!dx && !dz) return -1;
  const t = Math.abs(dx) >= Math.abs(dz) ? here + Math.sign(dx) : here + Math.sign(dz) * MAP_W;
  if (t < 0 || t >= N || Math.abs((t % MAP_W) - (here % MAP_W)) > 1) return -1;
  return t;
}

export type BuildWhy = 'ok' | 'hammer' | 'parts' | 'most' | 'here' | 'blocked' | 'gate' | 'people' | 'story' | 'unknown';
/** 2.70: a piece from a manual not read (in a city begun from then). */
const unknownPiece = (c: City, def: PieceDef) => def.manual !== undefined && !knowsManual(c, def.manual);

const cheb = (a: number, b: number) =>
  Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

/** Whether a piece can go up on a tile now, or why not (the order is what the button says first). */
export function canBuild(c: City, kind: number, tile: number): BuildWhy {
  const def = pieceOf(kind);
  if (!def) return 'parts';
  if (unknownPiece(c, def)) return 'unknown';
  if (!c.count(HAMMER)) return 'hammer';
  if (lacking(c, def.from).length) return 'parts';
  const s = c.state;
  if (s.district === TUNNEL || tile < 0) return 'here';
  if ((s.built[s.district] ?? []).length >= BUILD.most) return 'most';
  // (On open floor, pavement or street only: not where anything stands, nor a doorway, nor where something lies or someone is.)
  const ch = c.district.rows[Math.floor(tile / MAP_W)][tile % MAP_W];
  if (c.grid[tile] || c.pieceAt[tile] || c.carAt[tile] || c.zedGrid[tile] || ch === 'y' || ch === '~' || ch === '=') return 'blocked';
  if (tile === c.tile || c.state.boxes[`${s.district}:g${tile}`]?.some((st) => st[0])) return 'blocked';
  // (Nor on furniture that's walked over (a chair: break it first), nor where a Survivor wakes, nor where the district puts them.)
  if (c.breakAt[tile] || (s.home[0] === s.district && s.home[1] === tile)) return 'blocked';
  if (c.district.spawn.z * MAP_W + c.district.spawn.x === tile) return 'blocked';
  if (
    s.zeds.some(
      (z) => Math.abs(z.body.x - (tile % MAP_W) * 1024 - 512) < 700 && Math.abs(z.body.z - Math.floor(tile / MAP_W) * 1024 - 512) < 700,
    )
  )
    return 'blocked';
  if (c.district.gates.some((g) => g.tiles.some((t) => cheb(t, tile) <= BUILD.gateClear))) return 'gate';
  if (c.people.some((p) => cheb(p.tile, tile) <= 1)) return 'people';
  const P = c.story;
  for (let w = 0; w < P.exits.length; w++) if (P.wayDistrict[w] === s.district && cheb(P.exits[w], tile) <= 1) return 'story';
  if (P.pier >= 0 && P.wayDistrict[1] === s.district && cheb(P.pier, tile) <= 1) return 'story';
  return 'ok';
}

/** What of a list isn't in the pockets: [item id, how many short]. */
export function lacking(c: City, from: ReadonlyArray<readonly [string, number]>): Array<[string, number]> {
  return from.map(([id, n]) => [id, n - c.count(cityItemNumber(id))] as [string, number]).filter(([, n]) => n > 0);
}

/** A repair's cost: half of what the piece took, for the share of its health gone (rounded up): never dearer than building it again. */
export const repairCost = (def: PieceDef, hp: number): Array<[string, number]> =>
  def.from
    // (2.68, the review: a sentry's crossbow is in it still: a repair takes only the scrap and wire.)
    .map(([id, n]) => [id, id === 'crossbow' || id === def.keeps ? 0 : Math.ceil((n * (def.hp - hp)) / def.hp / 2)] as [string, number])
    .filter(([, n]) => n > 0);

/** The work a press begins: a piece put up (kind on the tile faced), repaired, taken down. Refused, and said. */
export function startBuild(c: City, kind: number) {
  const tile = buildSpot(c);
  const why = canBuild(c, kind, tile);
  if (why !== 'ok') return void c.events.push({ type: 'cantBuild', why });
  begin(c, `h${kind}:${tile}`, BUILD.steps);
}
export function startPiece(c: City, what: number) {
  const s = c.state;
  const tile = s.open.startsWith('p') ? Number(s.open.slice(1)) : -1;
  const p = pieceAtTile(c, tile);
  if (!p) return;
  const def = pieceOf(p[1])!;
  if (what === 0) {
    if (p[2] >= def.hp) return;
    if (!c.count(HAMMER)) return void c.events.push({ type: 'cantBuild', why: 'hammer' });
    if (lacking(c, repairCost(def, p[2])).length) return void c.events.push({ type: 'cantBuild', why: 'parts' });
    return begin(c, `r${tile}`, BUILD.repairSteps);
  }
  if (what === 1) return begin(c, `t${tile}`, BUILD.downSteps);
  if (what === 2) return feed(c, p);
  // (2.70: a planter's seeds, its watering, its harvest; a barrel's drink, a bottle filled at it.)
  if (what >= 3) return growingOp(c, p, what);
}
function begin(c: City, key: string, steps: number) {
  const s = c.state;
  if (s.search === key) return;
  c.close();
  s.search = key;
  s.searchLeft = steps;
  noise(c, c.tile, BUILD.noise);
  c.events.push({ type: 'building', key });
}

/** The tile a key of building work is at. */
export const workTile = (key: string) => Number(key.startsWith('h') ? key.slice(key.indexOf(':') + 1) : key.slice(1));

/** Whether the player still stands at the work (beside its tile). */
export function atBuild(c: City, key: string): boolean {
  const t = workTile(key);
  const here = c.tile;
  return Math.abs((t % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) === 1;
}

/** The work done (s.search has been cleared). */
export function finishBuild(c: City, key: string) {
  const s = c.state;
  const tile = workTile(key);
  if (key.startsWith('h')) {
    const kind = Number(key.slice(1, key.indexOf(':')));
    // (Looked at again: something may have come onto the tile meanwhile.)
    const why = canBuild(c, kind, tile);
    if (why !== 'ok') return void c.events.push({ type: 'cantBuild', why });
    const def = pieceOf(kind)!;
    // (2.68: a sentry keeps its crossbow's blows, for when it's taken down: the most worn one goes, as `spend` takes it.)
    // (The review: the pockets and the bag alike, as `spend` takes it.)
    const bows = [...s.inv, ...(s.bag ? (s.boxes[BAG] ?? []) : [])].filter((st) => st[0] === CROSSBOW).map((st) => st[1]);
    const blows = def.trap === 'sentry' && bows.length ? Math.min(...bows) : 0;
    for (const [id, n] of def.from) c.spend(cityItemNumber(id), n);
    builtHere(c).push([tile, kind, def.hp, s.player.facing, blows * BUILD.sentryWear]);
    changed(c);
    if (kind === PIECE.campfire) addLight(c, tile, LIGHT_KIND.CAMP, BUILD.fireMinutes);
    newGrowing(c, builtHere(c)[builtHere(c).length - 1]);
    c.events.push({ type: 'built', kind, tile });
    return;
  }
  const p = pieceAtTile(c, tile);
  if (!p) return;
  const def = pieceOf(p[1])!;
  if (key.startsWith('r')) {
    const cost = repairCost(def, p[2]);
    if (lacking(c, cost).length) return void c.events.push({ type: 'cantBuild', why: 'parts' });
    for (const [id, n] of cost) c.spend(cityItemNumber(id), n);
    p[2] = def.hp;
    c.piecesRev++;
    return void c.events.push({ type: 'repaired', kind: p[1], tile });
  }
  // Taken down: half of what it took, less for the damage; a chest's things on the ground; a campfire out.
  // (2.68: a sentry's crossbow comes back whole, with the blows it had, and its bolts.)
  const back: Stack[] = def.from
    .map(([id, n]) => [cityItemNumber(id), id === 'crossbow' ? 0 : id === def.keeps ? n : Math.floor((n * p[2]) / def.hp / 2)] as Stack)
    .filter(([, n]) => n > 0);
  const sentry = def.trap === 'sentry';
  const bolts = sentry ? p[4] % BUILD.sentryWear : 0;
  p[4] -= bolts;
  removePiece(c, p, true);
  for (const [item, n] of back) c.hand(item, n);
  if (sentry) c.handWorn(CROSSBOW, Math.max(1, Math.floor(p[4] / BUILD.sentryWear)));
  if (bolts) c.hand(BOLT, bolts);
  c.events.push({ type: 'unbuilt', kind: p[1], tile });
}

/** A piece gone (taken down, or broken by the dead): what it held on the ground, its light out, the world without it. */
export function removePiece(c: City, p: Built, takenDown = false) {
  const s = c.state;
  const list = builtHere(c);
  list.splice(list.indexOf(p), 1);
  const key = `p${p[0]}`;
  const held = c.state.boxes[`${s.district}:${key}`] ?? [];
  c.forgetBox(key);
  for (const [item, n] of held) if (item) c.drop(p[0], item, n);
  if (p[1] === PIECE.campfire) {
    s.lights[s.district] = lightsHere(c).filter((l) => !(l[0] === p[0] && l[1] === LIGHT_KIND.CAMP));
    relight(c);
  }
  // (2.68: a sentry broken by the dead: its bolts on the ground. Taken down, they were handed back first.)
  if (pieceOf(p[1])?.trap === 'sentry' && p[4] % BUILD.sentryWear) c.drop(p[0], BOLT, p[4] % BUILD.sentryWear);
  // (2.69, the review: a workshop broken by the dead or the nights: its toolkit on the ground, whole.)
  const keeps = pieceOf(p[1])?.keeps;
  if (keeps && !takenDown) c.drop(p[0], cityItemNumber(keeps), 1);
  if (pieceOf(p[1])!.solid) c.world.parked[p[0]] = c.world.propSolid[p[0]] = 0;
  changed(c);
}

/** The world and the dead's ways after a piece went up or came down. */
function changed(c: City) {
  applyBuilt(c);
  c.world.refreshBlock();
  c.rebar();
  c.piecesRev++;
}

/** A plank fed to a campfire: it burns longer, or is lit again. 2.68: a sentry loaded with the bolts carried, to its most. */
function feed(c: City, p: Built) {
  if (pieceOf(p[1])?.trap === 'sentry') {
    const room = TRAP.sentryMost - (p[4] % BUILD.sentryWear);
    const n = Math.min(room, c.count(BOLT));
    if (!c.count(BOLT)) return void c.events.push({ type: 'cantBuild', why: 'parts' });
    if (n <= 0) return void c.events.push({ type: 'refused', why: 'alreadyLit' });
    c.spend(BOLT, n);
    p[4] += n;
    return void c.events.push({ type: 'fed', tile: p[0] });
  }
  if (p[1] !== PIECE.campfire) return;
  if (!c.count(PLANK)) return void c.events.push({ type: 'cantBuild', why: 'parts' });
  const s = c.state;
  const lit = lightsHere(c).find((l) => l[0] === p[0] && l[1] === LIGHT_KIND.CAMP && l[2] > s.step);
  const left = lit ? (lit[2] - s.step) / STEPS_PER_MINUTE : 0;
  if (left >= BUILD.fireMost - BUILD.feedMinutes) return void c.events.push({ type: 'refused', why: 'alreadyLit' });
  c.spend(PLANK, 1);
  if (lit) lit[2] += BUILD.feedMinutes * STEPS_PER_MINUTE;
  else addLight(c, p[0], LIGHT_KIND.CAMP, BUILD.feedMinutes);
  c.events.push({ type: 'fed', tile: p[0] });
}

/** One of the dead pounding a piece in its way: a blow now and then, the piece down at none. */
export function poundPiece(c: City, tile: number, brute: boolean, beat: number) {
  const p = pieceAtTile(c, tile);
  if (!p) return;
  if (beat % BUILD.poundEvery !== 0) return;
  const was = wornStep(p);
  p[2] -= brute ? BUILD.bruteHarm : 1;
  // (Drawn again only when it looks more worn: four steps of wear, not a blow at a time.)
  if (wornStep(p) !== was) c.piecesRev++;
  if (beat % (BUILD.poundEvery * 3) === 0) {
    c.events.push({ type: 'pound', tile });
    if (c.state.sleeping) c.wakeNow('pounding');
  }
  if (p[2] > 0) return;
  removePiece(c, p);
  c.events.push({ type: 'pieceDown', kind: p[1], tile });
}

/** How worn a piece looks: 0 whole, then 1, 2, 3 at each quarter of its health gone (the view's steps). */
export const wornStep = (p: Built): number => Math.min(3, Math.floor((1 - p[2] / (pieceOf(p[1])?.hp ?? p[2])) * 4));

/** The comfort round a tile: what's built within reach (a campfire only while it burns) and a light burning; its level, 0–2. */
export function comfortAt(c: City, tile: number): { points: number; level: number } {
  let points = 0;
  const s = c.state;
  const burning = (t: number) => lightsHere(c).some((l) => l[0] === t && l[2] > s.step);
  for (const [t, kind] of c.state.built[s.district] ?? []) {
    if (cheb(t, tile) > BUILD.comfortReach) continue;
    if (kind === PIECE.campfire && !burning(t)) continue;
    points += pieceOf(kind)?.comfort ?? 0;
  }
  if (lightsHere(c).some((l) => l[1] !== LIGHT_KIND.CAMP && l[2] > s.step && cheb(l[0], tile) <= BUILD.comfortReach)) points++;
  return { points, level: points >= BUILD.home ? 2 : points >= BUILD.hideout ? 1 : 0 };
}
export const comfortRates = (level: number) => COMFORT[level] ?? COMFORT[0];

/** A built workbench beside a tile (2.69: or a workshop, which is one). */
export const benchBeside = (c: City, tile: number) =>
  [tile - MAP_W, tile + 1, tile + MAP_W, tile - 1].some(
    (t) => t >= 0 && t < N && (c.pieceAt[t] === PIECE.workbench + 1 || c.pieceAt[t] === PIECE.workshop + 1),
  );
/** 2.69: a workshop built beside a tile. */
export const shopBeside = (c: City, tile: number) =>
  [tile - MAP_W, tile + 1, tile + MAP_W, tile - 1].some((t) => t >= 0 && t < N && c.pieceAt[t] === PIECE.workshop + 1);

/** A built camp bed's tile, if it is the open box (its card's Sleep). */
export const openCot = (c: City): number => {
  const s = c.state;
  if (!s.open.startsWith('p')) return -1;
  const t = Number(s.open.slice(1));
  return c.pieceAt[t] === PIECE.cot + 1 && atBuild(c, s.open) ? t : -1;
};

/** The slots a box of this key has (a built chest's; other pieces none). */
export const pieceSlots = (c: City, key: string): number => (c.pieceAt[Number(key.slice(1))] === PIECE.chest + 1 ? BUILD.chestSlots : 0);

/** The pieces the Build panel lists, with what each lacks now ('ok'). */
export const buildList = (c: City): Array<'ok' | 'hammer' | 'parts' | 'unknown' | 'none'> =>
  PIECES.map((def) =>
    def.manual !== undefined && !manualExists(c, def.manual)
      ? 'none'
      : unknownPiece(c, def)
        ? 'unknown'
        : !c.count(HAMMER)
          ? 'hammer'
          : lacking(c, def.from).length
            ? 'parts'
            : 'ok',
  );

/** What a piece's name is in the text tables. */
export const pieceName = (kind: number) => `city.piece.${PIECES[kind]?.id ?? 'barricade'}`;
export { PIECES, cityItem };
