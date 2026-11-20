/**
 * City Escape's crafting that grows (2.69, C5 batch 4, city/sim/gear.ts): manuals read by real commands (their recipes learnt; a
 * city begun before knows them), every new recipe made where it wants (by hand, a bench, a workshop built with its toolkit), a worn
 * weapon and armour mended at a bench; armour against bites (worn out by them), a poncho seen a tile less, scrap armour's weight; a
 * bag worn, opened, filled, its things counting for making, kept on a fall while its things fall; the slingshot and the steel
 * crossbow shooting; a smoke bomb's cloud, a noisemaker's ring, a flare's light; the manuals and the toolkit in the loot of a city
 * begun from 2.69; the Rush's supplies with a manual; a save keeping it all, a damaged one made sound.
 */
import { check } from './assert';
import { PIECE } from '../src/city/content/build';
import { cityItem, cityItemNumber, CITY_ITEMS } from '../src/city/content/items';
import { CITY_RECIPES } from '../src/city/content/recipes';
import { GEAR } from '../src/city/content/gear';
import { LIGHT_KIND } from '../src/city/content/light';
import { ZKIND } from '../src/city/content/dead';
import { canBuild } from '../src/city/sim/build';
import { BAG } from '../src/city/sim/gear';
import { removePiece } from '../src/city/sim/build';
import { en } from '../src/i18n/en';
import { City, COP, FULL, GEAR_OPS, loadCity, PIECE_OPS, REPAIR_OPS, START_MINUTE, type CityEvent } from '../src/city/sim/City';
import { ZED, type Zed } from '../src/city/sim/dead';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { bodyAt } from '../src/sim/systems/movement';
import { STEPS_PER_MINUTE } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/grid';

const lines: string[] = [];
const say = (s: string) => lines.push(s);
const W = MAP_W;
const N = W * W;
const I = cityItemNumber;
const priv = (c: City) => c as unknown as { enter(d: number): void; stock(p: number): Array<[number, number]> };
const city = (seed: number) => {
  const c = new City(seed);
  c.peace = true;
  c.step(0);
  return c;
};
const at = (c: City, day: number, minute: number) => {
  c.state.step = ((day - 1) * 1440 + minute - START_MINUTE) * STEPS_PER_MINUTE - 1;
};
const run = (c: City, steps: number, cmd = 0): CityEvent[] => {
  const out: CityEvent[] = [];
  for (let k = 0; k < steps && !c.state.over; k++) {
    c.state.hunger = FULL;
    c.state.energy = FULL;
    if (c.state.health < 50) c.state.health = 100;
    c.step(k === 0 ? cmd : 0);
    out.push(...c.events);
  }
  return out;
};
const stand = (c: City, tile: number, toward = tile + 1) => {
  c.state.zeds = [];
  c.state.player = bodyAt(
    tile % W,
    Math.floor(tile / W),
    nearestDir((toward % W) - (tile % W), Math.floor(toward / W) - Math.floor(tile / W)),
  );
  c.step(0);
};
/** The pockets emptied, then these put in (wear things with their full blows). */
const pockets = (c: City, list: Array<[string, number?]>) => {
  c.state.inv = c.state.inv.map(() => [0, 0]);
  list.forEach(([id, n], k) => (c.state.inv[k] = [I(id), n ?? cityItem(I(id))!.wear ?? 1]));
};
const slotOf = (c: City, id: string) => c.state.inv.findIndex((st) => st[0] === I(id));
const zed = (c: City, tile: number, mode: number = ZED.IDLE, kind?: number): Zed => {
  const z: Zed = {
    body: bodyAt(tile % W, Math.floor(tile / W)),
    hp: kind === ZKIND.RUNNER ? 22 : 30,
    mode,
    goal: -1,
    path: [],
    seen: c.state.step,
    last: c.tile,
    bit: -9999,
    reel: 0,
    near: 0,
    pace: 1000,
    ...(kind !== undefined ? { kind } : {}),
  };
  c.state.zeds.push(z);
  return z;
};
/** A 5 × 5 open square, every tile buildable (-1: none). */
function openSquare(c: City): number {
  pockets(c, [['hammer'], ['plank', 4], ['nails', 4]]);
  for (let z = 6; z < W - 6; z++)
    for (let x = 6; x < W - 6; x++) {
      const mid = z * W + x;
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++)
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const t = mid + dz * W + dx;
          ok = (!c.grid[t] && !c.carAt[t] && canBuild(c, PIECE.barricade, t) === 'ok') || t === c.tile;
        }
      if (ok) return mid;
    }
  return -1;
}
// (2.69's three manuals; 2.70's are cityneedstest's.)
const NEW = CITY_RECIPES.map((r, k) => [r, k] as const).filter(([r]) => r.manual !== undefined && r.manual < 3);

