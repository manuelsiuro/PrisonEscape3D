// Looking at City Escape (2.57): a district of the city that is open put on screen at an hour, the player
// stood in its street or inside one of its buildings, nobody about, the game held still. From the
// browser's console (or chrome-devtools) in a dev build, a city open:
//
//   const g = await import('/scripts/dev/citygo.ts');
//   await g.go('downtown', 0.7);                 // the district's kind, the camera's zoom (noon)
//   await g.go('suburbs', 1.6, 22 * 60, 'house'); // at 22:00, inside its first house
//   g.done();                                     // the city going again
import type { City } from '../../src/city/sim/City';
import { MAP_W as W } from '../../src/sim/world/grid';

interface Run {
  city: City;
  paused: boolean;
}
const page = window as unknown as {
  __city: () => Run | null;
  __cityStage: () => void;
  __view: { zoomTo(z: number): void };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function go(kind: string, zoom = 1, minute = 12 * 60, use?: string, nth = 0): Promise<string> {
  const r = page.__city();
  if (!r) throw new Error('open a city first');
  const c = r.city;
  r.paused = false;
  c.peace = true;
  const d = (c.plan.kinds as readonly string[]).indexOf(kind);
  if (d < 0) throw new Error(`no district '${kind}': ${c.plan.kinds.join(', ')}`);
  if (d !== c.state.district) (c as unknown as { enter(d: number): void }).enter(d);
  const dist = c.districtOf(d);
  let at = dist.spawn;
  const lot = use ? dist.lots.filter((l) => l.use === use)[nth] : undefined;
  if (use && !lot) throw new Error(`no '${use}' here: ${[...new Set(dist.lots.map((l) => l.use))].join(', ')}`);
  if (lot) {
    const k = dist.lots.indexOf(lot) + 1;
    const mx = Math.floor((lot.x0 + lot.x1) / 2);
    const mz = Math.floor((lot.z0 + lot.z1) / 2);
    let best = Infinity;
    for (let z = lot.z0; z <= lot.z1; z++)
      for (let x = lot.x0; x <= lot.x1; x++) {
        const far = Math.abs(x - mx) + Math.abs(z - mz);
        if (far < best && !c.grid[z * W + x] && dist.lotAt[z * W + x] === k && dist.rows[z][x] !== '#') [best, at] = [far, { x, z }];
      }
  }
  c.state.player.x = at.x * 1024 + 512;
  c.state.player.z = at.z * 1024 + 512;
  c.state.zeds = [];
  c.state.step = (minute - 390) * 20;
  page.__cityStage();
  page.__view.zoomTo(zoom);
  await sleep(2200);
  r.paused = true;
  return `${dist.kind} ${at.x},${at.z}`;
}

export function done() {
  const r = page.__city();
  if (r) r.paused = false;
}
