// Scratch: prints each prison's yard and cell block as ASCII to place P28's garden and rat track.
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { Sim } from '../../src/sim/Sim';
import { reserved, canDigFloor } from '../../src/sim/systems/structure';
import { MAP_W, MAP_H } from '../../src/sim/world/World';
for (const p of [...PRISONS, TRAINING]) {
  const sim = new Sim(p, 1);
  const w = sim.world;
  const res = reserved(w);
  const want = process.argv[2] ?? 'yard';
  let x0 = MAP_W, x1 = 0, z0 = MAP_H, z1 = 0;
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (w.zoneAt(x, z) === want) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  console.log(`== ${p.id} ${want} x ${x0}-${x1} z ${z0}-${z1} hoop ${JSON.stringify(p.leisure?.hoop && { x: p.leisure.hoop.x, z: p.leisure.hoop.z })}`);
  const spots = new Set((p.leisure?.hoop.spots ?? []).map((s) => s.z * MAP_W + s.x));
  for (let z = Math.max(0, z0 - 1); z <= Math.min(MAP_H - 1, z1 + 1); z++) {
    let row = String(z).padStart(3) + ' ';
    for (let x = Math.max(0, x0 - 1); x <= Math.min(MAP_W - 1, x1 + 1); x++) {
      const i = z * MAP_W + x;
      const decor = (p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
      const zone = w.zoneAt(x, z);
      let c = '#';
      if (spots.has(i)) c = 'o';
      else if (p.leisure && x === p.leisure.hoop.x && z === p.leisure.hoop.z) c = 'H';
      else if (w.blocked(x, z)) c = w.ground.kind[i] === 7 ? 'D' : '#';
      else if (decor) c = 'd';
      else if (w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d)) c = 'p';
      else if (zone !== want) c = ',';
      else if (res.has(i)) c = 'r';
      else if (canDigFloor(w, i, [])) c = '.';
      else c = '-';
      row += c;
    }
    console.log(row + `   (x from ${Math.max(0, x0 - 1)})`);
  }
}
