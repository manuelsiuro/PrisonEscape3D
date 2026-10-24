// Dev tool, run in the browser on the dev server (not by tsx): each prison photographed whole
// from the game's own camera (View.mapShot), framed with tile rulers like the other pictures in
// assets/maps/, for the map viewer's "In game" view; and (P41 review) each prison's outside, as the
// manhunt draws it, for its "Outside 3D" view. In the dev build's console:
//   const m = await import('/scripts/dev/mapshot.ts');
//   await m.download();          // every prison: N-<id>-game.png and N-<id>-game.json, as downloads
//   await m.shoot(3);            // one prison (index as in the viewer): { png: data URL, meta }
//   await m.send();              // every prison and every outside, straight to assets/maps/ (needs shotsink.ts running); send(true): the outsides only
//   await m.shootOutside(3);     // one prison's outside: { png, meta }
// Move the downloads into assets/maps/ (send() writes them there), then `npm run maps` puts them in the viewer's data.
import { outsideOf } from '../../src/content/outside';
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { en } from '../../src/i18n/en';
import type { View } from '../../src/render/View';
import { Sim } from '../../src/sim/Sim';
import { play } from '../../src/play/game';
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
  const name = def.id === 'training' ? 'Training Block' : ((en as Record<string, string>)[`prison.${def.id}`] ?? def.id);
  return framed(view.mapShot(S, 2), `${k}-${def.id}-game.png`, `${name} — in game: the 3D view from the game's camera, nobody in it, 10:00`, `v${pkg.version} · map rev ${def.map ?? 0} · rulers: the floor's tiles (walls stand up over the rows north of them)`);
}

/**
 * A prison's outside as the manhunt draws it (P41 review): its houses, the prison behind its wall
 * (Irongate's island across the water), at 10:00 with nobody in it, before any alarm (no
 * helicopter, no roadblocks). Started from a way out over the wall or by the gate (no vehicle left
 * lying about), then left: back to the title.
 */
export async function shootOutside(k: number) {
  const def = ALL[k];
  const od = outsideOf(def.id);
  if (!od) return null;
  const w = window as unknown as { __view: View; __manhunt: (p: string, kind: string, more: object) => Promise<unknown> };
  const view = w.__view;
  void w.__manhunt(def.id, od.starts.wall ? 'wall' : 'gate', { minute: 600, headStart: 60 });
  await frames(40);
  if (play.game) play.game.paused = true;
  await frames(5);
  // Nobody in it: the player, the searchers out on their beats and their dogs, their cones, the lookout.
  const v = view as unknown as { player: { root: { visible: boolean } }; dogs: { group: { visible: boolean } }; cones: { group: { visible: boolean } }; setGuards(b: unknown[]): void; setCast(c: 0): void };
  v.player.root.visible = false;
  v.setGuards([]);
  v.setCast(0);
  v.dogs.group.visible = false;
  v.cones.group.visible = false;
  const name = (en as Record<string, string>)[`prison.${def.id}`] ?? def.id;
  const out = framed(view.mapShot(S, 2), `${k}-${def.id}-outside-game.png`, `${name} — the outside in game (P41, the manhunt): the 3D view from the game's camera, nobody in it, 10:00`, `v${pkg.version} · rulers: the outside's tiles as the Outside view's · the prison stands past the wall (bottom)`);
  v.player.root.visible = true;
  v.dogs.group.visible = true;
  v.cones.group.visible = true;
  return out;
}

/** A shot framed as the maps are: a title over it, tile rulers round it; and its frame's numbers for the viewer. */
function framed(shot: { canvas: HTMLCanvasElement; top: number; rows: number }, file: string, title: string, sub: string) {
  const w = MAP_W * S + 2 * M;
  const h = TITLE_H + M + shot.canvas.height + M;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.drawImage(shot.canvas, M, TITLE_H + M);
  g.fillStyle = '#111';
  g.font = '700 24px Helvetica, Arial, sans-serif';
  g.fillText(title, M, 30);
  g.font = '15px Helvetica, Arial, sans-serif';
  g.fillStyle = '#555';
  g.textAlign = 'right';
  g.fillText(sub, w - M, 30);
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
  const meta = { file, width: w, height: h, originX: M, originY: y0, tileW: S, tileH: dz };
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

/** Every prison's in-game picture and every outside's (`outsides`: only the outsides'), written to assets/maps/ by shotsink.ts; back to the title after. */
export async function send(outsides = false) {
  const post = async (file: string, body: Blob) => {
    const res = await fetch(`http://127.0.0.1:5311/?name=${file}`, { method: 'POST', body });
    if (!res.ok) throw new Error(`${file}: the sink said ${res.status}`);
  };
  const sent: string[] = [];
  for (let k = 0; k < ALL.length; k++) {
    for (const shot of [outsides ? null : await shoot(k), await shootOutside(k)]) {
      if (!shot) continue;
      await post(shot.meta.file, await (await fetch(shot.png)).blob());
      await post(shot.meta.file.replace('.png', '.json'), new Blob([JSON.stringify(shot.meta)], { type: 'application/json' }));
      sent.push(shot.meta.file);
    }
    if (play.game) (await import('../../src/play/session')).endGame();
    await frames(10);
  }
  return sent;
}
