import * as THREE from 'three';
import { SIGHT_HALF_ANGLE, SIGHT_RANGE, sightReach } from '../sim/ai/sight';
import { ALERT } from '../sim/systems/guards';
import { UNIT } from '../sim/tuning';
import type { World } from '../sim/world/World';

/** Rays per cone: enough for walls to cut clean edges. */
const RAYS = 28;
const RANGE = SIGHT_RANGE / UNIT;
/** Yellow (calm), orange (investigating), red (chasing): GDD §5.1. */
const COLORS: Record<number, number> = { [ALERT.CALM]: 0xffe066, [ALERT.SUSPICIOUS]: 0xff9a2e, [ALERT.HOSTILE]: 0xff3b30 };

/** Brighter near the guard, fading out toward the edge of sight (a 1D gradient along v). */
let fadeTexture: THREE.CanvasTexture | null = null;
function fade(): THREE.CanvasTexture {
  if (fadeTexture) return fadeTexture;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  fadeTexture = new THREE.CanvasTexture(c);
  fadeTexture.colorSpace = THREE.SRGBColorSpace;
  return fadeTexture;
}

export interface ConeFrame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z (the view's convention). */
  facing: number;
  /** ALERT (sim/systems/guards.ts): NONE hides the cone. */
  alert: number;
  /** Bribed to look the other way (P15): a calm cone in green, fainter, breathing. */
  away?: boolean;
  /** Steps of looking away left: over the last ENDING the cone pulses back toward yellow. */
  awayLeft?: number;
  /** How far it sees now (tiles; P17: the weather, the inspectors). The cone's own range by default. */
  range?: number;
}

/** A bribed guard's calm cone (P15): emerald, apart from the cameras' cyan and the calm yellow. */
const AWAY = 0x34d399;
/** The last 10 game minutes of a bribe (steps). */
const ENDING = 200;

/** Vertices per cone: the guard, then the end of each ray. */
const VERTS = RAYS + 2;

interface Cone {
  /** Its first vertex in the shared buffers. */
  first: number;
  /** The angle drawn (eased toward the guard's heading) and the color. */
  angle: number;
  color: THREE.Color;
  /** Its opacity before night and fading (eased with the color), and a brief flare as it comes on. */
  strength: number;
  flash: number;
  shown: number;
  /** The range drawn (tiles), eased toward the guard's. */
  range: number;
}

/**
 * Guards' vision cones on the floor (GDD §5.1): a fan of rays from each guard, each cut
 * where sight stops (walls, shut doors; the same test the rules use), tinted by alert.
 * Every cone is a stretch of one mesh (one draw call for them all), its tint and strength
 * in the vertices' colors; buffers are made once per count and refilled every frame. The
 * angle eases so a guard glancing around sweeps its cone instead of snapping it.
 */
export class Cones {
  readonly group = new THREE.Group();
  private cones: Cone[] = [];
  private mesh: THREE.Mesh | null = null;
  private readonly material = new THREE.MeshBasicMaterial({ map: fade(), vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, side: THREE.DoubleSide });
  private positions = new Float32Array(0);
  private uvs = new Float32Array(0);
  /** RGBA per vertex: the cone's tint, and its opacity in alpha. */
  private colorsOf = new Float32Array(0);
  world: World | null = null;
  private readonly range: number;
  private readonly colors: Record<number, number>;
  private readonly goal = new THREE.Color();
  private readonly calm = new THREE.Color();
  private clock = 0;

  /** Guards' cones by default; cameras see less far and in their own colors. */
  constructor(opts: { range?: number; colors?: Record<number, number> } = {}) {
    this.range = opts.range ?? RANGE;
    this.colors = { ...COLORS, ...opts.colors };
  }

  /** One cone per guard. */
  setCount(n: number) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.cones = [];
    if (!n) return;
    this.positions = new Float32Array(n * VERTS * 3);
    this.uvs = new Float32Array(n * VERTS * 2);
    this.colorsOf = new Float32Array(n * VERTS * 4);
    const index: number[] = [];
    for (let k = 0; k < n; k++) {
      const o = k * VERTS;
      for (let r = 0; r < RAYS; r++) index.push(o, o + r + 2, o + r + 1);
      this.cones.push({ first: o, angle: NaN, color: new THREE.Color(), strength: 0.32, flash: 0, shown: 0, range: NaN });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colorsOf, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(index);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.renderOrder = 1;
    // (Spread over the whole map, refilled every frame.)
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.group.add(mesh);
    this.mesh = mesh;
  }

