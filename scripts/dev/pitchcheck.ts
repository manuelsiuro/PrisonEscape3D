// Scratch: checks chosen pitches (field and nets open yard/roll-call floor; no garden or hoop tile anywhere in the rectangle).
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { Sim } from '../../src/sim/Sim';
const PICK: Record<string, [number, number, number, number]> = { 'center-perks': [26, 28, 11, 4], 'stalag-flucht': [13, 22, 13, 5], shankton: [27, 30, 11, 5], 'san-pancho': [27, 32, 10, 6], irongate: [14, 22, 13, 5], training: [31, 39, 13, 6] };
for (const p of [...PRISONS, TRAINING]) {
  const [x0, z0, ww, dd] = PICK[p.id];
  const w = new Sim(p, 1).world;
  const L = p.leisure!;
  const errs: string[] = [];
  for (let a = 0; a < ww; a++)
    for (let b = 0; b < dd; b++) {
      const x = x0 + a, z = z0 + b;
      const g = L.garden;
      if ((x >= g.x && x < g.x + g.w && z >= g.z && z < g.z + g.d) || (L.hoop.x === x && L.hoop.z === z)) errs.push(`garden/hoop ${x},${z}`);
      const along = ww >= dd;
      const end = along ? a === 0 || a === ww - 1 : b === 0 || b === dd - 1;
      const mid = along ? b === Math.floor(dd / 2) || b === Math.floor(dd / 2) - 1 : a === Math.floor(ww / 2) || a === Math.floor(ww / 2) - 1;
      if (end && !mid) continue;
      const zone = w.zoneAt(x, z);
      const deco = (p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
      const prop = w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d);
      if ((zone !== 'yard' && zone !== 'rollCall') || w.blocked(x, z) || deco || prop) errs.push(`${x},${z} ${zone}${deco ? ' decor' : ''}${prop ? ' prop' : ''}`);
    }
  console.log(p.id, errs.length ? errs.join('; ') : 'ok');
}
