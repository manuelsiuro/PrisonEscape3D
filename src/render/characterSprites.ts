/** The sprites over people's heads, drawn once on canvases and shared: sleep's Z, a knockout's stars, marks and badges. */
import * as THREE from 'three';
import { canvasTexture } from './canvas';

/** "Z" for sleepers, drawn once and shared. */
let zTexture: THREE.CanvasTexture | null = null;
export function sleepTexture(): THREE.CanvasTexture {
  if (zTexture) return zTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const draw = () => {
    g.clearRect(0, 0, 64, 64);
    g.font = '900 52px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(20, 30, 60, 0.85)';
    g.strokeText('Z', 32, 34);
    g.fillStyle = '#eaf2ff';
    g.fillText('Z', 32, 34);
  };
  draw();
  const tex = canvasTexture(c);
  zTexture = tex;
  // Made before the web font arrives (the player is built at startup): drawn again once it has.
  document.fonts?.load('900 52px Fredoka').then(() => {
    draw();
    tex.needsUpdate = true;
  }, () => {});
  return tex;
}

/** A little five-pointed star (knocked out: they circle the head). */
let starTexture: THREE.CanvasTexture | null = null;
export function koTexture(): THREE.CanvasTexture {
  if (starTexture) return starTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 12 : 28;
    const a = (k * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(32 + Math.cos(a) * r, 33 + Math.sin(a) * r);
  }
  g.closePath();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(60, 40, 0, 0.8)';
  g.stroke();
  g.fillStyle = '#ffd84a';
  g.fill();
  starTexture = canvasTexture(c);
  return starTexture;
}

/** "!" (red, spotted), "?" (orange, searching) and "$" (green, bribed: P15) over a guard's head, drawn once each. */
const markTextures = new Map<string, THREE.CanvasTexture>();
export function markTexture(ch: string): THREE.CanvasTexture {
  let t = markTextures.get(ch);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = ch === '!' ? '#ff3b30' : ch === '$' ? '#0a845a' : '#ff9f1a';
  g.strokeStyle = 'rgba(30, 10, 0, 0.85)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(48, 46, 36, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.font = '900 60px Fredoka, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(ch, 48, 50);
  t = canvasTexture(c);
  markTextures.set(ch, t);
  return t;
}

/**
 * Badges over inmates' heads (GDD §13.2: "!" and "$" over inmates): a favor on offer, one
 * done (hand it in), a merchant open for business, the letter the player carries for them,
 * a follower. Drawn shapes, not font glyphs, so they look the same everywhere.
 */
export type BadgeKind = '' | 'favor' | 'done' | 'shop' | 'mail' | 'ally';
const BADGE_COLORS: Record<Exclude<BadgeKind, ''>, string> = { favor: '#ffc23d', done: '#42c97a', shop: '#3fbf6f', mail: '#4aa3ff', ally: '#29b6c8' };
const badgeTextures = new Map<string, THREE.CanvasTexture>();
export function badgeTexture(kind: Exclude<BadgeKind, ''>): THREE.CanvasTexture {
  let t = badgeTextures.get(kind);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  // A rounded tag with a little point under it, like a speech bubble.
  g.fillStyle = BADGE_COLORS[kind];
  g.strokeStyle = 'rgba(10, 20, 30, 0.85)';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(14, 8, 68, 64, 18);
  g.moveTo(40, 72);
  g.lineTo(48, 86);
  g.lineTo(56, 72);
  g.fill();
  g.stroke();
  g.fillStyle = BADGE_COLORS[kind];
  g.fillRect(38, 62, 20, 10);
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (kind === 'favor' || kind === 'shop') {
    g.font = '900 52px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(kind === 'favor' ? '!' : '$', 48, 42);
  } else if (kind === 'done') {
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(31, 41);
    g.lineTo(43, 53);
    g.lineTo(65, 29);
    g.stroke();
  } else if (kind === 'mail') {
    g.fillRect(26, 25, 44, 32);
    g.strokeStyle = BADGE_COLORS.mail;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(28, 27);
    g.lineTo(48, 43);
    g.lineTo(68, 27);
    g.stroke();
  } else {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 11 : 24;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      g.lineTo(48 + Math.cos(a) * r, 42 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  t = canvasTexture(c);
  badgeTextures.set(kind, t);
  return t;
}