  /** Redraws every cone; `night` (0–1) makes them a little stronger in the dark. */
  update(guards: readonly ConeFrame[], dt: number, night: number, motion: boolean) {
    const w = this.world;
    this.clock += dt;
    let any = false;
    this.cones.forEach((c, k) => {
      const g = guards[k];
      const on = !!g && !!w && g.alert !== ALERT.NONE;
      const was = c.shown;
      // Back on (woken, come round): a brief flare, quicker in (not as a game starts).
      if (on && was < 0.05 && motion && this.clock > 1) c.flash = 1;
      c.flash = Math.max(0, c.flash - dt * 3);
      c.shown += ((on ? 1 : 0) - c.shown) * Math.min(1, dt * (c.flash > 0 ? 10 : 6));
      const p = this.positions;
      const uv = this.uvs;
      const o = c.first;
      if (c.shown <= 0.02 || !g || !w) {
        // Not drawn: folded to a point (no area, nothing to fill).
        p.fill(0, o * 3, (o + VERTS) * 3);
        return;
      }
      any = true;
      // Ease toward the heading the short way round (in the sim's angle: 0 = +x).
      const goal = Math.PI / 2 - g.facing;
      if (Number.isNaN(c.angle) || !motion) c.angle = goal;
      else {
        const d = Math.atan2(Math.sin(goal - c.angle), Math.cos(goal - c.angle));
        c.angle += d * Math.min(1, dt * 18);
      }
      p[o * 3] = g.x;
      p[o * 3 + 1] = 0.05;
      p[o * 3 + 2] = g.z;
      uv[o * 2] = 0.5;
      uv[o * 2 + 1] = 1;
      // As far as it sees now: the cone drawn is the rule (sight.ts sightReach, calendar.ts sightOf),
      // eased when it changes (a guard stepping out into the fog), at once with reduced motion.
      const want = g.range ?? this.range;
      // (Growing, at once: a cone never shows less than the guard sees. Shrinking, eased.)
      if (Number.isNaN(c.range) || !motion || was < 0.05 || want > c.range) c.range = want;
      else c.range += (want - c.range) * Math.min(1, dt * 5);
      const range = c.range;
      for (let r = 0; r <= RAYS; r++) {
        const a = c.angle - SIGHT_HALF_ANGLE + (2 * SIGHT_HALF_ANGLE * r) / RAYS;
        const reach = sightReach(w, g.x, g.z, a, range);
        const v = o + r + 1;
        p[v * 3] = g.x + Math.cos(a) * reach;
        p[v * 3 + 1] = 0.05;
        p[v * 3 + 2] = g.z + Math.sin(a) * reach;
        uv[v * 2] = 0.5;
        uv[v * 2 + 1] = 1 - reach / range;
      }
      // An alarm snaps on (easing yellow to red would pass through orange: "suspicious"); calm
      // and looking away ease into each other. A bribed cone breathes (a cue beyond color) and
      // over its last minutes pulses back toward the calm yellow (still: half way). Fading out
      // (asleep, out cold) it keeps its last color and strength.
      if (on) {
        const away = !!g.away && g.alert === ALERT.CALM;
        const ending = away && (g.awayLeft ?? ENDING) < ENDING;
        this.goal.setHex(away ? AWAY : (this.colors[g.alert] ?? this.colors[ALERT.CALM]));
        if (ending) this.goal.lerp(this.calm.setHex(this.colors[ALERT.CALM]), motion ? 0.5 + 0.5 * Math.sin(this.clock * Math.PI * 2.4) : 0.5);
        const breath = away && motion ? 0.7 + 0.3 * Math.sin(this.clock * 2 + k) : 1;
        const strength = g.alert === ALERT.HOSTILE ? 0.44 : g.alert === ALERT.SUSPICIOUS ? 0.38 : away ? 0.26 * breath : 0.32;
        if (was < 0.05 || !motion || g.alert === ALERT.HOSTILE || g.alert === ALERT.SUSPICIOUS) {
          c.color.copy(this.goal);
          c.strength = strength;
        } else {
          const e = Math.min(1, dt * (ending ? 14 : 6));
          c.color.lerp(this.goal, e);
          c.strength += (strength - c.strength) * e;
        }
      }
      const alpha = c.shown * (c.strength + night * 0.12) * (1 + 0.8 * c.flash);
      const col = this.colorsOf;
      for (let v = o; v < o + VERTS; v++) {
        col[v * 4] = c.color.r;
        col[v * 4 + 1] = c.color.g;
        col[v * 4 + 2] = c.color.b;
        col[v * 4 + 3] = alpha;
      }
    });
    if (!this.mesh) return;
    this.mesh.visible = any;
    if (!any) return;
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.setCount(0);
    this.material.dispose();
  }
}
