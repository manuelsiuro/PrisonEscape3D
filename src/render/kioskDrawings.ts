/** The family's drawings pinned by the kiosk (P35): each one painted in crayon on a canvas, once, by its photo's id. */
import * as THREE from 'three';
import { PHOTOS } from '../content/kiosk';
import { seeded } from './rand';
import { canvasTexture } from './canvas';

/** A drawing's canvas (pixels: the paper's shape, Kiosk.ts's PAPER_W × PAPER_H). */
const DRAW_W = 128;
const DRAW_H = 98;

/** The drawings' pictures, one per PHOTOS id, drawn on first use (for every prison: never freed with a view). */
const drawings: Array<THREE.CanvasTexture | undefined> = [];
export function drawingTexture(k: number): THREE.CanvasTexture {
  let t = drawings[k];
  if (t) return t;
  const canvas = document.createElement('canvas');
  canvas.width = DRAW_W;
  canvas.height = DRAW_H;
  crayon(canvas.getContext('2d')!, PHOTOS[k] ?? 'sun', k);
  return (drawings[k] = canvasTexture(canvas, 'sharp'));
}

/**
 * A child's crayon drawing on a sheet of paper: wobbly strokes, colored in with loose scribbles
 * that stray over the lines. Each id its own picture (a fixed wobble: the same drawing every time).
 */
