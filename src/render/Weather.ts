import * as THREE from 'three';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../sim/world/World';
import { seeded } from './rand';

/** Rain drops in the box of air round the player (a storm uses them all). */
const DROPS = 900;
const SPAN = 40;
const HIGH = 10;
/** A drop at height h shows this much further up the screen than its spot on the ground (the camera's angle). */
const LIFT = 24 / 38;
/** Ripples on the ground where drops land. */
const RIPPLES = 80;

/** How the view sees the weather this frame. */
export interface WeatherView {
  /** The rain's box (tiles across): as wide as the view. */
  span: number;
  /** A lockdown's red, as it pulses now (0–1). */
  alarm: number;
  /** Up in the vents (the rooms below through a thinner veil), on the roofs (every roof out in the fog). */
  vents: boolean;
  roof: boolean;
  /** Where a point higher up shows on the ground, per unit of height (the camera's angle; the escape camera turns it). */
  lx: number;
  lz: number;
}

const DEFAULT_VIEW: WeatherView = { span: SPAN, alarm: 0, vents: false, roof: false, lx: 0, lz: LIFT };

/** What the weather looks like this frame (the play layer fills it from the day's plan). */
export interface WeatherFrame {
  /** 0 none, 1 rain, 2 a storm. */
  rain: number;
  /** 0 clear … 1 thick fog (eased by the view). */
  fog: number;
  /** A heatwave's sun is up: warm, hazy light. */
  heat: boolean;
  /** Where the wind blows to (radians in the view, 0 = +x) and how hard (0–3). */
  windAngle: number;
  windForce: number;
  /** Snow falls: a freezing prison (Stalag Flucht), or a Big Freeze Daily anywhere (P26). */
  snow: boolean;
}

/**
 * The weather (P17): rain streaks falling through the air round the player (slanted by the
 * wind, hidden over roofs), ripples where they land, and a veil of fog with a clear patch
 * round the player that drifts with the wind. Three draw calls at most, no allocation per
 * frame. With reduced motion nothing falls or drifts: the fog and the light still tell it.
 */
export class Weather {
  readonly group = new THREE.Group();
  private readonly streaks: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly seed: Float32Array;
  private readonly drawn: Float32Array;
  private readonly ripples: THREE.InstancedMesh;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly rippleAge = new Float32Array(RIPPLES);
  private readonly rippleAt = new Float32Array(RIPPLES * 2);
  private readonly rippleY = new Float32Array(RIPPLES);
  /** The rain's box (tiles across): as wide as the view. */
  private span = SPAN;
  private lx = 0;
  private lz = LIFT;
  /** The first frame of a game: the fog as it is. */
  private fresh = true;
  private rippleNext = 0;
  private rippleClock = 0;
  readonly fog: THREE.Mesh;
  private readonly fogMat: THREE.ShaderMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  /** The fog as drawn (eased toward the frame's). */
  private fogShown = 0;
  private rand: () => number;

