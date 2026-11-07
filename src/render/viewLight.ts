import * as THREE from 'three';
import { LAYER } from '../sim/world/World';
import type { WeatherFrame } from './Weather';

// The light of play (out of View.ts, v2.34.2): the sun over the day, the sky behind, the weather's
// grey, fog and haze, lightning, the lockdown's red and the layers' gloom.

/** Light by time of day: [minute, sun intensity, sun color, ambient intensity, sky color]. */
const DAYLIGHT: Array<[number, number, number, number, number]> = [
  [0, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
  [300, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
  [390, 1.4, 0xffc58a, 0.85, 0x6b8fb8],
  [480, 2.3, 0xfff1dc, 1.05, 0x9cc3e6],
  [1080, 2.3, 0xfff1dc, 1.05, 0x9cc3e6],
  [1170, 1.3, 0xff9a5c, 0.8, 0x5f6f9a],
  [1260, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
  [1440, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
];

/**
 * The pine forest's light (2.36, the Six Hunter): the same day, its colours a valley's: a low golden sun through the
 * pines morning and evening, a misty teal sky and fill by day, moss in the bounce. [minute, sun color, sky color] at
 * DAYLIGHT's minutes; the sun a touch softer (FOREST_SUN), so the light reads as under trees.
 */
const FOREST_DAY: Array<[number, number, number]> = [
  [0, 0x8aa2ff, 0x0a1620],
  [300, 0x8aa2ff, 0x0a1620],
  [390, 0xffb46a, 0x6a96a0],
  [480, 0xffe4b4, 0x94bcc0],
  [1080, 0xffdca4, 0x94bcc0],
  [1170, 0xff8a48, 0x5a6c88],
  [1260, 0x8aa2ff, 0x0a1620],
  [1440, 0x8aa2ff, 0x0a1620],
];
const FOREST_SKY_LIGHT = 0xd4ebe6;
const FOREST_GROUND_LIGHT = 0x3e5434;
const FOREST_SUN = 0.92;

/** The ambient light's sky color. */
const SKY_LIGHT = 0xdfe8ff;
/** The ambient light's ground color (the bounce off the grass). */
const GROUND_LIGHT = 0x4a5a3a;
/**
 * Moonlight (session 14, the picture review): at night the ambient's sky turns moon-blue and its bounce a
 * dark slate, so the night reads as night (the grass no longer a dimmed noon green) and the warm lamp pools
 * and the lit rooms stand out of it; MOON_LIFT keeps it about as bright as before, so nothing goes black.
 */
const MOON_SKY = 0xb8c8ff;
const MOON_GROUND = 0x262c3c;
const MOON_LIFT = 0.37;
/** How much of the sun's shadow the rain's cloud takes away, a storm's more, the fog's (session 14). */
const OVERCAST_SHADOW = 0.4;
const STORM_SHADOW = 0.2;
const FOG_SHADOW = 0.3;
/** A heatwave's ambient: the day warmed and bleached (session 14). */
const HEAT_LIGHT = 0xffd49a;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

export class Lighting {
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly ambient = new THREE.HemisphereLight(SKY_LIGHT, GROUND_LIGHT, 1);
  /** The scene's background. */
  readonly sky = new THREE.Color();
  /** 0 by day … 1 at night (the last frame's light). */
  night = 0;
  /** The lockdown's red (0–1), eased by the view. */
  alarm = 0;
  /** The weather's light this frame (the title has none). */
  weather: WeatherFrame | null = null;
  /** The weather's light as drawn: eased toward the frame's (P17). */
  private readonly eased = { grey: 0, storm: 0, fog: 0, heat: 0 };
  private fresh = true;
  /** A lightning flash easing away. */
  private flash = 0;
  private readonly c1 = new THREE.Color();
  private readonly c2 = new THREE.Color();
  private readonly red = new THREE.Color(0xff2a1a);
  /** The ambient's sky color before the lockdown's red: day's, toward the moon's at night. */
  private readonly skyLight = new THREE.Color();
  private readonly lightBasis = new THREE.Matrix4();
  private readonly lightInverse = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  /** The prison's look's light (the forest's colours; every other prison's as it always was). */
  private forest = false;

  /** The look of the prison now shown (2.36: the forest has its own light). */
  setTheme(theme: string | undefined) {
    this.forest = theme === 'forest';
  }

  constructor() {
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
  }

  /** A new prison: no flash left over, and the first frame takes the weather as it is (a save loaded in fog isn't clear for its first seconds). */
  newWorld() {
    this.flash = 0;
    this.fresh = true;
  }

  /** A replay's jump in time (P25): the weather shown as it is at once, not eased in from the moment before. */
  jumped() {
    this.fresh = true;
  }

  /** A bolt of lightning (P17): the scene flashes white. */
  lightning() {
    this.flash = 1;
  }

  /**
   * The lights for a moment of the day on a layer: the daylight, then the weather (a lockdown's red
   * pulses through a storm's grey, not washed out by it), then the gloom off the ground floor.
   * Returns 0 in full daylight, 1 at night.
   */
  update(minute: number, dt: number, time: number, layer: number, reducedMotion: boolean): number {
    const night = (this.night = this.daylight(minute));
    // Moonlight: the ambient blue and its bounce dark as the night falls, out in the open only (the
    // ground floor, the roofs): the vents and the tunnels keep their own light.
    const moon = layer === LAYER.VENTS || layer === LAYER.UNDER ? 0 : night;
    this.skyLight.set(this.forest ? FOREST_SKY_LIGHT : SKY_LIGHT).lerp(this.c1.set(MOON_SKY), moon);
    this.ambient.groundColor.set(this.forest ? FOREST_GROUND_LIGHT : GROUND_LIGHT).lerp(this.c1.set(MOON_GROUND), moon);
    this.ambient.intensity *= 1 + MOON_LIFT * moon;
    this.weatherLight(dt, reducedMotion);
    if (this.alarm > 0.001) {
      // Lockdown: the light swings red in slow pulses, like a rotating beacon.
      const a = this.alarmPulse(time, reducedMotion);
      this.ambient.color.copy(this.skyLight).lerp(this.red, a);
      this.sky.lerp(this.red, a * 0.35);
      this.sun.intensity *= 1 - 0.35 * this.alarm;
    } else this.ambient.color.copy(this.skyLight);
    // Off the ground floor: the vents dim the rooms below; the tunnels are dark but for the lantern.
    if (layer === LAYER.VENTS) {
      this.sun.intensity *= 0.22;
      this.ambient.intensity *= 0.32;
    } else if (layer === LAYER.UNDER) {
      // Dim, but the map above (tinted on the earth) still reads; the lantern warms the trench.
      this.sun.intensity = 0.55;
      this.ambient.intensity = 0.85;
      this.sky.set(0x120c08);
    }
    return night;
  }

  /** Sets the lights for a time of day; returns 0 in full daylight, 1 at night. */
  private daylight(minute: number): number {
    let k = 1;
    while (k < DAYLIGHT.length - 1 && DAYLIGHT[k][0] < minute) k++;
    const a = DAYLIGHT[k - 1];
    const b = DAYLIGHT[k];
    const f = THREE.MathUtils.clamp((minute - a[0]) / Math.max(1, b[0] - a[0]), 0, 1);
    this.sun.intensity = THREE.MathUtils.lerp(a[1], b[1], f);
    this.sun.color.copy(this.c1.set(a[2]).lerp(this.c2.set(b[2]), f));
    this.ambient.intensity = THREE.MathUtils.lerp(a[3], b[3], f);
    this.sky.copy(this.c1.set(a[4]).lerp(this.c2.set(b[4]), f));
    this.sun.shadow.intensity = 1;
    const night = THREE.MathUtils.clamp(1 - (this.sun.intensity - 0.3) / (2.3 - 0.3), 0, 1);
    if (this.forest) {
      const fa = FOREST_DAY[k - 1];
      const fb = FOREST_DAY[k];
      this.sun.color.copy(this.c1.set(fa[1]).lerp(this.c2.set(fb[1]), f));
      this.sky.copy(this.c1.set(fa[2]).lerp(this.c2.set(fb[2]), f));
      this.sun.intensity *= FOREST_SUN;
    }
    return night;
  }

  /** Lockdown: the red light's share now, swinging in slow pulses like a rotating beacon (steady with reduced motion). */
  alarmPulse(time: number, reducedMotion: boolean): number {
    const pulse = reducedMotion ? 0.5 : (Math.sin(time * 5) + 1) / 2;
    return this.alarm * (0.25 + pulse * 0.45);
  }

  /**
   * The weather's light (P17): rain and storms dim and grey the day, fog softens it, a
   * heatwave warms it to a haze; lightning flashes it white for an instant.
   */
  private weatherLight(dt: number, reducedMotion: boolean) {
    const w = this.weather;
    // Each part eases in and out (the fog lifting, a storm rolling in at 08:00), at once with reduced motion.
    const k = reducedMotion || (this.fresh && w) ? 1 : Math.min(1, dt * 0.8);
    if (w) this.fresh = false;
    const g = this.eased;
    g.grey += ((w ? (w.rain >= 2 ? 0.65 : w.rain ? 0.45 : 0) : 0) - g.grey) * k;
    g.storm += ((w && w.rain >= 2 ? 1 : 0) - g.storm) * k;
    g.fog += ((w ? w.fog : 0) - g.fog) * k;
    // (The heat's haze goes with the daylight.)
    g.heat += ((w?.heat ? 1 - this.night : 0) - g.heat) * k;
    if (g.grey > 0.002) {
      const rain = g.grey / 0.45;
      const sun = 1 - Math.min(1, rain) * 0.4 - g.storm * 0.22;
      this.sun.intensity *= sun;
      this.ambient.intensity *= 1 - Math.min(1, rain) * 0.14 - g.storm * 0.14;
      this.sky.lerp(this.c1.set(0x4a5462), g.grey);
      this.sun.color.lerp(this.c1.set(0xc6d2e2), g.grey * 0.6);
      // (Session 14: under cloud the sun's shadows go soft and faint, not noon-crisp in the rain.)
      this.sun.shadow.intensity -= Math.min(1, rain) * OVERCAST_SHADOW + g.storm * STORM_SHADOW;
    }
    if (g.fog > 0.002) {
      this.sun.intensity *= 1 - 0.25 * g.fog;
      this.sun.shadow.intensity -= FOG_SHADOW * g.fog;
      this.sky.lerp(this.c1.set(0x9aa6b2), 0.6 * g.fog * (1 - this.night));
    }
    if (g.heat > 0.002) {
      this.sun.intensity *= 1 + 0.08 * g.heat;
      this.sun.color.lerp(this.c1.set(0xffc27a), 0.4 * g.heat);
      // (Session 14: the whole scene warmed and bleached, not only the sun and the sky the camera hardly sees.)
      this.skyLight.lerp(this.c1.set(HEAT_LIGHT), 0.45 * g.heat);
      this.ambient.intensity *= 1 + 0.12 * g.heat;
      this.sky.lerp(this.c1.set(0xe8c79a), 0.35 * g.heat);
    }
    if (this.flash > 0.001) {
      this.ambient.intensity += this.flash * 2.6;
      this.sky.lerp(this.c1.set(0xe8f0ff), this.flash * 0.7);
      this.flash = Math.max(0, this.flash - dt * 5);
    }
  }

  /**
   * The sun swings east to west over the day; its shadow box follows the camera's target, snapped
   * to whole shadow-map texels so shadow edges don't shimmer as the camera glides.
   */
  placeSun(minute: number, target: THREE.Vector3, shadowHalf: number) {
    const angle = ((minute - 720) / 720) * Math.PI * 0.6;
    // Never straight overhead: a western bias keeps shadows on the floor the camera sees.
    const offset = this.v.set(-Math.sin(angle) * 26 - 9, 40, 9);
    this.lightBasis.lookAt(offset, ORIGIN, UP);
    this.lightInverse.copy(this.lightBasis).invert();
    const texel = (shadowHalf * 2) / Math.max(1, this.sun.shadow.mapSize.x);
    const p = this.p.copy(target).applyMatrix4(this.lightInverse);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.lightBasis);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(offset);
  }
}