// ------------------------------------------------------------------ manuals
{
  const c = city(1);
  const unknown = NEW.filter(([, k]) => c.canMake(k) === 'unknown').length;
  check(unknown === NEW.length && NEW.length === 13, `a new city: the manuals' ${NEW.length} recipes unknown (${unknown})`);
  const old = city(1);
  old.state.rev = 4;
  const oldUnknown = NEW.filter(([, k]) => old.canMake(k) === 'unknown').length;
  check(oldUnknown === 0, `a city begun before 2.69 knows them (${oldUnknown} unknown)`);
  const read: string[] = [];
  for (const id of ['manual_weapons', 'manual_sewing', 'manual_tricks']) {
    pockets(c, [[id]]);
    const evs = run(c, 1, command(0, COP.USE, 0));
    const e = evs.find((x) => x.type === 'learnt') as Extract<CityEvent, { type: 'learnt' }> | undefined;
    check(!!e && !c.state.inv[0][0], `${id} read and put away (${JSON.stringify(e)})`);
    read.push(`${id} ${e?.n}`);
  }
  check(
    NEW.every(([, k]) => c.canMake(k) !== 'unknown'),
    'all learnt',
  );
  pockets(c, [['manual_tricks']]);
  const again = run(c, 1, command(0, COP.USE, 0)).some((e) => e.type === 'refused' && e.why === 'known');
  check(again && c.state.inv[0][0] === I('manual_tricks'), 'a manual read twice: "you know it", kept');
  say(`13 recipes from manuals, unknown in a new city, known in one begun before; read: ${read.join(', ')} recipes`);
}

// ------------------------------------------------------------------ every new recipe, where it wants
{
  const c = city(2);
  c.state.manuals = 7;
  const mid = openSquare(c);
  check(mid >= 0, 'an open square');
  // A workshop built (the toolkit in it), a workbench beside it.
  pockets(c, [['hammer'], ['toolkit'], ['plank', 4], ['scrap', 4], ['nails', 4]]);
  stand(c, mid, mid + 1);
  c.step(command(0, COP.BUILD, PIECE.workshop));
  run(c, 70);
  check(
    c.pieceAt[mid + 1] === PIECE.workshop + 1 && c.count(I('toolkit')) === 0,
    `a workshop built with the toolkit (${c.pieceAt[mid + 1]})`,
  );
  const made: string[] = [];
  const refused: string[] = [];
  for (const [r, k] of NEW) {
    // (Away from the bench first: what wants one says so.)
    stand(c, mid - 2 * W, mid - 3 * W);
    pockets(c, [...r.from.map(([id, n]) => [id, cityItem(I(id))!.wear ?? n] as [string, number])]);
    const why = c.canMake(k);
    if (r.bench || r.shop) refused.push(`${r.makes}: ${why}`);
    check(why === (r.bench ? 'bench' : 'ok'), `${r.makes} away from a bench: ${why}`);
    stand(c, mid, mid + 1);
    const evs = run(c, 1, command(0, COP.MAKE, k));
    const ok = evs.some((e) => e.type === 'made' && e.item === I(r.makes));
    check(ok && c.count(I(r.makes)) >= 1, `${r.makes} made beside the workshop`);
    made.push(r.makes);
  }
  // A workshop's recipe beside a plain workbench: "a workshop".
  const plain = city(3);
  plain.state.manuals = 7;
  const m2 = openSquare(plain);
  pockets(plain, [['hammer'], ['plank', 8], ['nails', 4], ['scrap', 4]]);
  stand(plain, m2, m2 + 1);
  plain.step(command(0, COP.BUILD, PIECE.workbench));
  run(plain, 70);
  const shopK = NEW.find(([r]) => r.makes === 'scrap_armour')![1];
  pockets(plain, [
    ['scrap', 5],
    ['wire', 2],
    ['cloth', 2],
  ]);
  check(plain.canMake(shopK) === 'shop', `scrap armour beside a plain workbench: ${plain.canMake(shopK)}`);
  // Taken down, the workshop gives its toolkit back whole.
  pockets(c, [['hammer']]);
  stand(c, mid, mid + 1);
  c.step(command(0, COP.ACT, 0));
  c.step(command(0, COP.BUILD, PIECE_OPS + 1));
  run(c, 40);
  check(c.count(I('toolkit')) === 1, `the workshop taken down: its toolkit back (${c.count(I('toolkit'))})`);
  say(
    `made by real commands: ${made.join(', ')}; away from the bench: ${refused.join(', ')}; beside a plain workbench, scrap armour wants a workshop; taken down, the toolkit back`,
  );
}

