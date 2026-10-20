// Scratch: P29 pitches again, the nets (and, if it can, the whole field) clear of roll-call spots and the hoop's spots.
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { Sim } from '../../src/sim/Sim';
import { MAP_W, MAP_H } from '../../src/sim/world/World';
for (const p of [...PRISONS, TRAINING]) {
  const w = new Sim(p, 1).world;
  const L = p.leisure!;
  const spots = new Set([...p.rollCall.map((r) => r.z * MAP_W + r.x)]);
  const hoop = new Set(L.hoop.spots.map((s) => s.z * MAP_W + s.x));
  const bad = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return true;
    if ((w.zoneAt(x, z) !== 'yard' && w.zoneAt(x, z) !== 'rollCall') || w.blocked(x, z)) return true;
    if ((p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1))) return true;
    if (w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d)) return true;
    return L.hoop.x === x && L.hoop.z === z;
  };
  const found: Array<[number, string]> = [];
  for (let len = 13; len >= 10; len--)
    for (let wid = 6; wid >= 4; wid--)
      for (const along of [true, false])
        for (let z = 0; z < MAP_H; z++)
          for (let x = 0; x < MAP_W; x++) {
            const ww = along ? len : wid, dd = along ? wid : len;
            let ok = true, onSpots = 0, onHoop = 0;
            for (let a = 0; a < ww && ok; a++)
              for (let b = 0; b < dd && ok; b++) {
                const tx = x + a, tz = z + b, i = tz * MAP_W + tx;
                const g = L.garden;
                if (tx >= g.x && tx < g.x + g.w && tz >= g.z && tz < g.z + g.d) ok = false;
                const end = along ? a === 0 || a === ww - 1 : b === 0 || b === dd - 1;
                const mid = along ? b === Math.floor(dd / 2) || b === Math.floor(dd / 2) - 1 : a === Math.floor(ww / 2) || a === Math.floor(ww / 2) - 1;
                if ((!end || mid) && bad(tx, tz)) ok = false;
                if (end && mid && (spots.has(i) || hoop.has(i))) ok = false;
                if (spots.has(i)) onSpots++;
                if (hoop.has(i)) onHoop++;
              }
            if (ok) found.push([len * wid * 10 - onSpots * 3 - onHoop * 8, `{${x},${z},${ww},${dd}} spots ${onSpots} hoop ${onHoop}`]);
          }
  found.sort((a, b) => b[0] - a[0]);
  const now = L.pitch;
  console.log(`== ${p.id} (now ${now.x},${now.z},${now.w},${now.d}): ${found.slice(0, 6).map((f) => f[1]).join(' | ')}`);
}
