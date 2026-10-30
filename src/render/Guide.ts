import * as THREE from 'three';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { MAP_W, type World } from '../sim/world/World';

const MAX_ARROWS = 28;
/** Arrows start this far ahead of the player and repeat at this spacing (tiles). */
const FIRST = 1.1;
const SPACING = 0.95;

/** A flat chevron pointing +z, lying on the floor. */
function chevron(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.2);
  s.lineTo(0.3, -0.08);
  s.lineTo(0.3, -0.24);
  s.lineTo(0, 0.04);
  s.lineTo(-0.3, -0.24);
  s.lineTo(-0.3, -0.08);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return g;
}

/** A thin ring on the floor. */
function ring(r: number, w: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r - w, r, 40);
  g.rotateX(-Math.PI / 2);
  return g;
}

const floorMat = (color: number) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    toneMapped: false,
  });

/**
 * Floor guidance: chevrons that run from the player toward where the routine wants them
 * (GDD §2: "floor directional arrows"), a pulse of light travelling along them, and a
 * ring where the walk ends; plus the tap-to-walk target ring. Fades in and out.
 */
export class Guide {
  readonly group = new THREE.Group();
  private readonly arrows: THREE.InstancedMesh;
  private readonly arrowMat = floorMat(0xffffff);
  private readonly goal: THREE.Mesh;
  private readonly goalMat = floorMat(0xffc23d);
  private readonly tap: THREE.Mesh;
  private readonly tapMat = floorMat(0xffffff);
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly dim = new THREE.Color(0xd9530a);
  private readonly bright = new THREE.Color(0xffd36b);
  /** The polyline from the player through the waypoints (reused: no garbage per frame). */
  private points: THREE.Vector2[] = [new THREE.Vector2()];
  private source: Array<{ x: number; z: number }> | null = null;
  /** The prison, to leave out arrows a wall would cut in half. */
  world: World | null = null;
  private shown = 0;
  private want = false;
  private tapWant = false;
  private tapShown = 0;
  private tapAge = 0;

  constructor() {
    this.arrows = new THREE.InstancedMesh(chevron(), this.arrowMat, MAX_ARROWS);
    this.arrows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ARROWS * 3), 3);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.renderOrder = 2;
    this.goal = new THREE.Mesh(ring(0.48, 0.09), this.goalMat);
    this.goal.renderOrder = 2;
    this.tap = new THREE.Mesh(ring(0.4, 0.07), this.tapMat);
    this.tap.renderOrder = 2;
    this.group.add(this.arrows, this.goal, this.tap);
  }

  /** The way to show (tile centers, from the player), or null to fade the arrows out. */
  setPath(points: Array<{ x: number; z: number }> | null) {
    this.want = points !== null && points.length > 0;
    // Rebuilt only when the caller hands over a new path.
    if (!points || !points.length || points === this.source) return;
    this.source = points;
    this.points.length = points.length + 1;
    points.forEach((p, k) => (this.points[k + 1] ??= new THREE.Vector2()).set(p.x, p.z));
  }

  /** The tap-to-walk target (tile center), or null once there. */
  setTap(p: { x: number; z: number } | null) {
    if (p) {
      if (this.tapShown === 0 || this.tap.position.x !== p.x || this.tap.position.z !== p.z) this.tapAge = 0;
      this.tap.position.set(p.x, 0.03, p.z);
    }
    this.tapWant = p !== null;
  }

  /** Per frame: lays the arrows from the player along the path, animates and fades them. */
  update(dt: number, time: number, from: { x: number; z: number }, motion: boolean) {
    this.shown += ((this.want ? 1 : 0) - this.shown) * Math.min(1, dt * 4);
    this.arrowMat.opacity = this.shown * 0.85;
    this.goalMat.opacity = this.shown * 0.9;
    this.arrows.visible = this.goal.visible = this.shown > 0.01;
    if (this.arrows.visible) this.layArrows(time, from, motion);

    this.tapShown += ((this.tapWant ? 1 : 0) - this.tapShown) * Math.min(1, dt * 8);
    this.tapAge += dt;
    this.tap.visible = this.tapShown > 0.01;
    const pop = motion ? 1 + 0.5 * Math.exp(-this.tapAge * 6) + Math.sin(time * 5) * 0.05 : 1;
    this.tap.scale.setScalar(pop);
    this.tapMat.opacity = this.tapShown * 0.85;
  }

  private layArrows(time: number, from: { x: number; z: number }, motion: boolean) {
    // The walk as a polyline from the player through the waypoints.
    const pts = this.points;
    pts[0].set(from.x, from.z);
    let n = 0;
    let along = 0;
    let next = FIRST;
    for (let k = 0; k + 1 < pts.length && n < MAX_ARROWS; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const len = a.distanceTo(b);
      while (next <= along + len && n < MAX_ARROWS) {
        const f = (next - along) / Math.max(1e-6, len);
        // Skip the last stretch: the goal ring marks it.
        if (k === pts.length - 2 && len - (next - along) < 0.6) break;
        const x = a.x + (b.x - a.x) * f;
        const z = a.y + (b.y - a.y) * f;
        next += SPACING;
        if (this.hidden(x, z)) continue;
        this.dummy.position.set(x, 0.03, z);
        this.dummy.rotation.set(0, Math.atan2(b.x - a.x, b.y - a.y), 0);
        // A pulse of light runs down the line toward the goal.
        const wave = motion ? Math.max(0, Math.sin(n * 0.55 - time * 5)) ** 3 : 0.3;
        this.dummy.scale.setScalar(0.85 + wave * 0.25);
        this.dummy.updateMatrix();
        this.arrows.setMatrixAt(n, this.dummy.matrix);
        this.arrows.setColorAt(n, this.color.copy(this.dim).lerp(this.bright, wave));
        n++;
      }
      along += len;
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
    if (this.arrows.instanceColor) this.arrows.instanceColor.needsUpdate = true;
    const end = pts[pts.length - 1];
    this.goal.position.set(end.x, 0.03, end.y);
    this.goal.scale.setScalar(motion ? 1 + Math.sin(time * 4) * 0.08 : 1);
  }

  /**
   * In a doorway, or just north of a wall: the camera looks over the wall from the south, so
   * the wall would hide half the arrow. The arrows on either side show the way well enough.
   */
  private hidden(x: number, z: number): boolean {
    const w = this.world;
    if (!w) return false;
    const blocks = (tx: number, tz: number) => {
      if (!w.inside(tx, tz)) return false;
      const k = w.ground.kind[tz * MAP_W + tx];
      return k === TILE.DOOR || TILE_INFO[k].opaque;
    };
    const tx = Math.floor(x);
    return blocks(tx, Math.floor(z)) || blocks(tx, Math.floor(z + 0.8));
  }
}