// ------------------------------------------------------------------ repair
{
  const c = city(4);
  const mid = openSquare(c);
  pockets(c, [['hammer'], ['plank', 4], ['nails', 4], ['scrap', 2]]);
  stand(c, mid, mid + 1);
  c.step(command(0, COP.BUILD, PIECE.workbench));
  run(c, 70);
  check(c.pieceAt[mid + 1] === PIECE.workbench + 1, 'a workbench built');
  pockets(c, [
    ['bat', 6],
    ['padded_jacket', 4],
    ['tape', 4],
    ['scrap', 2],
    ['cloth', 4],
  ]);
  stand(c, mid - 2 * W, mid);
  const far = run(c, 1, command(0, COP.MAKE, REPAIR_OPS + 0)).find((e) => e.type === 'cantMake');
  stand(c, mid, mid + 1);
  run(c, 1, command(0, COP.MAKE, REPAIR_OPS + 0));
  run(c, 1, command(0, COP.MAKE, REPAIR_OPS + 1));
  const bat = c.state.inv[0][1];
  const jacket = c.state.inv[1][1];
  check(far?.type === 'cantMake' && far.why === 'bench', 'a repair away from a bench: refused');
  check(bat === 6 + 20 && jacket === 4 + 15, `a bat 6 → ${bat} (of 40), a jacket 4 → ${jacket} (of 30)`);
  check(
    c.count(I('tape')) === 2 && c.count(I('scrap')) === 1 && c.count(I('cloth')) === 2,
    'tape and scrap for the bat, cloth and tape for the jacket',
  );
  say(`at a bench, a bat with 6 blows mended to ${bat}, a jacket with 4 bites left to ${jacket}; refused away from one`);
}