function crayon(c: CanvasRenderingContext2D, id: (typeof PHOTOS)[number], seed: number) {
  const rnd = seeded(1013904223 ^ (seed * 2654435761));
  const j = (n: number) => (rnd() - 0.5) * n;
  c.fillStyle = '#fbf7ec';
  c.fillRect(0, 0, DRAW_W, DRAW_H);
  c.lineCap = c.lineJoin = 'round';
  /** A wobbly line through points (each stroke drawn twice, a little apart: wax). */
  const line = (color: string, w: number, pts: number[], close = false) => {
    c.strokeStyle = color;
    c.lineWidth = w;
    for (let pass = 0; pass < 2; pass++) {
      c.globalAlpha = pass ? 0.55 : 0.9;
      c.beginPath();
      for (let i = 0; i < pts.length; i += 2) (i ? c.lineTo : c.moveTo).call(c, pts[i] + j(1.6), pts[i + 1] + j(1.6));
      if (close) c.closePath();
      c.stroke();
    }
    c.globalAlpha = 1;
  };
  /** A wobbly ring. */
  const ring = (color: string, w: number, x: number, y: number, rx: number, ry = rx) => {
    const pts: number[] = [];
    for (let a = 0; a <= 16; a++) pts.push(x + Math.cos((a / 16) * Math.PI * 2) * (rx + j(1.2)), y + Math.sin((a / 16) * Math.PI * 2) * (ry + j(1.2)));
    line(color, w, pts);
  };
  /** Colored in: back-and-forth strokes over a box, straying a little past it. */
  const scribble = (color: string, x0: number, y0: number, x1: number, y1: number, step = 2.6) => {
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.globalAlpha = 0.75;
    c.beginPath();
    for (let y = y0; y <= y1; y += step) {
      c.moveTo(x0 + j(3), y + j(1));
      c.lineTo(x1 + j(3), y + step * 0.6 + j(1));
    }
    c.stroke();
    c.globalAlpha = 1;
  };
  /** Colored in, round. */
  const blob = (color: string, x: number, y: number, rx: number, ry = rx) => {
    c.save();
    c.beginPath();
    c.ellipse(x, y, rx + 1.5, ry + 1.5, 0, 0, Math.PI * 2);
    c.clip();
    scribble(color, x - rx - 2, y - ry - 2, x + rx + 2, y + ry + 2, 2.2);
    c.restore();
  };
  const grass = () => {
    scribble('#5cb85c', 0, DRAW_H - 12, DRAW_W, DRAW_H, 3);
    line('#3d8b3d', 2.5, [0, DRAW_H - 12, 30, DRAW_H - 14, 70, DRAW_H - 11, DRAW_W, DRAW_H - 13]);
  };
  const sunCorner = () => {
    blob('#ffd23f', 112, 14, 9);
    for (let a = 0; a < 7; a++) {
      const r = (a / 7) * Math.PI + Math.PI / 2;
      line('#f5a623', 2, [112 + Math.cos(r) * 12, 14 + Math.sin(r) * 12, 112 + Math.cos(r) * 18, 14 + Math.sin(r) * 18]);
    }
  };
  /** A smile and two dot eyes. */
  const face = (x: number, y: number, r: number, color = '#2b2b2b') => {
    c.fillStyle = color;
    c.fillRect(x - r * 0.4, y - r * 0.25, 2, 2);
    c.fillRect(x + r * 0.25, y - r * 0.25, 2, 2);
    c.strokeStyle = color;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(x, y + r * 0.05, r * 0.45, 0.2 * Math.PI, 0.8 * Math.PI);
    c.stroke();
  };
  switch (id) {
    case 'house': {
      grass();
      sunCorner();
      // The chimney smoking, the red roof, the walls, a door and a window with its cross.
      scribble('#c0392b', 70, 24, 78, 36);
      line('#7a2a1e', 2, [70, 36, 70, 22, 78, 22, 78, 32]);
      for (let k = 0; k < 3; k++) ring('#9aa3ad', 1.6, 76 + k * 6, 15 - k * 5, 3 + k, 2.5 + k * 0.6);
      c.save();
      c.beginPath();
      c.moveTo(22, 46);
      c.lineTo(56, 22);
      c.lineTo(92, 46);
      c.closePath();
      c.clip();
      scribble('#e74c3c', 20, 20, 94, 48);
      c.restore();
      line('#a8322a', 2.5, [22, 46, 56, 22, 92, 46], true);
      scribble('#f6d58e', 28, 47, 86, 84, 3.4);
      line('#8a5a2e', 2.5, [28, 46, 28, 86, 86, 86, 86, 46]);
      scribble('#8a5a2e', 50, 64, 62, 86);
      line('#5a3a20', 2, [50, 86, 50, 64, 62, 64, 62, 86]);
      scribble('#6ec1ff', 68, 54, 80, 66);
      line('#2f6fd1', 2, [68, 54, 80, 54, 80, 66, 68, 66], true);
      line('#2f6fd1', 1.5, [74, 54, 74, 66]);
      line('#2f6fd1', 1.5, [68, 60, 80, 60]);
      break;
    }
    case 'dog': {
      grass();
      // A brown dog side on: the body, four stick legs, a big round head with a floppy ear, a wagging tail.
      blob('#b9783f', 58, 56, 26, 13);
      ring('#6b3f1e', 2.5, 58, 56, 26, 13);
      for (const x of [40, 50, 66, 76]) line('#6b3f1e', 3, [x, 66, x + j(3), 84]);
      blob('#c98a4d', 90, 40, 13);
      ring('#6b3f1e', 2.5, 90, 40, 13);
      blob('#6b3f1e', 84, 34, 4, 8);
      c.fillStyle = '#1a1a1a';
      c.fillRect(93, 36, 3, 3);
      c.fillRect(101, 42, 4, 3);
      line('#d23b2e', 2, [96, 47, 99, 51]);
      line('#6b3f1e', 3, [33, 52, 22, 40, 18, 34]);
      line('#d23b2e', 2.5, [74, 47, 84, 50]);
      break;
    }
    case 'family': {
      grass();
      sunCorner();
      // Everyone holding hands: dad, mum (a triangle dress), the kid, a little one; round heads, big smiles.
      const people: Array<[number, number, string, boolean]> = [
        [20, 1, '#2f6fd1', false],
        [48, 0.95, '#e0457b', true],
        [76, 0.75, '#3fa34d', false],
        [102, 0.6, '#f5a623', true],
      ];
      for (const [x, k, color, dress] of people) {
        const head = 82 - 52 * k;
        const r = 7 * Math.sqrt(k) + 1;
        blob('#f3c9a0', x, head, r);
        ring('#a0663c', 1.8, x, head, r);
        face(x, head, r);
        const top = head + r;
        const hip = top + 26 * k;
        if (dress) {
          c.save();
          c.beginPath();
          c.moveTo(x, top);
          c.lineTo(x - 9 * k, hip);
          c.lineTo(x + 9 * k, hip);
          c.closePath();
          c.clip();
          scribble(color, x - 10, top, x + 10, hip);
          c.restore();
          line(color, 2, [x, top, x - 9 * k, hip, x + 9 * k, hip], true);
        } else line(color, 3.5, [x, top, x, hip]);
        line('#333333', 2.5, [x - 2, hip, x - 6 * k, 86]);
        line('#333333', 2.5, [x + 2, hip, x + 6 * k, 86]);
      }
      // The hands held: one arm line from each to the next.
      for (let i = 0; i + 1 < people.length; i++) {
        const [xa, ka] = people[i];
        const [xb, kb] = people[i + 1];
        const ya = 82 - 52 * ka + 7 * Math.sqrt(ka) + 1 + 9 * ka;
        const yb = 82 - 52 * kb + 7 * Math.sqrt(kb) + 1 + 9 * kb;
        line('#f0b07a', 2.5, [xa, ya, (xa + xb) / 2, Math.max(ya, yb) + 4, xb, yb]);
      }
      line('#f0b07a', 2.5, [20, 47, 8, 58]);
      line('#f0b07a', 2.5, [102, 63, 116, 70]);
      break;
    }
    case 'sun': {
      // A big smiling sun filling the sheet, its rays all round, blue sky scribbled in the corners.
      scribble('#8fd0ff', 0, 0, 30, 22, 3.4);
      scribble('#8fd0ff', 98, 72, 128, 98, 3.4);
      for (let a = 0; a < 14; a++) {
        const r = (a / 14) * Math.PI * 2 + j(0.1);
        line(a % 2 ? '#f5a623' : '#ff7f2a', 3, [64 + Math.cos(r) * 31, 49 + Math.sin(r) * 31, 64 + Math.cos(r) * 45, 49 + Math.sin(r) * 45]);
      }
      blob('#ffd23f', 64, 49, 26);
      ring('#f5a623', 3, 64, 49, 26);
      blob('#ff9e7a', 52, 56, 4);
      blob('#ff9e7a', 76, 56, 4);
      c.fillStyle = '#3a2a10';
      c.fillRect(54, 40, 4, 5);
      c.fillRect(70, 40, 4, 5);
      c.strokeStyle = '#3a2a10';
      c.lineWidth = 2.5;
      c.beginPath();
      c.arc(64, 50, 12, 0.15 * Math.PI, 0.85 * Math.PI);
      c.stroke();
      break;
    }
    case 'boat': {
      sunCorner();
      // The sea in waves, a brown hull, the mast and its white sail, a gull or two.
      scribble('#3b8fd6', 0, 66, DRAW_W, DRAW_H, 3);
      const wave: number[] = [];
      for (let x = 0; x <= DRAW_W; x += 8) wave.push(x, 66 + (x / 8) % 2 * 4);
      line('#1f5f9e', 2.5, wave);
      c.save();
      c.beginPath();
      c.moveTo(30, 58);
      c.lineTo(98, 58);
      c.lineTo(86, 74);
      c.lineTo(42, 74);
      c.closePath();
      c.clip();
      scribble('#9b5a2e', 28, 56, 100, 76);
      c.restore();
      line('#5a3a20', 2.5, [30, 58, 98, 58, 86, 74, 42, 74], true);
      line('#5a3a20', 3, [64, 58, 64, 14]);
      c.save();
      c.beginPath();
      c.moveTo(66, 16);
      c.lineTo(94, 52);
      c.lineTo(66, 52);
      c.closePath();
      c.clip();
      scribble('#f4f4f4', 64, 14, 96, 54);
      c.restore();
      line('#e74c3c', 2, [66, 16, 94, 52, 66, 52], true);
      line('#e74c3c', 2, [64, 14, 52, 18, 64, 22]);
      line('#333333', 1.8, [20, 26, 25, 22, 30, 26, 35, 22, 40, 26]);
      line('#333333', 1.8, [96, 32, 100, 29, 104, 32]);
      break;
    }
    case 'rocket': {
      // Night: a dark sky scribbled in, stars, the moon; the rocket going up on its flames, a round window.
      scribble('#24305e', 0, 0, DRAW_W, DRAW_H, 2.4);
      // (The crescent: a full moon, a bite of sky out of it.)
      c.fillStyle = '#ffe27a';
      c.beginPath();
      c.arc(100, 20, 13, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2c3868';
      c.beginPath();
      c.arc(107, 14, 11, 0, Math.PI * 2);
      c.fill();
      for (const [x, y] of [
        [16, 14],
        [40, 30],
        [24, 70],
        [84, 54],
        [112, 80],
        [60, 10],
      ]) {
        line('#ffe27a', 2, [x - 3, y, x + 3, y]);
        line('#ffe27a', 2, [x, y - 3, x, y + 3]);
      }
      c.save();
      c.translate(56, 54);
      c.rotate(0.5);
      c.beginPath();
      c.moveTo(0, -30);
      c.quadraticCurveTo(12, -14, 10, 18);
      c.lineTo(-10, 18);
      c.quadraticCurveTo(-12, -14, 0, -30);
      c.fillStyle = '#e4e8ee';
      c.fill();
      c.save();
      c.clip();
      scribble('#c4ccd8', -14, -32, 14, 20, 4);
      c.restore();
      line('#9aa3ad', 2.5, [0, -30, 9, -12, 10, 18, -10, 18, -9, -12], true);
      blob('#e74c3c', 0, -22, 5, 6);
      blob('#e74c3c', -14, 14, 5, 7);
      blob('#e74c3c', 14, 14, 5, 7);
      blob('#6ec1ff', 0, -2, 5);
      ring('#2f6fd1', 2, 0, -2, 5);
      blob('#ff9e2a', 0, 28, 7, 9);
      blob('#ffe27a', 0, 26, 3, 5);
      c.restore();
      break;
    }
    case 'flowers': {
      // A pot of flowers on the sill: three stems, leaves, round flowers with their petals and middles.
      scribble('#c8e6ff', 0, 0, DRAW_W, 70, 4);
      for (const [x, top, color] of [
        [42, 28, '#e74c3c'],
        [64, 18, '#f5a623'],
        [86, 30, '#b04ad6'],
      ] as const) {
        line('#3d8b3d', 3, [64 + (x - 64) * 0.3, 70, x, top]);
        blob('#5cb85c', (x + 64) / 2 - 6, (top + 70) / 2 + 6, 6, 3);
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          blob(color, x + Math.cos(a) * 8, top + Math.sin(a) * 8, 5);
        }
        blob('#ffd23f', x, top, 4.5);
      }
      c.save();
      c.beginPath();
      c.moveTo(44, 68);
      c.lineTo(84, 68);
      c.lineTo(78, 92);
      c.lineTo(50, 92);
      c.closePath();
      c.clip();
      scribble('#c8673a', 42, 66, 86, 94);
      c.restore();
      line('#8a3f1e', 2.5, [42, 68, 86, 68, 78, 92, 50, 92], true);
      line('#8a3f1e', 2.5, [44, 74, 84, 74]);
      break;
    }
    case 'cat': {
      // The cat asleep on its cushion: curled up round, its tail wrapped round, ears up, eyes shut, Zzz.
      blob('#b24a6b', 64, 78, 46, 12);
      ring('#7a2a46', 2, 64, 78, 46, 12);
      blob('#f39c3d', 60, 60, 30, 18);
      ring('#a85a1a', 2.5, 60, 60, 30, 18);
      for (let k = 0; k < 3; k++) line('#a85a1a', 2, [48 + k * 10, 46, 46 + k * 10, 54]);
      blob('#f7b366', 86, 56, 13, 11);
      ring('#a85a1a', 2.5, 86, 56, 13, 11);
      line('#a85a1a', 2.5, [77, 48, 79, 37, 85, 46]);
      line('#a85a1a', 2.5, [89, 46, 95, 37, 97, 49]);
      c.strokeStyle = '#3a2a10';
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(81, 56, 3, 0, Math.PI);
      c.moveTo(94, 56);
      c.arc(91, 56, 3, 0, Math.PI);
      c.stroke();
      blob('#ff8fa3', 86, 62, 2);
      line('#a85a1a', 4, [32, 66, 36, 76, 60, 78, 78, 70]);
      c.fillStyle = '#2f6fd1';
      c.font = 'bold 14px sans-serif';
      c.fillText('z', 100, 34);
      c.font = 'bold 18px sans-serif';
      c.fillText('Z', 108, 22);
      break;
    }
  }
}
