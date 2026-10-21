// Dev tool, run in the browser on the dev server (not by tsx): each prison photographed whole
// from the game's own camera (View.mapShot), framed with tile rulers like the other pictures in
// assets/maps/, for the map viewer's "In game" view. In the dev build's console:
//   const m = await import('/scripts/dev/mapshot.ts');
//   await m.download();          // every prison: N-<id>-game.png and N-<id>-game.json, as downloads
//   await m.shoot(3);            // one prison (index as in the viewer): { png: data URL, meta }
// Move the downloads into assets/maps/, then `npm run maps` puts them in the viewer's data.
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { en } from '../../src/i18n/en';
import type { View } from '../../src/render/View';
import { Sim } from '../../src/sim/Sim';
import { MAP_H, MAP_W } from '../../src/sim/world/World';
import pkg from '../../package.json';

/** The same frame as mapimage.ts: pixels a tile, the rulers' margin, the title's band. */
const S = 40;
const M = 34;
const TITLE_H = 44;
const ALL = [TRAINING, ...PRISONS];

const frames = (n: number) => new Promise<void>((done) => {
  const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : done());
  step(n);
});

export async function shoot(k: number) {
  const def = ALL[k];
  const view = (window as unknown as { __view: View }).__view;
  view.setWorld(new Sim(def).world);
  // A few frames behind the title first: the new prison's meshes built, its shaders warm.
  await frames(30);
  const shot = view.mapShot(S, 2);
  const w = MAP_W * S + 2 * M;
  const h = TITLE_H + M + shot.canvas.height + M;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.drawImage(shot.canvas, M, TITLE_H + M);
  const name = def.id === 'training' ? 'Training Block' : ((en as Record<string, string>)[`prison.${def.id}`] ?? def.id);
  g.fillStyle = '#111';
  g.font = '700 24px Helvetica, Arial, sans-serif';
  g.fillText(`${name} — in game: the 3D view from the game's camera, nobody in it, 10:00`, M, 30);
  g.font = '15px Helvetica, Arial, sans-serif';
  g.fillStyle = '#555';
  g.textAlign = 'right';
  g.fillText(`v${pkg.version} · map rev ${def.map ?? 0} · rulers: the floor's tiles (walls stand up over the rows north of them)`, w - M, 30);
  // Rulers: columns above and below, the floor's rows either side (a row is `rows` tiles deep on screen).
  const y0 = TITLE_H + M + shot.top;
  const dz = S * shot.rows;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let n = 0; n < MAP_W; n++) {
    g.font = `${n % 8 === 0 ? '700 ' : ''}11px Helvetica, Arial, sans-serif`;
    g.fillStyle = '#333';
    g.fillText(String(n), M + (n + 0.5) * S, TITLE_H + M / 2);
    g.fillText(String(n), M + (n + 0.5) * S, h - M / 2);
    g.fillText(String(n), M / 2, y0 + (n + 0.5) * dz);
    g.fillText(String(n), w - M / 2, y0 + (n + 0.5) * dz);
    // Ticks between the numbers, longer every 8.
    g.fillStyle = n % 8 === 0 ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.2)';
    const t = n % 8 === 0 ? 8 : 4;
    g.fillRect(M + n * S, TITLE_H + M - t, 1, t);
    g.fillRect(M + n * S, h - M, 1, t);
    g.fillRect(M - t, y0 + n * dz, t, 1);
    g.fillRect(w - M, y0 + n * dz, t, 1);
  }
  const meta = { file: `${k}-${def.id}-game.png`, width: w, height: h, originX: M, originY: y0, tileW: S, tileH: dz };
  return { png: c.toDataURL('image/png'), meta };
}

/** Every prison, saved as downloads (the picture and its frame's numbers). */
export async function download() {
  for (let k = 0; k < ALL.length; k++) {
    const { png, meta } = await shoot(k);
    const save = (href: string, file: string) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = file;
      a.click();
    };
    save(png, meta.file);
    save(URL.createObjectURL(new Blob([JSON.stringify(meta)], { type: 'application/json' })), meta.file.replace('.png', '.json'));
    await frames(10);
  }
}