// ------------------------------------------------------------------ armour, worn
{
  const c = city(5);
  const mid = openSquare(c);
  stand(c, mid, mid + 1);
  const biteThrough = (id: string | null) => {
    pockets(c, id ? [[id]] : []);
    c.state.armour = [0, 0];
    if (id) run(c, 1, command(0, COP.USE, 0));
    c.state.health = 100;
    c.state.zeds = [];
    c.peace = false;
    const z = zed(c, mid + 1, ZED.CHASE);
    let harm = 0;
    for (let k = 0; k < 200 && !harm; k++) {
      z.seen = c.state.step;
      const e = run(c, 1).find((x) => x.type === 'bite') as Extract<CityEvent, { type: 'bite' }> | undefined;
      if (e) harm = e.harm;
    }
    c.peace = true;
    c.state.zeds = [];
    return { harm, left: c.state.armour[1] };
  };
  const bare = biteThrough(null);
  const out = ['padded_jacket', 'sports_pads', 'scrap_armour', 'riot_gear', 'poncho'].map((id) => {
    const r = biteThrough(id);
    check(r.left === cityItem(I(id))!.wear! - 1, `${id} a bite more worn (${r.left})`);
    return `${id} ${r.harm}`;
  });
  check(
    bare.harm === 8 && out[0] === 'padded_jacket 6' && out[3] === 'riot_gear 4',
    `a shambler's bite through each: ${bare.harm}, ${out}`,
  );
  // Worn out: it falls apart.
  pockets(c, [['padded_jacket', 1]]);
  c.state.armour = [0, 0];
  run(c, 1, command(0, COP.USE, 0));
  c.peace = false;
  const z = zed(c, mid + 1, ZED.CHASE);
  let broke = false;
  for (let k = 0; k < 200 && !broke; k++) {
    z.seen = c.state.step;
    broke = run(c, 1).some((e) => e.type === 'broke');
  }
  c.peace = true;
  c.state.zeds = [];
  check(broke && c.state.armour[0] === 0, 'worn to nothing, it falls apart (said)');
  // Taken off into a pocket; put on again from it.
  pockets(c, [['riot_gear']]);
  run(c, 1, command(0, COP.USE, 0));
  run(c, 1, command(0, COP.USE, GEAR_OPS + 0));
  check(c.state.armour[0] === 0 && c.count(I('riot_gear')) === 1, 'taken off into a pocket');
  // Scrap armour's weight: forty steps' walk.
  const walked = (id: string | null) => {
    pockets(c, id ? [[id]] : []);
    c.state.armour = [0, 0];
    if (id) run(c, 1, command(0, COP.USE, 0));
    stand(c, mid - 2, mid - 1);
    const x0 = c.state.player.x;
    for (let k = 0; k < 10; k++) c.step(command(nearestDir(1, 0)));
    return c.state.player.x - x0;
  };
  const free = walked(null);
  const heavy = walked('scrap_armour');
  check(heavy < free && heavy >= free * 0.9, `scrap armour a little slower (${heavy} against ${free})`);
  // A poncho: one of the dead six tiles off by day sees the player; with it on, five.
  const seenAt = (id: string | null, d: number) => {
    pockets(c, id ? [[id]] : []);
    c.state.armour = [0, 0];
    if (id) run(c, 1, command(0, COP.USE, 0));
    stand(c, mid - 2, mid - 1);
    c.peace = false;
    at(c, 1, 12 * 60);
    c.step(0);
    c.state.zeds = [];
    // (Along a clear row or column, d tiles off.)
    const t0 = c.tile;
    const from = [1, -1, W, -W]
      .map((step) => t0 + step * d)
      .find(
        (f, j) =>
          f >= 0 &&
          f < N &&
          Array.from({ length: d }, (_, q) => t0 + [1, -1, W, -W][j] * (q + 1)).every((q) => !c.grid[q] && !c.world.veil[q]),
      );
    if (from === undefined) return null;
    const zz = zed(c, from, ZED.IDLE);
    run(c, 10);
    c.peace = true;
    c.state.zeds = [];
    return zz.mode === ZED.CHASE;
  };
  const plain6 = seenAt(null, 6);
  const poncho5 = seenAt('poncho', 6);
  check(plain6 === true && poncho5 === false, `six tiles off by day: seen bare (${plain6}), not in a poncho (${poncho5})`);
  say(
    `a shambler's bite (${bare.harm}) through ${out.join(', ')}, each a bite more worn, worn to nothing it falls apart; taken off into a pocket; scrap armour walks ${heavy} to ${free}; in a poncho not seen six tiles off by day`,
  );
}

// ------------------------------------------------------------------ a bag
{
  const c = city(6);
  pockets(c, [['satchel'], ['cloth', 4], ['tape', 3], ['plank', 2]]);
  run(c, 1, command(0, COP.USE, 0));
  check(c.state.bag === I('satchel') && !c.state.inv[0][0], 'a satchel put on');
  run(c, 1, command(0, COP.USE, GEAR_OPS + 2));
  check(c.state.open === BAG, `the bag opened (${c.state.open})`);
  // The cloth into it, the tape and planks too: the pockets' slots free.
  for (const id of ['cloth', 'tape', 'plank']) run(c, 1, command(0, COP.STORE, slotOf(c, id)));
  const inBag = (c.state.boxes[BAG] ?? []).filter((st) => st[0]).length;
  check(inBag === 3 && c.count(I('cloth')) === 4, `three things in the bag (${inBag}), counted (${c.count(I('cloth'))} cloth)`);
  // A bandage made from what's in the bag.
  const bandage = CITY_RECIPES.findIndex((r) => r.makes === 'bandage');
  run(c, 1, command(0, COP.MAKE, bandage));
  check(c.count(I('bandage')) === 1 && c.count(I('cloth')) === 2 && c.count(I('tape')) === 2, 'a bandage made from the bag');
  // Not taken off while it holds things.
  const refused = run(c, 1, command(0, COP.USE, GEAR_OPS + 1)).some((e) => e.type === 'refused' && e.why === 'bagFull');
  check(refused && c.state.bag === I('satchel'), 'not taken off full');
  // A fall: the bag's things on the pile, the bag kept on.
  c.state.health = 1;
  c.hurt(5, 'hunger');
  const pile = Object.entries(c.state.boxes)
    .filter(([k]) => k.includes(':g'))
    .flatMap(([, v]) => v)
    .filter((st) => st[0]);
  check(
    c.state.bag === I('satchel') && !(c.state.boxes[BAG] ?? []).some((st) => st[0]) && pile.some((st) => st[0] === I('plank')),
    'a fall: the bag kept on, its things on the pile',
  );
  say(
    'a satchel worn and opened; things stored in it count for making (a bandage made from them); not taken off full; a fall leaves its things on the pile, the bag on',
  );
}

