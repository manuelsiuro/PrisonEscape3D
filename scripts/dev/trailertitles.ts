// Dev tool, run in the browser on the dev server (see trailer.ts): the trailer's on-screen text,
// one transparent 1920×1080 PNG a frame (en/NNNNN.png, fr/NNNNN.png), laid over the film by
// trailercut.sh. The game's own words where it has them (the PA's hello, the tagline, the
// prisons' names, the escape's stamp), in its fonts and colours (Fredoka, Inter, the orange).
//   const t = await import('/scripts/dev/trailertitles.ts');
//   await t.titles('en');  await t.titles('fr');
//   await t.still('fr', 640);  // one frame, sent as still-fr-640.png, for a look
import { en } from '../../src/i18n/en';
import { fr } from '../../src/i18n/fr';
import { FPS, H, W, timeline } from './trailer';

const SINK = 'http://127.0.0.1:5312';
type Lang = 'en' | 'fr';

/** The frame the glider touches down, outside the walls (read off the film). */
export const TOUCHDOWN = 1052;

/** What the game doesn't say itself. */
const OWN: Record<Lang, { words: string[]; prisons: string; cta: string }> = {
  en: {
    words: ['Dig.', 'Cut.', 'Bribe.', 'Smuggle.', 'Disguise.', 'Tame.'],
    prisons: '5 prisons. Every way out.',
    cta: 'Free in your browser · Phone & desktop',
  },
  fr: {
    words: ['Creuse.', 'Coupe.', 'Soudoie.', 'Trafique.', 'Déguise-toi.', 'Apprivoise.'],
    prisons: '5 prisons. Toutes les sorties.',
    cta: 'Gratuit dans ton navigateur · Mobile et ordinateur',
  },
};
const URL_TEXT = 'manuelsiuro.github.io/PrisonEscape3D';
const PRISONS = ['center-perks', 'stalag-flucht', 'shankton', 'san-pancho', 'irongate'];
const WORD_CUTS = ['dig', 'cut', 'bribe', 'smuggle', 'disguise', 'rat'];

const ORANGE = '#ff7714';
const ORANGE_2 = '#d9530a';
const STAMP = '#ff5a3c';
const DISPLAY = 'Fredoka, system-ui, sans-serif';
const UI = 'Inter, system-ui, sans-serif';

