// Dev tool, run in the browser on the dev server (not by tsx): each prison card's picture in Choose a prison
// (2.63.1), the whole prison from a low angle in its own light, rendered by the game itself, the HUD hidden.
// Needs scripts/dev/shotsink.ts running (it writes public/prisons/<prison>.webp). Open the dev build at a
// 1280×800 viewport (device pixel ratio 1), in an isolated profile, then in its console:
//   const c = await import('/scripts/dev/cardshot.ts');
//   await c.look('frostberg');   // one staged and held, for a look (c.stop() after)
//   await c.send();              // every card's picture taken and sent (or c.send(['gull-rock']))
// Each is staged as the trailer stages its shots (trailer.ts): an escape bot's run at a moment, the
// camera put where the card's `cam` says.
import { SHOTS, type Shot } from './helpshot';
import { hold, stop, type Cut } from './trailer';
import type { Sim } from '../../src/sim/Sim';
import type { View } from '../../src/render/View';

/** The picture's size: the cards show it cropped (a banner on wide screens, a strip on phones). */
export const PIC_W = 640;
export const PIC_H = 400;

/** The moment the game's clock reaches this minute of the day. */
const minute = (m: number) => (s: Sim) => s.clock.minuteOfDay >= m && s.clock.minuteOfDay < m + 60;

interface Card {
  shot: Shot;
  /** The tile looked at (the prison's middle), the zoom, the turn and the tilt (trailer.ts's `Cam`). */
  at: [number, number];
  zoom: number;
  turn: number;
  tilt: number;
}

/** Each prison's picture: the user's picks (2026-11-18): the whole prison, angled, each in its own light. */
export const CARDS: Record<string, Card> = {
  // A sunny morning.
  'maple-grove': {
    shot: { prison: 'maple-grove', route: 'cutout', when: minute(9 * 60 + 30), light: 570 },
    at: [32, 30],
    zoom: 0.32,
    turn: 0.35,
    tilt: 0.32,
  },
  // In the snow, at noon (on the surface: the weather lesson's moment is down its tunnel).
  frostberg: {
    shot: { prison: 'frostberg', route: 'tunnel', when: minute(12 * 60), light: 720 },
    at: [32, 30],
    zoom: 0.32,
    turn: -0.35,
    tilt: 0.32,
  },
  // A flat grey noon.
  'gravel-point': {
    shot: { prison: 'gravel-point', route: 'rooftop', when: minute(12 * 60), light: 700 },
    at: [32, 30],
    zoom: 0.32,
    turn: 0.35,
    tilt: 0.32,
  },
  // Hot late light.
  'sierra-seca': { shot: { ...SHOTS.mines, zoom: undefined, light: 1060 }, at: [32, 30], zoom: 0.32, turn: -0.35, tilt: 0.32 },
  // The rock in the sea, the raft leaving it.
  'gull-rock': { shot: { ...SHOTS.island, zoom: undefined, dx: undefined, light: 690 }, at: [32, 30], zoom: 0.32, turn: 0.35, tilt: 0.32 },
  // Evening in the valley (its own dusk is too dark to read on a card).
  'six-hunter': {
    shot: { prison: 'six-hunter', route: 'glider', when: minute(17 * 60), light: 1110 },
    at: [32, 30],
    zoom: 0.32,
    turn: -0.35,
    tilt: 0.32,
  },
};

const cutOf = (id: string): Cut => {
  const c = CARDS[id];
  return { id, beats: 1, tempo: 1, shot: c.shot, pre: 1.5, cam: () => ({ at: c.at, zoom: c.zoom, turn: c.turn, tilt: c.tilt }) };
};

const view = () => (window as unknown as { __view: View }).__view;

/** One prison staged and held (the camera settled), for a look: stop() after. */
export const look = (id: string) => hold(cutOf(id));
export { stop };

/** The frame on screen, cropped to the picture's shape from its middle and scaled to PIC_W × PIC_H. */
function picture(): HTMLCanvasElement {
  const src = view().renderer.domElement;
  const out = document.createElement('canvas');
  out.width = PIC_W;
  out.height = PIC_H;
  const g = out.getContext('2d')!;
  const k = Math.min(src.width / PIC_W, src.height / PIC_H);
  const w = PIC_W * k;
  const h = PIC_H * k;
  g.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, PIC_W, PIC_H);
  return out;
}

/** Every card's picture (or those named) taken and sent to shotsink as public/prisons/<id>.webp. */
export async function send(ids = Object.keys(CARDS)) {
  const sizes: Record<string, number> = {};
  try {
    for (const id of ids) {
      await look(id);
      const blob = await new Promise<Blob>((done) => picture().toBlob((b) => done(b!), 'image/webp', 0.8));
      const res = await fetch(`http://127.0.0.1:5311/?name=${id}.card.webp`, { method: 'POST', body: blob });
      if (!res.ok) throw new Error(`${id}: shotsink said ${res.status}`);
      sizes[id] = Math.round(blob.size / 1000);
    }
  } finally {
    stop();
  }
  return sizes;
}