// ------------------------------------------------------------------ shooting
{
  const c = city(7);
  const mid = openSquare(c);
  const shot = (kit: Array<[string, number?]>, kind?: number) => {
    pockets(c, kit);
    stand(c, mid - 2, mid + 2);
    c.peace = false;
    at(c, 1, 12 * 60);
    c.step(0);
    c.state.zeds = [];
    const z = zed(c, mid + 2, ZED.IDLE, kind);
    // (The last shot's moment passed.)
    c.state.swung = -9999;
    const hp = z.hp;
    const e = run(c, 1, command(0, COP.HIT, 0)).find((x) => x.type === 'shot') as Extract<CityEvent, { type: 'shot' }> | undefined;
    c.peace = true;
    return { item: e?.item ?? 0, harm: hp - z.hp, down: (z.down ?? 0) > 0 };
  };
  const sling = shot([['slingshot'], ['scrap', 3]]);
  const runner = shot([['slingshot'], ['scrap', 3]], ZKIND.RUNNER);
  const both = shot([['crossbow'], ['steel_crossbow'], ['bolt', 3]]);
  check(
    sling.item === I('slingshot') && sling.harm === 12 && c.count(I('scrap')) <= 2,
    `a slingshot shoots scrap (${JSON.stringify(sling)})`,
  );
  check(runner.down, 'a slingshot knocks a runner down');
  check(both.item === I('steel_crossbow') && both.harm === 40, `the steel crossbow shot first, its 40 (${JSON.stringify(both)})`);
  say(`a slingshot shoots scrap for ${sling.harm} and knocks a runner down; with both crossbows, the steel one, for ${both.harm}`);
}

// ------------------------------------------------------------------ smoke, a noisemaker, a flare
{
  const c = city(8);
  const mid = openSquare(c);
  stand(c, mid - 2, mid + 2);
  c.peace = false;
  at(c, 1, 12 * 60);
  c.step(0);
  // Smoke thrown at one of the dead after the player: it loses them.
  c.state.zeds = [];
  pockets(c, [['smoke_bomb', 1]]);
  const z = zed(c, mid + 2, ZED.CHASE);
  const thrown = run(c, 1, command(0, COP.USE, 0)).some((e) => e.type === 'thrown');
  run(c, 2 * 20);
  const lost = z.mode !== ZED.CHASE;
  run(c, GEAR.smokeSteps);
  check(thrown && lost && c.state.smoke.length === 0, `smoke thrown, the one after the player lost them (${z.mode}), gone in 15 s`);
  // A noisemaker set down, the player away: it rings and calls one of the dead twelve tiles off.
  c.state.zeds = [];
  pockets(c, [['noisemaker', 1]]);
  stand(c, mid, mid + 1);
  const set = run(c, 1, command(0, COP.USE, 0)).some((e) => e.type === 'set');
  const where = c.tile;
  c.state.player = bodyAt(2, 2);
  const far = [where + 12, where - 12, where + 12 * W, where - 12 * W].find((t) => t >= 0 && t < N && !c.grid[t])!;
  const y = zed(c, far, ZED.IDLE);
  let rang = -1;
  for (let k = 0; k < GEAR.tickSteps + 5 && rang < 0; k++) if (run(c, 1).some((e) => e.type === 'ring')) rang = k;
  check(
    set && rang >= GEAR.tickSteps - 2 && y.mode === ZED.SEEK && y.goal === where,
    `a noisemaker rings in 30 s (${rang}) and calls (${y.mode} to ${y.goal})`,
  );
  run(c, GEAR.ringSteps + 2);
  check(c.state.ticks.length === 0, 'and is done');
  // A flare: a strong light where it lands.
  c.peace = true;
  c.state.zeds = [];
  pockets(c, [['flare', 1]]);
  stand(c, mid - 2, mid + 2);
  const fl = run(c, 1, command(0, COP.USE, 0)).find((e) => e.type === 'thrown') as Extract<CityEvent, { type: 'thrown' }> | undefined;
  const lit = (c.state.lights[c.state.district] ?? []).some((l) => l[1] === LIGHT_KIND.FLARE && l[0] === fl?.to);
  check(!!fl && lit && c.lit[fl.to] === 1, 'a flare lights where it lands');
  say(
    'a smoke bomb: the one after the player loses them, the cloud gone in 15 s; a noisemaker rings 30 s after it is set and calls one of the dead 12 tiles off; a flare lights where it lands',
  );
}