// ------------------------------------------------------------------ easing
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => {
  const u = clamp(x);
  return u * u * (3 - 2 * u);
};
/** Ease out with an overshoot (as the game's stamp-in, cubic-bezier(0.2, 1.6, 0.4, 1)). */
const back = (x: number, s = 2.2) => {
  const u = clamp(x) - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
/** In over `fin` seconds from t0, out over `fout` seconds to t1. */
const env = (t: number, t0: number, t1: number, fin = 0.25, fout = 0.2) => smooth((t - t0) / fin) * smooth((t1 - t) / fout);

// ------------------------------------------------------------------ drawing
type Part = { text: string; color: string };

/** A line in the logo's style: white (or accented) on a two-step dark edge and a soft shadow. */
function heavy(g: CanvasRenderingContext2D, parts: Part[], x: number, y: number, size: number, maxW = W - 160) {
  g.font = `700 ${size}px ${DISPLAY}`;
  let w = parts.reduce((a, p) => a + g.measureText(p.text).width, 0);
  const k = w > maxW ? maxW / w : 1;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  w = parts.reduce((a, p) => a + g.measureText(p.text).width, 0);
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const d = size / 30;
  for (const [dy, color, blur] of [
    [6 * d, '#222c3d', 18 * d],
    [3 * d, '#33415a', 0],
  ] as const) {
    let px = -w / 2;
    g.shadowColor = blur ? 'rgba(5,10,20,0.6)' : 'transparent';
    g.shadowBlur = blur;
    g.shadowOffsetY = blur ? 8 * d : 0;
    g.fillStyle = color;
    for (const p of parts) {
      g.fillText(p.text, px, dy);
      px += g.measureText(p.text).width;
    }
  }
  g.shadowColor = 'transparent';
  let px = -w / 2;
  for (const p of parts) {
    g.fillStyle = p.color;
    g.fillText(p.text, px, 0);
    px += g.measureText(p.text).width;
  }
  g.restore();
}

/** A sentence with its last two words in orange. */
function accented(line: string): Part[] {
  const words = line.split(' ');
  const cut = Math.max(0, words.length - 2);
  return [
    { text: words.slice(0, cut).join(' ') + (cut ? ' ' : ''), color: '#ffffff' },
    { text: words.slice(cut).join(' '), color: ORANGE },
  ];
}

/** The game's escape stamp: a red-orange box and letters, tilted, slammed down from 2.4×. */
function stamp(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, age: number, alpha: number, tilt = -8, maxW = W - 240) {
  if (age < 0 || alpha <= 0) return;
  const a = clamp(age / 0.5);
  const scale = 2.4 + (1 - 2.4) * back(a, 1.7);
  g.save();
  g.globalAlpha = alpha * smooth(a * 3);
  g.translate(x, y);
  g.rotate((tilt * Math.PI) / 180);
  g.font = `700 ${size}px ${DISPLAY}`;
  const spacing = size * 0.12;
  const chars = [...text];
  const w = chars.reduce((s, c) => s + g.measureText(c).width + spacing, -spacing);
  const fit = Math.min(1, maxW / (w + size * 0.6));
  g.scale(scale * fit, scale * fit);
  const padX = size * 0.3;
  const boxH = size * 1.12;
  const bx = -w / 2 - padX;
  const by = -boxH / 2;
  const bw = w + 2 * padX;
  g.lineWidth = size * 0.055;
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  roundRect(g, bx - 3, by - 3, bw + 6, boxH + 6, size * 0.14);
  g.stroke();
  g.fillStyle = 'rgba(255,245,235,0.1)';
  roundRect(g, bx, by, bw, boxH, size * 0.125);
  g.fill();
  g.strokeStyle = STAMP;
  g.stroke();
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  let px = -w / 2;
  for (const c of chars) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillText(c, px, size * 0.06 + 3);
    g.fillStyle = STAMP;
    g.fillText(c, px, size * 0.06);
    px += g.measureText(c).width + spacing;
  }
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** The PA's hello, as a lower third: a speaker badge and the words. */
function paLine(g: CanvasRenderingContext2D, text: string, t: number) {
  const a = env(t, 0.75, 2.62, 0.3, 0.2);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.translate(0, (1 - smooth((t - 0.75) / 0.4)) * 30);
  g.font = `italic 600 40px ${UI}`;
  const tw = g.measureText(text).width;
  const badge = 64;
  const w = tw + badge + 72;
  const x = (W - w) / 2;
  const y = H - 190;
  g.fillStyle = 'rgba(10,18,32,0.78)';
  roundRect(g, x, y, w, 88, 44);
  g.fill();
  // The speaker: the game's sound icon on an orange disc.
  g.fillStyle = ORANGE;
  g.beginPath();
  g.arc(x + 44 + 4, y + 44, 30, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(x + 48 - 13, y + 44 - 13);
  g.scale(26 / 24, 26 / 24);
  g.strokeStyle = '#fff';
  g.lineWidth = 2.2;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const d of ['M11 5 6 9H2v6h4l5 4Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14']) g.stroke(new Path2D(d));
  g.restore();
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(text, x + badge + 44, y + 46);
  g.restore();
}

/** The game's logo: the orange mark with its bars, the name, "3D" in orange. */
function logo(g: CanvasRenderingContext2D, t: number, t0: number) {
  const ma = clamp((t - t0) / 0.45);
  if (ma > 0) {
    const s = 150 * (0.4 + 0.6 * back(ma));
    g.save();
    g.globalAlpha = smooth(ma * 2.5);
    g.translate(W / 2, 330);
    g.shadowColor = 'rgba(217,83,10,0.8)';
    g.shadowBlur = 50;
    g.shadowOffsetY = 20;
    const grad = g.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    grad.addColorStop(0, ORANGE);
    grad.addColorStop(1, ORANGE_2);
    g.fillStyle = grad;
    roundRect(g, -s / 2, -s / 2, s, s, s * 0.3);
    g.fill();
    g.shadowColor = 'transparent';
    const k = (s * 0.52) / 24;
    g.translate(-12 * k, -12 * k);
    g.scale(k, k);
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke(new Path2D('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'));
    g.stroke(new Path2D('M8 3v18M12 3v18M16 3v18'));
    g.restore();
  }
  const ta = clamp((t - t0 - 0.18) / 0.5);
  if (ta > 0) {
    g.save();
    g.globalAlpha = smooth(ta * 2);
    g.translate(W / 2, 520);
    const s = 0.85 + 0.15 * back(ta);
    g.scale(s, s);
    heavy(g, [
      { text: 'Prison Escape ', color: '#ffffff' },
      { text: '3D', color: ORANGE },
    ], 0, 0, 170);
    g.restore();
  }
}

// ------------------------------------------------------------------ the frame
function frameAt(g: CanvasRenderingContext2D, lang: Lang, f: number, marks: Record<string, { at: number; end: number }>) {
  const t = f / FPS;
  const L = lang === 'en' ? en : fr;
  const own = OWN[lang];
  const end = marks.end.end;
  g.clearRect(0, 0, W, H);

  // In from black, out to black.
  const black = Math.max(1 - smooth(t / 0.45), smooth((t - (end - 0.6)) / 0.55));

  // 1. The PA's hello.
  paLine(g, L['pa.hello.center-perks.0'], t);

  // 2. The model prisoner (the tagline's first half), across the day.
  const [first, second] = L['title.tagline'].split(/(?<=\.)\s+/);
  {
    const t0 = marks.rollcall.at + 0.15;
    const t1 = marks.turn.at - 0.05;
    const a = env(t, t0, t1, 0.35, 0.15);
    if (a > 0) {
      g.save();
      g.globalAlpha = a;
      const rise = (1 - back((t - t0) / 0.5)) * 40;
      heavy(g, accented(first), W / 2, H - 170 + rise, 104);
      g.restore();
    }
  }

  // 3. The plan (its second half), slammed down on the beat.
  {
    const t0 = marks.vents.at;
    const a = env(t, t0, marks.vents.end - 0.04, 0.08, 0.12);
    if (a > 0) {
      g.save();
      g.globalAlpha = a;
      const s = 1.35 - 0.35 * back((t - t0) / 0.35);
      g.translate(W / 2, H / 2);
      g.scale(s, s);
      heavy(g, accented(second), 0, 0, 132);
      g.restore();
    }
  }

  // 4. One word a cut.
  WORD_CUTS.forEach((id, k) => {
    const m = marks[id];
    const a = env(t, m.at, m.end - 0.02, 0.05, 0.08);
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a;
    const s = 1.5 - 0.5 * back((t - m.at) / 0.25, 2.6);
    g.translate(W / 2, H / 2 + 20);
    g.rotate((k % 2 ? 3 : -3) * (Math.PI / 180));
    g.scale(s, s);
    heavy(g, [{ text: own.words[k], color: '#ffffff' }], 0, 0, 176);
    g.restore();
  });

  // 5. The five prisons: the line over them all, each name stamped like a file.
  {
    const t0 = marks['center-perks'].at;
    const t1 = marks.irongate.end - 0.05;
    const a = env(t, t0 + 0.05, t1, 0.3, 0.15);
    if (a > 0) {
      g.save();
      g.globalAlpha = a;
      heavy(g, ((x) => [{ text: `${x[0]} `, color: '#ffffff' }, { text: x[1], color: ORANGE }])(own.prisons.split(/(?<=\.)\s+/)), W / 2, 150 - (1 - smooth((t - t0) / 0.3)) * 30, 72);
      g.restore();
    }
    PRISONS.forEach((id) => {
      const m = marks[id];
      stamp(g, L[`prison.${id}` as keyof typeof L].toUpperCase(), W / 2, H / 2 + 60, 96, t - m.at - 0.12, env(t, m.at, m.end - 0.03, 0.01, 0.12), -6);
    });
  }

  // 6. The escape: the letterbox in as the glider leaves, the stamp as it touches down.
  const touch = TOUCHDOWN / FPS;
  {
    const t0 = marks.escape.at + 0.9;
    const bar = smooth((t - t0) / 0.6) * (1 - smooth((t - marks.end.at - 0.2) / 0.5)) * Math.round(H * 0.11);
    if (bar > 0) {
      g.fillStyle = '#05070b';
      g.fillRect(0, 0, W, bar);
      g.fillRect(0, H - bar, W, bar);
    }
    stamp(g, L['cinema.escaped'], W / 2, H * 0.3, 150, t - touch, env(t, touch, marks.escape.end - 0.02, 0.01, 0.15));
  }

  // 7. The end card: the picture dimmed, the logo, the tagline, where to play.
  {
    const t0 = marks.end.at;
    const dim = smooth((t - t0) / 0.5);
    if (dim > 0) {
      const v = g.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, W * 0.7);
      v.addColorStop(0, `rgba(8,14,26,${0.5 * dim})`);
      v.addColorStop(1, `rgba(3,6,12,${0.85 * dim})`);
      g.fillStyle = v;
      g.fillRect(0, 0, W, H);
      logo(g, t, t0 + 0.05);
      const ta = env(t, t0 + 1.1, end + 1, 0.4);
      if (ta > 0) {
        g.save();
        g.globalAlpha = ta;
        g.font = `500 46px ${DISPLAY}`;
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = 'rgba(5,10,20,0.7)';
        g.shadowBlur = 16;
        g.fillText(L['title.tagline'], W / 2, 655 + (1 - smooth((t - t0 - 1.1) / 0.4)) * 20);
        g.restore();
      }
      const ca = smooth((t - t0 - 2.0) / 0.35);
      if (ca > 0) {
        g.save();
        g.globalAlpha = ca;
        g.translate(W / 2, 790);
        const s = 0.9 + 0.1 * back((t - t0 - 2.0) / 0.4);
        g.scale(s, s);
        g.font = `700 40px ${UI}`;
        const w = g.measureText(own.cta).width + 88;
        const grad = g.createLinearGradient(0, -38, 0, 38);
        grad.addColorStop(0, ORANGE);
        grad.addColorStop(1, ORANGE_2);
        g.shadowColor = 'rgba(217,83,10,0.6)';
        g.shadowBlur = 30;
        g.shadowOffsetY = 10;
        g.fillStyle = grad;
        roundRect(g, -w / 2, -40, w, 80, 40);
        g.fill();
        g.shadowColor = 'transparent';
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(own.cta, 0, 2);
        g.restore();
      }
      const ua = smooth((t - t0 - 2.6) / 0.4);
      if (ua > 0) {
        g.save();
        g.globalAlpha = ua * 0.92;
        g.font = `600 36px ${UI}`;
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(URL_TEXT, W / 2, 900);
        g.restore();
      }
    }
  }

  // Flashes on the two big hits: the plan's first beat, the touchdown.
  const flash = Math.max(1 - smooth((t - marks.vents.at) / 0.18), 0) * (t >= marks.vents.at ? 0.55 : 0) + (t >= touch ? 0.45 * (1 - smooth((t - touch) / 0.2)) : 0);
  if (flash > 0) {
    g.fillStyle = `rgba(255,250,240,${flash})`;
    g.fillRect(0, 0, W, H);
  }
  if (black > 0) {
    g.fillStyle = `rgba(0,0,0,${black})`;
    g.fillRect(0, 0, W, H);
  }
}

