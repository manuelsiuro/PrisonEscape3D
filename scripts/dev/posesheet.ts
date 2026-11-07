// Dev tool, run in the browser on the dev server: a sheet of characters seen from the game's camera
// angle, each row one animation played from its start, each column a moment of it, for looking at
// poses, blends and held items frame by frame (session 15, character animation). Its own renderer
// and light on a canvas over the game: the poses and the hands, not the prison's look.
//   const s = await import('/scripts/dev/posesheet.ts');
//   s.show(s.ROWS.slice(0, 8), [0, 0.1, 0.2, 0.4, 0.8, 1.6]);   // rows × the moments (s)
//   s.show(rows, times, { turn: Math.PI });   // the same from behind
//   s.hide();
import * as THREE from 'three';
import { Character } from '../../src/render/Character';
import { CAMERA_OFFSET } from '../../src/render/viewCamera';
import { guardLook, inmateLook, INMATE_LOOK } from '../../src/render/look';
import { DOING } from '../../src/sim/ai/doing';
import { itemDef, itemNumber } from '../../src/content/items';
import { itemGeometry } from '../../src/render/itemModels';

/** What a row's character does at time `t` (s): it calls `c.pose` (and anything before it) and returns where it stands. */
export interface Row {
  label: string;
  look?: 'inmate' | 'guard' | 'player';
  /** Called every 1/60 s from 0 up to the column's moment. */
  step: (c: Character, t: number, dt: number) => { x: number; z: number };
}

const SPEED = (184 / 1024) * 20;

/** Holds an item by its id (0 / '' empty-handed). */
export const held = (c: Character, id: string) => c.hold(id ? itemNumber(id) : 0, id ? itemGeometry(itemDef(itemNumber(id))) : null);

/** A row doing one thing, standing (facing the camera at 0). */
export const doing = (
  label: string,
  d: number,
  opts: { item?: string; look?: Row['look']; before?: number; after?: number } = {},
): Row => ({
  label,
  look: opts.look,
  step: (c, t, dt) => {
    held(c, opts.item ?? '');
    c.pose(0, 0, 0, false, dt, t, true, opts.before !== undefined && t < 0.5 ? opts.before : d);
    return { x: 0, z: 0 };
  },
});

/** A row walking (at `pace` of the walk) to the right of the screen, its x taken off so it stays in its cell. */
export const walking = (
  label: string,
  pace = 1,
  opts: { item?: string; look?: Row['look']; d?: number; tray?: boolean; stopAt?: number; dir?: number } = {},
): Row => ({
  label,
  look: opts.look,
  step: (c, t, dt) => {
    held(c, opts.item ?? '');
    if (opts.tray) c.trayPose(1, 1);
    const go = opts.stopAt === undefined || t < opts.stopAt;
    const d = SPEED * pace * (go ? t : opts.stopAt!);
    const dir = dirNow ?? opts.dir ?? Math.PI / 2;
    const x = Math.sin(dir) * d;
    const z = Math.cos(dir) * d;
    c.pose(x, z, dir, go, dt, t, true, opts.d ?? DOING.NOTHING);
    return { x, z };
  },
});

/** A row standing about, a fidget (characterMotion.ts FIDGET) forced at 3 s, to `side` (±1). */
export const fidget = (label: string, kind: number, opts: { item?: string; look?: Row['look']; side?: number } = {}): Row => ({
  label,
  look: opts.look,
  step: (c, t, dt) => {
    held(c, opts.item ?? '');
    const f = (c as unknown as { fidget: { kind: number; at: number; next: number; side: number } }).fidget;
    if (t < 3) f.next = 99;
    else if (t - dt < 3) Object.assign(f, { kind, at: 0, side: opts.side ?? 1 });
    c.pose(0, 0, 0, false, dt, t, true, DOING.NOTHING);
    return { x: 0, z: 0 };
  },
});

/** Every walking row's heading, when set (`show`'s `dir`). */
let dirNow: number | undefined;