// ------------------------------------------------------------------ found in a city begun from 2.69
{
  const tally = new Map<string, number>();
  for (let seed = 1; seed <= 6; seed++) {
    const c = city(seed);
    for (let d = 0; d < 9; d++) {
      priv(c).enter(d);
      c.district.props.forEach((_, k) => {
        for (const [item, n] of priv(c).stock(k)) {
          const id = cityItem(item)!.id;
          if (/^manual_|toolkit|riot_gear|sports_pads/.test(id)) tally.set(id, (tally.get(id) ?? 0) + (cityItem(item)!.wear ? 1 : n));
        }
      });
    }
  }
  const per = (id: string) => ((tally.get(id) ?? 0) / 6).toFixed(1);
  for (const id of ['manual_weapons', 'manual_sewing', 'manual_tricks', 'toolkit'])
    check((tally.get(id) ?? 0) >= 6, `${id} in every city on average (${per(id)})`);
  const old = city(1);
  old.state.rev = 4;
  let oldManuals = 0;
  for (let d = 0; d < 9; d++) {
    priv(old).enter(d);
    old.district.props.forEach((_, k) => {
      for (const [item] of priv(old).stock(k)) if (cityItem(item)!.kind === 'manual') oldManuals++;
    });
  }
  check(oldManuals === 0, `none in a city begun before (${oldManuals})`);
  say(
    `everything searched, 6 cities: ${['manual_weapons', 'manual_sewing', 'manual_tricks', 'toolkit', 'riot_gear', 'sports_pads'].map((id) => `${id} ${per(id)}`).join(', ')} a city; none in one begun before`,
  );
}

// ------------------------------------------------------------------ the Rush's supplies
{
  const c = city(9);
  c.peace = false;
  c.state.held = 1;
  // (Night 6's last wave, on day 7's morning.)
  at(c, 7, 4 * 60);
  c.state.zeds = [];
  c.state.waves = [6, 3];
  run(c, 60 * STEPS_PER_MINUTE + 2);
  const pile = c.state.boxes[`${c.state.district}:g${c.tile}`] ?? [];
  const manual = pile.find((st) => cityItem(st[0])?.kind === 'manual');
  check(!!manual && c.state.held === 2, `the second Rush held: a manual in the supplies (${cityItem(manual?.[0] ?? 0)?.id})`);
  say(`the second Rush held, a manual among the supplies (${cityItem(manual?.[0] ?? 0)?.id})`);
}