function marksOf() {
  const marks: Record<string, { at: number; end: number }> = {};
  for (const c of timeline()) marks[c.id] = { at: c.from / FPS, end: (c.from + c.frames) / FPS };
  return marks;
}

async function canvas() {
  await Promise.all([`700 100px Fredoka`, `500 40px Fredoka`, `600 40px Inter`, `italic 600 40px Inter`, `700 40px Inter`].map((f) => document.fonts.load(f)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

async function send(name: string, c: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((done) => c.toBlob((b) => done(b!), 'image/png'));
  const res = await fetch(`${SINK}/?name=${name}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`${name}: the sink said ${res.status}`);
}

/** Every frame's text for a language: <lang>/NNNNN.png. */
export async function titles(lang: Lang) {
  const c = await canvas();
  const g = c.getContext('2d')!;
  const marks = marksOf();
  const tl = timeline();
  const n = tl[tl.length - 1].from + tl[tl.length - 1].frames;
  for (let f = 0; f < n; f++) {
    frameAt(g, lang, f, marks);
    await send(`${lang}/${String(f).padStart(5, '0')}.png`, c);
  }
  return n;
}

/** One frame's text, for a look: still-<lang>-<frame>.png. */
export async function still(lang: Lang, f: number) {
  const c = await canvas();
  frameAt(c.getContext('2d')!, lang, f, marksOf());
  await send(`still-${lang}-${f}.png`, c);
}
