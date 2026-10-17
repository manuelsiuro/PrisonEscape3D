// Where a glider gets out (P24 design aid): every roof tile reachable from a ladder (or a grapnel's landing), each way, each wind.
import { PRISONS } from '../../src/content/prisons';
import { World, LAYER, MAP_W } from '../../src/sim/world/World';
import { TILE } from '../../src/sim/world/tiles';
import { glideFrom } from '../../src/sim/systems/structure';
import { UNIT } from '../../src/sim/tuning';
for (const def of PRISONS) {
  const w = new World(def);
  const roof = w.layers[LAYER.ROOF].kind;
  const seen = new Uint8Array(64 * 64);
  const q: number[] = [];
  for (let i = 0; i < 64 * 64; i++) if (roof[i] === TILE.LADDER) { seen[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const t = q[k];
    for (const j of [t - 1, t + 1, t - 64, t + 64]) if (j >= 0 && j < 4096 && !seen[j] && (roof[j] === TILE.ROOF || roof[j] === TILE.LADDER)) { seen[j] = 1; q.push(j); }
  }
  const outs = new Map<string, number>();
  for (const t of q) for (const facing of [1, 5, 9, 13]) {
    const b = { x: (t % MAP_W) * UNIT + UNIT / 2, z: Math.floor(t / MAP_W) * UNIT + UNIT / 2, facing, moving: false };
    for (let wind = 0; wind < 8; wind++) for (const force of [0, 1, 2]) for (const weather of ['clear', 'rain'] as const) {
      const g = glideFrom(w, b, { wind, force, weather });
      if (g && !g.why && g.out) {
        const key = `${facing === 1 ? 'E' : facing === 5 ? 'S' : facing === 9 ? 'W' : 'N'} edge`;
        const need = `${key}: from ${t % 64},${Math.floor(t / 64)} wind ${wind} f${force} ${weather} → ${g.dist}`;
        outs.set(key, (outs.get(key) ?? 0) + 1);
        if ((outs.get(key) ?? 0) <= 2) console.log(def.id, need);
      }
    }
  }
  console.log(def.id, 'roof tiles', q.length, 'escapes:', [...outs].map(([k, v]) => `${k} ${v}`).join(', ') || 'none');
}
