import * as THREE from 'three';
import { seeded } from './rand';

const FLAKES = 700;
/** The box of air around the player that the flakes fill (tiles), and how high they start. */
const SPAN = 28;
const HIGH = 9;

/**
 * Falling snow (Stalag Flucht, P9): a fixed cloud of soft points around the player, drifting
 * down and sideways and wrapping round, so the weather follows wherever they go. Hidden
 * indoors-below (tunnels, vents) and with reduced motion. No allocation per frame.
 */
export class Snowfall {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly speed = new Float32Array(FLAKES);
  private readonly phase = new Float32Array(FLAKES);
  /** Where each flake is drawn (its place, or under the ground over a building). */
  private readonly drawn = new Float32Array(FLAKES * 3);

  constructor() {
    this.pos = new Float32Array(FLAKES * 3);
    // A fixed seed: the same snow every time.
    const rand = seeded(4242);
    for (let i = 0; i < FLAKES; i++) {
      this.pos[i * 3] = rand() * SPAN;
      this.pos[i * 3 + 1] = rand() * HIGH;
      this.pos[i * 3 + 2] = rand() * SPAN;
      this.speed[i] = 0.7 + rand() * 0.9;
      this.phase[i] = rand() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.drawn, 3).setUsage(THREE.DynamicDrawUsage));
    // The camera is orthographic: point sizes are in screen pixels.
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 3.2 * Math.min(2, globalThis.devicePixelRatio || 1), sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, map: flake(), alphaTest: 0.05 });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    // Over the fog veil (P17), like the rain: flakes fall in front of it.
    this.points.renderOrder = 6;
  }

  /**
   * A frame: flakes fall and sway; the cloud is kept centered on (cx, cz). `open(x, z)` says
   * whether snow falls on a tile (open sky): over a building it would fall through the cut-away
   * roof onto the floor, so those flakes are drawn under the ground instead, out of sight.
   */
  update(dt: number, time: number, cx: number, cz: number, on: boolean, open: (x: number, z: number) => boolean = () => true, wind = 0, windAngle = 0) {
    this.points.visible = on;
    if (!on) return;
    const x0 = cx - SPAN / 2;
    const z0 = cz - SPAN / 2;
    const p = this.pos;
    // The wind (P17): flakes driven sideways, faster in a blizzard.
    const fall = 1 + wind * 0.3;
    const gx = Math.cos(windAngle) * wind * 0.9;
    const gz = Math.sin(windAngle) * wind * 0.9;
    for (let i = 0; i < FLAKES; i++) {
      const k = i * 3;
      p[k + 1] -= this.speed[i] * fall * dt;
      p[k] += (0.25 + gx + Math.sin(time * 0.8 + this.phase[i]) * 0.3) * dt;
      p[k + 2] += (gz + Math.cos(time * 0.6 + this.phase[i]) * 0.15) * dt;
      if (p[k + 1] < 0) p[k + 1] += HIGH;
      // Wrapped into the box round the player (it moves with them).
      p[k] = x0 + ((((p[k] - x0) % SPAN) + SPAN) % SPAN);
      p[k + 2] = z0 + ((((p[k + 2] - z0) % SPAN) + SPAN) % SPAN);
      this.drawn[k] = p[k];
      this.drawn[k + 2] = p[k + 2];
      this.drawn[k + 1] = open(Math.floor(p[k]), Math.floor(p[k + 2])) ? p[k + 1] : -5;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** A soft round flake (a radial gradient on a small canvas). */
function flake(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
