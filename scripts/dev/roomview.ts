// Scratch: P30 the canteens and libraries, tile by tile (for the stage and the quiz table).
import { PRISONS } from '../../src/content/prisons';
import { Sim } from '../../src/sim/Sim';
import { MAP_W, MAP_H } from '../../src/sim/world/World';
import { TILE } from '../../src/sim/world/tiles';
for (const p of PRISONS) {
  const w = new Sim(p, 1).world;
  for (const zone of ['canteen', 'library']) {
    let x0 = MAP_W, x1 = 0, z0 = MAP_H, z1 = 0;
    for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (w.zoneAt(x, z) === zone) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    console.log(`== ${p.id} ${zone} x ${x0}-${x1} z ${z0}-${z1}`);
    let head = '     ';
    for (let x = x0 - 1; x <= x1 + 1; x++) head += String(x % 10);
    console.log(head);
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      let row = String(z).padStart(4) + ' ';
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const prop = w.props.find((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d);
        const dec = (p.decor ?? []).find((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
        const base = w.ground.base[z * MAP_W + x];
        let c = w.zoneAt(x, z) === zone ? '.' : ',';
        if (base === TILE.DOOR) c = 'D';
        else if (w.blocked(x, z)) c = '#';
        if (prop) c = (prop as any).kind?.[0]?.toUpperCase() ?? 'P';
        if (dec) c = 'd';
        row += c;
      }
      console.log(row);
    }
  }
}