export const ROWS: Row[] = [
  walking('walk', 1),
  walking('walk ×0.9', 0.9),
  walking('jog', 1.3, { d: DOING.RUN }),
  walking('guard walk', 1, { look: 'guard' }),
  walking('guard chase', 196 / 184, { look: 'guard', item: 'baton' }),
  walking('stop', 1, { stopAt: 0.6 }),
  walking('tray', 1, { tray: true }),
  walking('laundry', 1, { item: 'dirty_laundry' }),
  walking('timber', 1, { item: 'timber' }),
  walking('mop', 1, { item: 'mop' }),
  walking('book', 1, { item: 'thick_book' }),
  walking('cup', 1, { item: 'plastic_cup' }),
  walking('shovel', 1, { item: 'light_shovel' }),
  doing('idle', DOING.NOTHING),
  doing('eat', DOING.EAT),
  doing('read', DOING.READ, { item: 'thick_book' }),
  doing('sit read', DOING.SIT_READ, { item: 'thick_book' }),
  doing('work', DOING.WORK, { item: 'dirty_laundry' }),
  doing('mop', DOING.MOP, { item: 'mop' }),
  doing('drink', DOING.DRINK, { item: 'plastic_cup' }),
  doing('dig', DOING.DIG),
  doing('line up', DOING.LINE_UP),
  doing('count', DOING.COUNT, { look: 'guard' }),
  doing('doze', DOING.DOZE, { look: 'guard' }),
  doing('ko', DOING.KNOCKED_OUT),
  doing('brawl', DOING.BRAWL),
  doing('eat→idle', DOING.NOTHING, { before: DOING.EAT }),
  doing('sit→read', DOING.READ, { before: DOING.SIT, item: 'thick_book' }),
];

let canvas: HTMLCanvasElement | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let labels: HTMLDivElement | null = null;

/** The rows × the moments, drawn over the game (`turn`: the characters turned, to see them from behind; `scale`: tiles a cell). */
export function show(
  rows: Row[],
  times: number[],
  opts: { turn?: number; cell?: number; width?: number; dir?: number; seed?: number } = {},
) {
  hide();
  dirNow = opts.dir;
  const cell = opts.cell ?? 1.7;
  const width = opts.width ?? innerWidth;
  const cols = times.length;
  const aspect = (rows.length * cell * 0.8) / ((cols + 1) * cell);
  const height = Math.min(innerHeight, Math.round(width * aspect));
  canvas = document.createElement('canvas');
  Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', zIndex: '9999', width: `${width}px`, height: `${height}px` });
  document.body.appendChild(canvas);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9aa0a6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-3, 10, 6);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0xb8b2a8 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const made: Character[] = [];
  rows.forEach((row, r) =>
    times.forEach((time, k) => {
      const look =
        row.look === 'guard'
          ? guardLook(1, 0xffd34a)
          : row.look === 'player'
            ? INMATE_LOOK
            : { ...inmateLook(r + 2), silhouette: undefined };
      const c = new Character(look, (opts.seed ?? 100) + r);
      const dt = 1 / 60;
      let at = { x: 0, z: 0 };
      for (let t = 0; t <= time + 1e-6; t += dt) at = row.step(c, t, dt);
      c.root.position.x += -at.x + (k + 1) * cell;
      c.root.position.z += -at.z + r * cell * 0.8;
      if (opts.turn) c.root.rotation.y += opts.turn;
      scene.add(c.root);
      made.push(c);
    }),
  );
  const w = (cols + 1) * cell;
  const h = rows.length * cell * 0.8;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, (h / 2) * 1.0, (-h / 2) * 1.0, 1, 200);
  const mid = new THREE.Vector3(w / 2 + cell * 0.25, 0.4, (h - cell * 0.8) / 2);
  cam.position.copy(mid).add(CAMERA_OFFSET);
  cam.lookAt(mid);
  // (The camera looks down steeply: squash the vertical so the rows fit.)
  const tilt = CAMERA_OFFSET.y / CAMERA_OFFSET.length();
  cam.top = (h / 2) * tilt + 0.6;
  cam.bottom = (-h / 2) * tilt - 0.2;
  cam.left = -w / 2;
  cam.right = w / 2;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  labels = document.createElement('div');
  Object.assign(labels.style, { position: 'fixed', left: '0', top: '0', zIndex: '10000', font: '12px sans-serif', color: '#000' });
  rows.forEach((row, r) => {
    const v = new THREE.Vector3(cell * 0.35, 0.6, r * cell * 0.8).project(cam);
    const d = document.createElement('div');
    d.textContent = row.label;
    Object.assign(d.style, { position: 'absolute', left: `${((v.x + 1) / 2) * width}px`, top: `${((1 - v.y) / 2) * height}px` });
    labels!.appendChild(d);
  });
  times.forEach((time, k) => {
    const v = new THREE.Vector3((k + 1) * cell, 0, -cell * 0.55).project(cam);
    const d = document.createElement('div');
    d.textContent = `${time}s`;
    Object.assign(d.style, {
      position: 'absolute',
      left: `${((v.x + 1) / 2) * width}px`,
      top: `${Math.max(0, ((1 - v.y) / 2) * height)}px`,
    });
    labels!.appendChild(d);
  });
  document.body.appendChild(labels);
  for (const c of made) c.dispose();
  return { width, height };
}

export function hide() {
  canvas?.remove();
  labels?.remove();
  renderer?.dispose();
  canvas = null;
  labels = null;
  renderer = null;
}
