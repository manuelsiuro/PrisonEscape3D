// Scratch: which roll-call or hoop spots lie in each pitch's nets, and on its field.
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
const PICK: Record<string, number[]> = JSON.parse(process.argv[2] ?? '{}');
for (const p of [...PRISONS, TRAINING]) {
  const [x0, z0, ww, dd] = PICK[p.id] ?? [p.leisure!.pitch.x, p.leisure!.pitch.z, p.leisure!.pitch.w, p.leisure!.pitch.d];
  const along = ww >= dd;
  const spots = [...p.rollCall.map((r) => ['rc', r.x, r.z] as const), ...p.leisure!.hoop.spots.map((s) => ['hoop', s.x, s.z] as const)];
  const net: string[] = [];
  const field: string[] = [];
  for (const [k, x, z] of spots) {
    if (x < x0 || x >= x0 + ww || z < z0 || z >= z0 + dd) continue;
    const a = along ? x - x0 : z - z0, b = along ? z - z0 : x - x0, len = along ? ww : dd, wid = along ? dd : ww;
    const end = a === 0 || a === len - 1;
    const mid = b === Math.floor(wid / 2) || b === Math.floor(wid / 2) - 1;
    (end && mid ? net : field).push(`${k}@${x},${z}`);
  }
  console.log(p.id, [x0, z0, ww, dd].join(','), 'nets:', net.join(' ') || '-', '| field:', field.length);
}
