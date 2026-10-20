// Scratch: finds room for P29's football pitch in each yard: the field (all but the end columns) open yard floor clear of props, decor, the hoop and the garden;
// each end column's two middle tiles (the nets) open too. Biggest first.
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { Sim } from '../../src/sim/Sim';
import { MAP_W, MAP_H } from '../../src/sim/world/World';
for (const p of [...PRISONS, TRAINING]) {
  const sim = new Sim(p, 1);
  const w = sim.world;
  const L = p.leisure!;
  const bad = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return true;
    if ((w.zoneAt(x, z) !== 'yard' && w.zoneAt(x, z) !== 'rollCall') || w.blocked(x, z)) return true;
    if ((p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1))) return true;
    if (w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d)) return true;
    if (L.hoop.x === x && L.hoop.z === z) return true;
    const g = L.garden;
    if (x >= g.x && x < g.x + g.w && z >= g.z && z < g.z + g.d) return true;
    return false;
  };
  const found: Array<[number, string]> = [];
  for (let len = 13; len >= 8; len--)
    for (let wid = 6; wid >= 4; wid--)
      for (const along of [true, false])
        for (let z = 0; z < MAP_H; z++)
          for (let x = 0; x < MAP_W; x++) {
            const ww = along ? len : wid;
            const dd = along ? wid : len;
            let ok = true;
            for (let a = 0; a < ww && ok; a++)
              for (let b = 0; b < dd && ok; b++) {
                const end = along ? a === 0 || a === ww - 1 : b === 0 || b === dd - 1;
                const mid = along ? b === Math.floor(dd / 2) || b === Math.floor(dd / 2) - 1 : a === Math.floor(ww / 2) || a === Math.floor(ww / 2) - 1;
                if ((!end || mid) && bad(x + a, z + b)) ok = false;
              }
            if (ok) found.push([len * wid, `{ x: ${x}, z: ${z}, w: ${ww}, d: ${dd} }`]);
          }
  found.sort((a, b) => b[0] - a[0]);
  console.log(`== ${p.id}: ${found.length}; ${found.slice(0, 8).map((f) => f[1]).join(' | ')}`);
}
