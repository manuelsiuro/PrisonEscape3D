import * as THREE from 'three';
import type { World } from '../sim/world/World';
import { canvasTexture } from './canvas';
import { seeThrough } from './occlusion';

/** What the menu board (2.33) shows this frame. */
export interface MenuFrame {
  /** It shows the day's dishes (a run from before 2.33: the plain board, as it was). */
  on: boolean;
  /** Lit: the canteen has power. */
  lit: boolean;
  /** Its heading, breakfast's dish and dinner's, what each gives ("+45"). */
  title: string;
  dishes: string[];
  gives: string[];
  /** A scribble across it ('' clean). */
  joke: string;
}

/** What the water cooler (2.33) shows this frame. */
export interface CoolerFrame {
  /** Bumped by each cup begun (the player's, an inmate's): a bubble goes up the bottle. */
  sips: number;
}

/**
 * The board's face over the decor's dark board (render/decor.ts menuBoard): its size, hung from the board's top edge a
 * hair in front of it, its foot out from the wall so that it faces up the way the camera looks down.
 */
const FACE_H = 0.5;
const FACE_TOP = 1.25;
const FACE_Z = 0.075;
const TILT = 0.6;
/** Pixels a tile wide on the canvas. */
const PX = 256;

/**
 * The menu board's face (2.33): drawn on a canvas, laid over the decor's board on the canteen wall: the heading, the
 * day's two dishes with what each gives in yellow, and a scribble in pink chalk across it once there's one. Redrawn
 * only when what it says changes (a new day, a scribble, the language). Dimmed in a power cut.
 */
export class MenuBoardView {
  readonly group = new THREE.Group();
  private canvas: HTMLCanvasElement | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private readonly mat = seeThrough(new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }));
  private mesh: THREE.Mesh | null = null;
  private drawn = '';
  private width = 0;

  setWorld(world: World) {
    this.clear();
    const m = world.def.menu;
    if (!m || typeof document === 'undefined') return;
    this.width = Math.max(0.6, m.w - 0.4);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.width * PX);
    this.canvas.height = Math.round(FACE_H * PX);
    this.tex = canvasTexture(this.canvas, 'sharp');
    this.mat.map = this.tex;
    const g = new THREE.PlaneGeometry(this.width, FACE_H);
    g.translate(0, -FACE_H / 2, 0);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.position.set(m.x + m.w / 2, FACE_TOP, m.z + FACE_Z);
    this.mesh.rotation.x = -TILT;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    this.drawn = '';
  }

  update(f: MenuFrame) {
    if (!this.mesh || !this.canvas || !this.tex) return;
    this.mesh.visible = f.on;
    if (!f.on) return;
    this.mat.color.setScalar(f.lit ? 1 : 0.35);
    const key = JSON.stringify([f.title, f.dishes, f.gives, f.joke]);
    if (key === this.drawn) return;
    this.drawn = key;
    draw(this.canvas, f);
    this.tex.needsUpdate = true;
  }

  clear() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.group.remove(this.mesh);
    }
    this.tex?.dispose();
    this.mesh = null;
    this.tex = null;
    this.canvas = null;
    this.mat.map = null;
  }
}

/** The face: a chalkboard's heading and two lines, a scrawl over them. */
function draw(c: HTMLCanvasElement, f: MenuFrame) {
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width;
  const h = c.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#1f2a26';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 3;
  g.strokeRect(4, 4, w - 8, h - 8);
  const pad = Math.round(w * 0.05);
  g.textBaseline = 'middle';
  g.fillStyle = '#f2c94c';
  g.font = `900 ${Math.round(h * 0.24)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText(f.title.toUpperCase(), w / 2, h * 0.17, w - pad * 2);
  f.dishes.forEach((d, k) => {
    const y = h * (0.5 + k * 0.29);
    const gives = f.gives[k] ?? '';
    g.font = `800 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
    g.textAlign = 'right';
    g.fillStyle = '#f2c94c';
    g.fillText(gives, w - pad, y);
    const room = w - pad * 3 - g.measureText(gives).width;
    g.textAlign = 'left';
    g.fillStyle = '#f8f3e3';
    g.font = `700 ${Math.round(h * 0.21)}px system-ui, sans-serif`;
    g.fillText(d, pad, y, Math.max(20, room));
  });
  if (f.joke) {
    // A scrawl across it, at a slant, in pink chalk, the dinner line crossed out under it.
    g.strokeStyle = 'rgba(255,140,190,0.85)';
    g.lineWidth = Math.max(2, h * 0.02);
    g.beginPath();
    g.moveTo(pad, h * 0.77);
    g.lineTo(w - pad, h * 0.75);
    g.stroke();
    g.save();
    g.translate(w / 2, h * 0.6);
    g.rotate(-0.12);
    g.textAlign = 'center';
    g.font = `italic 800 ${Math.round(h * 0.22)}px "Comic Sans MS", "Chalkboard SE", cursive, sans-serif`;
    g.lineWidth = Math.max(3, h * 0.03);
    g.strokeStyle = 'rgba(20,24,22,0.85)';
    g.strokeText(f.joke, 0, 0, w * 0.94);
    g.fillStyle = '#ff9cc8';
    g.fillText(f.joke, 0, 0, w * 0.94);
    g.restore();
  }
}

/** A bubble's life going up the bottle (s), how many go up for a cup. */
const BUBBLE_SECS = 0.9;
const BUBBLES = 3;

/**
 * The water cooler's bottle (2.33): a few bubbles up through it for each cup begun. The cooler itself is the prop's
 * (render/props.ts). Nothing with reduced motion.
 */
export class CoolerView {
  readonly group = new THREE.Group();
  private readonly mat = seeThrough(new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.85, toneMapped: false }));
  private readonly geo = new THREE.SphereGeometry(0.028, 6, 4);
  private readonly bubbles: THREE.Mesh[] = [];
  private ages: number[] = [];
  private sips = -1;

  setWorld(world: World) {
    this.clear();
    const c = world.def.cooler;
    if (!c) return;
    this.group.position.set(c.x + 0.5, 0, c.z + 0.5);
    for (let k = 0; k < BUBBLES; k++) {
      const b = new THREE.Mesh(this.geo, this.mat);
      b.visible = false;
      this.bubbles.push(b);
      this.group.add(b);
    }
    this.ages = this.bubbles.map(() => Infinity);
    this.sips = -1;
  }

  update(f: CoolerFrame, dt: number, motion: boolean) {
    if (!this.bubbles.length) return;
    if (f.sips !== this.sips) {
      // (The first frame only learns where things stand.)
      if (this.sips >= 0 && motion) this.ages = this.bubbles.map((_, k) => -k * 0.22);
      this.sips = f.sips;
    }
    this.bubbles.forEach((b, k) => {
      const a = (this.ages[k] += dt);
      b.visible = a >= 0 && a < BUBBLE_SECS;
      if (!b.visible) return;
      const t = a / BUBBLE_SECS;
      b.position.set(Math.sin(t * 9 + k) * 0.035, 0.92 + t * 0.32, Math.cos(t * 7 + k) * 0.03);
      b.scale.setScalar(0.7 + t * 0.6);
    });
  }

  clear() {
    for (const b of this.bubbles) this.group.remove(b);
    this.bubbles.length = 0;
    this.ages = [];
  }
}