// ------------------------------------------------------------------ the review's cases
{
  // A sentry from a crossbow carried in the bag: its blows recorded, the save loading.
  const c = city(11);
  const mid = openSquare(c);
  pockets(c, [['hammer'], ['scrap', 4], ['wire', 2], ['satchel']]);
  run(c, 1, command(0, COP.USE, 3));
  c.state.boxes[BAG] = [[I('crossbow'), 17]];
  stand(c, mid, mid + 1);
  c.step(command(0, COP.BUILD, PIECE.sentry));
  run(c, 70);
  const p = c.state.built[c.state.district]?.find((q) => q[1] === PIECE.sentry);
  check(
    !!p && Math.floor(p[4] / 16) === 17 && !!loadCity(JSON.parse(JSON.stringify(c.snapshot()))),
    `a sentry from the bag's crossbow: its 17 blows kept (${p?.[4]}), the save loads`,
  );
  // The bag taken off from its own panel: shut.
  c.state.boxes[BAG] = [];
  run(c, 1, command(0, COP.USE, GEAR_OPS + 2));
  run(c, 1, command(0, COP.USE, GEAR_OPS + 1));
  check(c.state.bag === 0 && c.state.open === '', `the bag taken off from its panel: the panel shut (${c.state.open})`);
  // A fifth noisemaker: "four are ticking".
  c.state.ticks = [
    [1, 9e8],
    [2, 9e8],
    [3, 9e8],
    [4, 9e8],
  ];
  pockets(c, [['noisemaker', 1]]);
  const tooMany = run(c, 1, command(0, COP.USE, 0)).some((e) => e.type === 'refused' && e.why === 'tooMany');
  check(tooMany, 'a fifth noisemaker refused as too many');
  c.state.ticks = [];
  // A sledgehammer in the bag doesn't break walls: in hand is in the pockets.
  pockets(c, []);
  c.state.bag = I('satchel');
  c.state.boxes[BAG] = [[I('sledgehammer'), 50]];
  check(c.carried(I('sledgehammer')) === 0 && c.count(I('sledgehammer')) === 1, 'a sledgehammer in the bag is not in hand');
  // A workshop broken by the dead: its toolkit on the ground.
  c.state.built[c.state.district] = [[mid + 1, PIECE.workshop, 1, 1, 0]];
  c.reenter();
  removePiece(c, c.state.built[c.state.district][0]);
  check(
    (c.state.boxes[`${c.state.district}:g${mid + 1}`] ?? []).some((st) => st[0] === I('toolkit')),
    'a workshop broken: its toolkit on the ground',
  );
  // A city begun before 2.69: no toolkit to be found, so the workshop's recipes are made at a bench.
  const old = city(12);
  old.state.rev = 4;
  const k = CITY_RECIPES.findIndex((r) => r.makes === 'scrap_armour');
  pockets(old, [
    ['scrap', 4],
    ['wire', 2],
    ['cloth', 2],
  ]);
  check(old.canMake(k) === 'bench', `in a city begun before, scrap armour wants a bench, not a workshop (${old.canMake(k)})`);
  // Every light's toasts are said (a missing text stops the frame).
  for (const kind of Object.values(LIGHT_KIND))
    check(
      !!(en as Record<string, string>)[`city.toast.lit.${kind}`] && !!(en as Record<string, string>)[`city.toast.burnt.${kind}`],
      `a light ${kind}'s texts`,
    );
  say(
    "a sentry from a crossbow in the bag keeps its blows and the save loads; the bag taken off from its panel shuts it; a fifth noisemaker is too many; a sledgehammer in the bag isn't in hand; a workshop broken leaves its toolkit; in a city begun before, the workshop's recipes want a bench; every light's toasts are written",
  );
}

// ------------------------------------------------------------------ the save
{
  const c = city(10);
  c.state.manuals = 5;
  c.state.armour = [I('riot_gear'), 33];
  c.state.bag = I('hiking_pack');
  c.state.boxes[BAG] = [[I('plank'), 3]];
  c.state.smoke = [[100, c.state.step + 50]];
  c.state.ticks = [[200, c.state.step + 400]];
  const snap = JSON.parse(JSON.stringify(c.snapshot()));
  const back = loadCity(snap)!;
  check(
    back.state.manuals === 5 &&
      back.state.armour.join() === `${I('riot_gear')},33` &&
      back.state.bag === I('hiking_pack') &&
      back.count(I('plank')) === 3 &&
      back.state.smoke.length === 1 &&
      back.state.ticks.length === 1,
    'a save keeps the manuals, what is worn, the bag and its things, smoke and a noisemaker',
  );
  const bad = JSON.parse(JSON.stringify(snap));
  bad.state.manuals = 99;
  bad.state.armour = [I('plank'), 3];
  bad.state.bag = I('bat');
  bad.state.ticks = [[N + 5, 1]];
  const m = loadCity(bad)!;
  check(m.state.manuals === 0 && m.state.armour[0] === 0 && m.state.bag === 0 && m.state.ticks.length === 0, 'a damaged save made sound');
  const older = JSON.parse(JSON.stringify(snap));
  for (const k of ['manuals', 'armour', 'bag', 'smoke', 'ticks']) delete older.state[k];
  const o = loadCity(older)!;
  check(o.state.manuals === 0 && o.state.armour[0] === 0 && o.state.bag === 0, 'a save from before 2.69 loads with nothing worn');
  check(CITY_ITEMS.filter((d) => d.manual !== undefined).length === 6, 'six manuals (2.70: three more)');
  say(
    'a save keeps the manuals read, what is worn, the bag and its things, smoke and noisemakers; a damaged one made sound; one from before loads',
  );
}

console.log(lines.join('\n'));
