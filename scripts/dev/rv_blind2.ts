// A guard who can't see the pitch still "watches the match": the player in his plain sight, 5 tiles off, is unseen while a match is on.
import { PRISONS } from '../../src/content/prisons';
import { TALK } from '../../src/sim/command';
import { pitchOf, watchingMatch } from '../../src/sim/systems/football';
import { lineOfSight } from '../../src/sim/ai/sight';
import { nearestDir } from '../../src/sim/ai/path';
import { GUARD } from '../../src/sim/systems/guards';
import { TILE_INFO } from '../../src/sim/world/tiles';
import { MAP_W, MAP_H } from '../../src/sim/world/World';
import { UNIT } from '../../src/sim/tuning';
import { game, atPitch, put } from './rv_harness';
const id = process.argv[2] ?? 'san-pancho';
const prison = PRISONS.find((p) => p.id === id)!;
function trial(withMatch: boolean, G: [number, number], P: [number, number]) {
  const g = game(prison, 3);
  const s = g.sim.state;
  g.jump(1, 10, 30);
  atPitch(g, 0);
  if (withMatch) { g.talk(TALK.FOOTBALL); s.match!.at = s.step; }
  const gd = s.guards[0];
  s.guards.forEach((q, k) => { if (k) put(q.body, 1, 1); });
  put(gd.body, G[0], G[1]);
  put(s.player, P[0], P[1]);
  gd.mode = GUARD.DUTY; gd.wait = 1000; gd.body.facing = nearestDir(s.player.x - gd.body.x, s.player.z - gd.body.z);
  g.step();
  return { sees: gd.sees, watching: watchingMatch(g.sim, gd), match: !!s.match };
}
const g0 = game(prison, 3);
const w = g0.sim.world;
const p = pitchOf(g0.sim)!;
const offBy = (x: number, z: number) => Math.max(p.x - x, x - (p.x + p.w - 1), p.z - z, z - (p.z + p.d - 1), 0);
const pitchPts: Array<[number, number]> = [];
for (let x = p.x; x < p.x + p.w; x++) for (let z = p.z; z < p.z + p.d; z++) pitchPts.push([x * UNIT + 512, z * UNIT + 512]);
let found: [[number, number], [number, number]] | null = null;
for (let gz = 0; gz < MAP_H && !found; gz++)
  for (let gx = 0; gx < MAP_W && !found; gx++) {
    if (w.blocked(gx, gz) || !TILE_INFO[w.ground.kind[gz * MAP_W + gx]].outdoor || offBy(gx, gz) > 16 || offBy(gx, gz) < 4) continue;
    const cx = gx * UNIT + 512, cz = gz * UNIT + 512;
    if (pitchPts.some(([x, z]) => lineOfSight(w, cx, cz, x, z))) continue;
    for (let dz = -6; dz <= 6 && !found; dz++)
      for (let dx = -6; dx <= 6 && !found; dx++) {
        const px = gx + dx, pz = gz + dz;
        const d = Math.hypot(dx, dz);
        if (d < 4.5 || d > 6 || px < 0 || pz < 0 || w.blocked(px, pz) || offBy(px, pz) === 0 || offBy(px, pz) > 10) continue;
        if (!lineOfSight(w, cx, cz, px * UNIT + 512, pz * UNIT + 512)) continue;
        found = [[gx, gz], [px, pz]];
      }
  }
if (!found) { console.log(id, 'none found'); process.exit(0); }
const [G, P] = found;
const a = trial(false, G, P), b = trial(true, G, P);
console.log(`${id}: guard at ${G} (outdoors, ${offBy(...G)} tiles off the pitch, no line of sight to any pitch tile), player at ${P} (${offBy(...P)} off the pitch, ${Math.hypot(P[0] - G[0], P[1] - G[1]).toFixed(1)} tiles from him, in his sight line): no match -> sees ${a.sees}; match on -> watching ${b.watching}, sees ${b.sees}`);