  constructor() {
    this.rand = seeded(9137);
    this.pos = new Float32Array(DROPS * 3);
    this.seed = new Float32Array(DROPS);
    for (let i = 0; i < DROPS; i++) {
      this.pos[i * 3] = this.rand() * SPAN;
      this.pos[i * 3 + 1] = this.rand() * HIGH;
      this.pos[i * 3 + 2] = this.rand() * SPAN;
      this.seed[i] = 0.8 + this.rand() * 0.4;
    }
    this.drawn = new Float32Array(DROPS * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.drawn, 3).setUsage(THREE.DynamicDrawUsage));
    this.streaks = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xbfd4ea, transparent: true, opacity: 0.38, depthWrite: false }));
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streaks.renderOrder = 6;
    // Ripples: a thin ring each, fading out as it spreads (its own alpha per instance).
    const ring = new THREE.RingGeometry(0.07, 0.095, 18).rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(RIPPLES), 1).setUsage(THREE.DynamicDrawUsage);
    ring.setAttribute('fade', this.fade);
    const rippleMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      uniforms: { color: { value: new THREE.Color(0xe6f0fa) } },
      vertexShader: `attribute float fade; varying float vFade;
        void main() { vFade = fade; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vFade;
        void main() {
          gl_FragColor = vec4(color, 0.6 * vFade);
          #include <colorspace_fragment>
        }`,
    });
    this.ripples = new THREE.InstancedMesh(ring, rippleMat, RIPPLES);
    this.ripples.count = 0;
    this.ripples.frustumCulled = false;
    this.ripples.renderOrder = 2;
    this.rippleAge.fill(1);
    // The fog: one plane over the rooms, clear round the player, drifting cloud in it.
    this.fogMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        color: { value: new THREE.Color(0xc9d2db) },
        density: { value: 0 },
        center: { value: new THREE.Vector2() },
        clear: { value: new THREE.Vector2(3.2, 9) },
        drift: { value: new THREE.Vector2() },
        cloud: { value: cloudTexture() },
        // Where the ground is out in the open (1) or under a roof (0): the fog lies outdoors, a thin haze indoors.
        outdoor: { value: null as THREE.Texture | null },
        lift: { value: new THREE.Vector2() },
        indoor: { value: 0.18 },
      },
      vertexShader: `varying vec2 vXZ;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vXZ = w.xz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `uniform vec3 color; uniform float density; uniform vec2 center; uniform vec2 clear; uniform vec2 drift; uniform sampler2D cloud; uniform sampler2D outdoor; uniform vec2 lift; uniform float indoor;
        varying vec2 vXZ;
        void main() {
          float d = distance(vXZ, center);
          float a = smoothstep(clear.x, clear.y, d);
          float n = texture2D(cloud, vXZ / 22.0 + drift).r * 0.6 + texture2D(cloud, vXZ / 9.0 - drift * 1.7).r * 0.4;
          // The ground seen through this point of the veil (the camera looks down from the south).
          vec2 g = (vXZ - lift) / vec2(${MAP_W}.0, ${MAP_H}.0);
          float open = texture2D(outdoor, g).r;
          a *= density * (0.62 + 0.5 * n) * mix(indoor, 1.0, open);
          gl_FragColor = vec4(color, clamp(a, 0.0, 0.9));
          #include <colorspace_fragment>
        }`,
    });
    this.fog = new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), this.fogMat);
    this.fog.frustumCulled = false;
    this.fog.visible = false;
    // Under every marker drawn over the floor (cones, arrows, rings, the aim): they stay crisp in the fog.
    this.fog.renderOrder = 0.5;
    this.group.add(this.streaks, this.ripples, this.fog);
  }

  /**
   * A frame: the drops fall and wrap round (cx, cz), ripples spread, the fog follows. `ground`
   * gives the height rain lands at on a tile (a roof, the ground; -1 where none falls: under a
   * roof seen from below), `wet` whether rain ripples on it (hard ground: grass soaks it up); `y` is the floor the player is on,
   * `fogY` the height the veil hangs at; `night` (0–1) darkens the fog; `under`: in the tunnels, none of it.
   */
  update(f: WeatherFrame, dt: number, time: number, cx: number, cz: number, y: number, fogY: number, night: number, motion: boolean, under: boolean, ground: (x: number, z: number) => number, wet: (x: number, z: number) => boolean, v: WeatherView = DEFAULT_VIEW) {
    const raining = f.rain > 0 && !under;
    this.streaks.visible = raining && motion;
    this.span = Math.max(SPAN, Math.min(80, v.span));
    this.lx = v.lx;
    this.lz = v.lz;
    // A game just begun (a save loaded mid-fog): the weather as it is, not rolling in.
    if (this.fresh) {
      this.fresh = false;
      this.fogShown = f.fog;
    }
    if (this.streaks.visible) this.fall(f, dt, cx, cz, ground);
    this.ripple(raining && motion ? f.rain : 0, dt, cx, cz, ground, wet);
    // The fog eases in and out (the morning's burns off; the evening's rolls in); below ground it isn't there at all.
    this.fogShown += (f.fog - this.fogShown) * Math.min(1, dt * (motion ? 0.8 : 10));
    this.fog.visible = !under && this.fogShown > 0.01;
    if (this.fog.visible) {
      const u = this.fogMat.uniforms;
      // (Up in the vents, the rooms below show through a thinner veil; on the roofs every roof is out in it.)
      u.density.value = this.fogShown * (v.vents ? 0.45 : 1);
      u.indoor.value = v.roof ? 1 : 0.18;
      this.fog.position.set(cx, fogY, cz);
      // The clear patch where the player's feet are, seen through the veil from the camera's angle; the ground under each point of the veil likewise.
      (u.center.value as THREE.Vector2).set(cx + (fogY - y) * v.lx, cz + (fogY - y) * v.lz);
      (u.lift.value as THREE.Vector2).set(fogY * v.lx, fogY * v.lz);
      const wind = 0.004 + 0.006 * f.windForce;
      if (motion) (u.drift.value as THREE.Vector2).set(Math.cos(f.windAngle) * time * wind, Math.sin(f.windAngle) * time * wind);
      // Darker at night, and red in a lockdown's pulse like everything else.
      (u.color.value as THREE.Color).set(0xc9d2db).lerp(this.c.set(0x2a3340), night * 0.85).lerp(this.c.set(0xd23a2a), Math.min(0.6, v.alarm) * (1 - 0.6 * night));
    }
  }

  /** A prison: where its ground is out in the open (the fog's mask). */
  setWorld(world: World) {
    const data = new Uint8Array(MAP_W * MAP_H);
    const open = (x: number, z: number) => world.inside(x, z) && TILE_INFO[world.ground.kind[z * MAP_W + x]].outdoor;
    for (let i = 0; i < data.length; i++) {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      // Out in the open: no roof over it; a wall standing free in the yard (open ground on two opposite sides) too, or the fog would part along it.
      const roofed = world.layers[LAYER.ROOF].kind[i] !== TILE.EMPTY;
      const freeWall = (open(x - 1, z) && open(x + 1, z)) || (open(x, z - 1) && open(x, z + 1));
      data[i] = (TILE_INFO[world.ground.kind[i]].outdoor && !roofed) || freeWall ? 255 : 0;
    }
    const old = this.fogMat.uniforms.outdoor.value as THREE.Texture | null;
    old?.dispose();
    const tex = new THREE.DataTexture(data, MAP_W, MAP_H, THREE.RedFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.fogMat.uniforms.outdoor.value = tex;
    this.reset();
    this.fresh = true;
  }

  private fall(f: WeatherFrame, dt: number, cx: number, cz: number, ground: (x: number, z: number) => number) {
    const storm = f.rain >= 2;
    const n = storm ? DROPS : Math.round(DROPS * 0.6);
    (this.streaks.material as THREE.LineBasicMaterial).opacity = storm ? 0.55 : 0.42;
    this.streaks.geometry.setDrawRange(0, n * 2);
    // Slant: the wind pushes the drops sideways as they fall.
    const push = 0.12 + f.windForce * 0.16;
    const wx = Math.cos(f.windAngle) * push;
    const wz = Math.sin(f.windAngle) * push;
    const speed = storm ? 22 : 17;
    const len = storm ? 0.75 : 0.55;
    // The box sits a little south of the player: drops high up show further north on screen.
    const span = this.span;
    const x0 = cx - span / 2 + (HIGH / 2) * this.lx;
    const z0 = cz - span / 2 + (HIGH / 2) * this.lz;
    const p = this.pos;
    const d = this.drawn;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const v = speed * this.seed[i] * dt;
      p[k + 1] -= v;
      p[k] += wx * v;
      p[k + 2] += wz * v;
      if (p[k + 1] < 0) p[k + 1] += HIGH;
      p[k] = x0 + ((((p[k] - x0) % span) + span) % span);
      p[k + 2] = z0 + ((((p[k + 2] - z0) % span) + span) % span);
      const at = ground(Math.floor(p[k]), Math.floor(p[k + 2]));
      let top = at >= 0 ? at + p[k + 1] : -50;
      // Seen from the camera a drop high up stands over the ground further north: over a cut-away room there, it isn't drawn.
      // (Both ends of the streak.)
      if (top > 0 && (ground(Math.floor(p[k] - (top + len) * this.lx), Math.floor(p[k + 2] - (top + len) * this.lz)) < 0 || ground(Math.floor(p[k] - top * this.lx), Math.floor(p[k + 2] - top * this.lz)) < 0)) top = -50;
      const j = i * 6;
      d[j] = p[k];
      d[j + 1] = top;
      d[j + 2] = p[k + 2];
      d[j + 3] = p[k] - wx * len;
      d[j + 4] = top + len;
      d[j + 5] = p[k + 2] - wz * len;
    }
    (this.streaks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Rings spreading on open ground round the player, a few more a second in a storm. */
  private ripple(level: number, dt: number, cx: number, cz: number, ground: (x: number, z: number) => number, wet: (x: number, z: number) => boolean) {
    if (level > 0) {
      // As many a square tile wherever the view reaches (a wider view, more of them).
      const w = this.span * 0.75;
      const d = this.span * 0.55;
      this.rippleClock += dt * (level >= 2 ? 34 : 22) * ((w * d) / (22 * 16));
      while (this.rippleClock >= 1) {
        this.rippleClock -= 1;
        const x = cx + (this.rand() - 0.5) * w;
        const z = cz + (this.rand() - 0.5) * d;
        if (!wet(Math.floor(x), Math.floor(z))) continue;
        const k = this.rippleNext;
        this.rippleNext = (k + 1) % RIPPLES;
        this.rippleAt[k * 2] = x;
        this.rippleAt[k * 2 + 1] = z;
        this.rippleY[k] = Math.max(0, ground(Math.floor(x), Math.floor(z)));
        this.rippleAge[k] = 0;
      }
    }
    let n = 0;
    for (let k = 0; k < RIPPLES; k++) {
      if (this.rippleAge[k] >= 1) continue;
      this.rippleAge[k] = Math.min(1, this.rippleAge[k] + dt * 2.2);
      const a = this.rippleAge[k];
      const s = 1 + a * 2.6;
      this.m.makeScale(s, 1, s).setPosition(this.rippleAt[k * 2], this.rippleY[k] + 0.025, this.rippleAt[k * 2 + 1]);
      this.ripples.setMatrixAt(n, this.m);
      this.fade.setX(n, 1 - a);
      n++;
    }
    this.ripples.count = n;
    this.ripples.visible = n > 0;
    if (n) {
      this.ripples.instanceMatrix.needsUpdate = true;
      this.fade.needsUpdate = true;
    }
  }

  /** Shown for a moment while the renderer compiles their shaders (a new game), then hidden again. */
  warm(on: boolean) {
    for (const m of [this.streaks, this.ripples, this.fog]) m.visible = on;
    if (on) this.ripples.count = 1;
    else this.reset();
  }

  /** A new game (or the title): no fog left over, no ripples, nothing mid-flash. */
  reset() {
    this.fogShown = 0;
    this.fog.visible = false;
    this.rippleAge.fill(1);
    this.ripples.count = 0;
  }
}

/** Soft cloud: a few blurred blobs on a small tileable canvas (drawn wrapped). */
function cloudTexture(): THREE.Texture {
  const n = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, n, n);
  const rand = seeded(77);
  for (let k = 0; k < 26; k++) {
    const x = rand() * n;
    const z = rand() * n;
    const r = 14 + rand() * 30;
    const alpha = 0.35 + rand() * 0.25;
    for (const dx of [-n, 0, n])
      for (const dz of [-n, 0, n]) {
        const g = c.createRadialGradient(x + dx, z + dz, 0, x + dx, z + dz, r);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(x + dx - r, z + dz - r, r * 2, r * 2);
      }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
