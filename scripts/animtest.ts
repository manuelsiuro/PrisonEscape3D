/**
 * The characters' animation (session 15, v2.36.0), checked without a screen:
 * - every change of activity, and setting off from one and stopping, eases (no limb jumps in a frame);
 * - no pose is left behind: whatever was done, held, carried or taken, a character done with it and
 *   standing about ends exactly as one that only ever walked and stood (its own fidgets included);
 * - with reduced motion, which poses still show (the ones that say what someone's doing);
 * - the feet keep up with the ground at every pace (the stride follows the ground covered);
 * - a crowd isn't in step, nor all standing alike, and a character moves the same way every time
 *   (its own numbers, never Math.random);
 * - nothing piles up over a long run;
 * - a day in each prison, everyone drawn as the sim has them: no jumps, and nobody left in a pose.
 */
import * as THREE from 'three';
import { check } from './assert';

// A canvas that takes every call and draws nothing (the sprites' textures are made, never uploaded here).
const context = new Proxy(
  {},
  {
    get: (_, key) => {
      if (key === 'createImageData' || key === 'getImageData')
        return (a: number | { width: number; height: number }, b?: number) => {
          const w = typeof a === 'number' ? a : a.width;
          const h = typeof a === 'number' ? b! : a.height;
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        };
      if (key === 'measureText') return () => ({ width: 0 });
      return () => ({ addColorStop: () => {} });
    },
    set: () => true,
  },
);
(globalThis as { document?: unknown }).document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context }),
};

const { Character, TRAY_AT } = await import('../src/render/Character');
const { DOING } = await import('../src/sim/ai/doing');
const { INMATE_LOOK, guardLook, inmateLook } = await import('../src/render/look');
const { itemDef, itemNumber } = await import('../src/content/items');
const { itemGeometry } = await import('../src/render/itemModels');
const { WALK_TILES, STANCE } = await import('../src/render/characterMotion');
const { PRISONS } = await import('../src/content/prisons');
const { TRAINING } = await import('../src/content/prisons/training');
const { headingAngle } = await import('../src/sim/command');
const { UNIT } = await import('../src/sim/tuning');
const { Bot } = await import('./bots');

type Char = InstanceType<typeof Character>;
const FPS = 60;
const DT = 1 / FPS;
const NAMES = Object.fromEntries(Object.entries(DOING).map(([k, v]) => [v, k])) as Record<number, string>;
const ALL = Object.values(DOING);
const LOOK = { ...INMATE_LOOK, silhouette: undefined };
const BED = { x: 0, z: 0, angle: 0 };

/** Math.random must never be drawn by a character's moves (its own numbers' only; three.js draws ids from it as things are made). */
const realRandom = Math.random;
let randomDrawn = 0;
let posing = false;
Math.random = () => {
  if (posing) randomDrawn++;
  return realRandom();
};
const realPose = Character.prototype.pose;
Character.prototype.pose = function (this: Char, ...args: Parameters<Char['pose']>) {
  posing = true;
  const stepped = realPose.apply(this, args);
  posing = false;
  return stepped;
};

/** A character's bones (private to it: read here only). */
type Rig = Record<'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR', THREE.Bone> & { dressed: THREE.SkinnedMesh };
const rig = (c: Char) => c as unknown as Rig;

/** The limbs and the body as drawn: what a jump or a left-over pose would show in. */
function bones(c: Char): number[] {
  const r = rig(c);
  const out = [r.body.position.x * 4, r.body.position.y * 4, r.body.rotation.x, r.body.rotation.z];
  for (const k of [r.head, r.armL, r.armR, r.legL, r.legR]) out.push(k.rotation.x, k.rotation.y, k.rotation.z);
  return out;
}

/** Shown, every parent shown too, and not shrunk to nothing. */
function showing(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible || p.scale.x < 0.01) return false;
  return true;
}

/** How many of the props that come and go show (the tray, the instruments, the blanket, a towel, the held item, the Zs...), and the jumpsuit or the shorts. */
function props(c: Char): string {
  let n = 0;
  c.root.traverse((o) => {
    if (((o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh)) || o instanceof THREE.Sprite) && showing(o)) n++;
  });
  return `${n}${rig(c).dressed.visible ? '' : ' in shorts'}`;
}

/** The biggest change between two frames' bones. */
function jump(a: number[], b: number[]): number {
  let m = 0;
  for (let k = 0; k < a.length; k++) {
    let d = Math.abs(a[k] - b[k]);
    if (d > Math.PI) d = Math.abs(d - Math.PI * 2);
    m = Math.max(m, d);
  }
  return m;
}

/** A jump this big in one frame at 60 a second is a pop (the quickest moves meant: a jog's legs, a drummer's sticks, under it). */
const POP = 0.35;

const held = (c: Char, id: string) => c.hold(id ? itemNumber(id) : 0, id ? itemGeometry(itemDef(itemNumber(id))) : null);

// ------------------------------------------------------------------ every change of activity
{
  let pairs = 0;
  let worst = 0;
  let worstAt = '';
  const pops: string[] = [];
  for (const a of ALL)
    for (const b of ALL) {
      if (a === b) continue;
      pairs++;
      const c = new Character(LOOK, 5);
      let t = 0;
      for (let k = 0; k < 1.5 * FPS; k++, t += DT) c.pose(0, 0, 0, false, DT, t, true, a, BED);
      let last = bones(c);
      let most = 0;
      for (let k = 0; k < 0.6 * FPS; k++, t += DT) {
        c.pose(0, 0, 0, false, DT, t, true, b, BED);
        const now = bones(c);
        most = Math.max(most, jump(last, now));
        last = now;
      }
      if (most > worst) {
        worst = most;
        worstAt = `${NAMES[a]}→${NAMES[b]}`;
      }
      if (most > POP) pops.push(`${NAMES[a]}→${NAMES[b]} ${most.toFixed(2)}`);
      c.dispose();
    }
  check(
    pops.length === 0,
    `changes of activity that jump: ${pops.slice(0, 12).join(', ')}${pops.length > 12 ? ` and ${pops.length - 12} more` : ''}`,
  );
  console.log(
    `every change of activity (a knockout a fall): ${pairs} pairs, ${pops.length} jumping (the most a frame ${worst.toFixed(2)} rad, ${worstAt})`,
  );
}

// ------------------------------------------------------------------ setting off and stopping
{
  const pops: string[] = [];
  let worst = 0;
  for (const d of ALL) {
    const c = new Character(LOOK, 6);
    let t = 0;
    let x = 0;
    for (let k = 0; k < 1.5 * FPS; k++, t += DT) c.pose(x, 0, Math.PI / 2, false, DT, t, true, d, BED);
    let last = bones(c);
    let most = 0;
    for (let k = 0; k < 1.2 * FPS; k++, t += DT) {
      const go = k < 0.6 * FPS;
      if (go) x += WALK_TILES * DT;
      c.pose(x, 0, Math.PI / 2, go, DT, t, true, d, BED);
      const now = bones(c);
      most = Math.max(most, jump(last, now));
      last = now;
    }
    worst = Math.max(worst, most);
    if (most > POP) pops.push(`${NAMES[d]} ${most.toFixed(2)}`);
    c.dispose();
  }
  check(pops.length === 0, `setting off from an activity, or stopping, jumps: ${pops.join(', ')}`);
  console.log(
    `setting off from each activity and stopping again: ${ALL.length} activities, ${pops.length} jumping (the most a frame ${worst.toFixed(2)} rad)`,
  );
}

// ------------------------------------------------------------------ never stuck
{
  /** What a character can be left with: an item held each way, a tray, a block, a blow given or taken, a wash, the warden's eye. */
  const ITEMS = ['', 'light_shovel', 'key_yellow', 'plastic_cup', 'mop', 'dirty_laundry', 'thick_book'];
  const EXTRAS: Array<[string, (c: Char, k: number) => void]> = [
    ['plain', () => {}],
    ['tray', (c, k) => c.trayPose(k < 60 ? TRAY_AT.HANDS : TRAY_AT.TABLE, 1 - k / 200)],
    ['blows', (c, k) => (k === 10 ? c.strike() : k === 40 ? c.punch() : k === 70 ? c.flinch() : (c.blocking = k > 80 && k < 110))],
    ['washed', (c) => ((c.undressed = true), (c.towel = 2), (c.attention = true))],
  ];
  let runs = 0;
  const stuck: string[] = [];
  // (Not NOTHING: standing about from the start, its fidgets run from then, not from the end of something.)
  for (const d of ALL.filter((d) => d !== DOING.NOTHING))
    for (const item of ITEMS)
      for (const [name, extra] of EXTRAS) {
        runs++;
        const c = new Character(LOOK, 7);
        const twin = new Character(LOOK, 7);
        let t = 0;
        let x = 0;
        for (let k = 0; k < 2 * FPS; k++, t += DT) {
          held(c, item);
          extra(c, k);
          c.pose(0, 0, 0, false, DT, t, true, d, BED);
          x += WALK_TILES * DT;
          twin.pose(x, 0, 0, true, DT, t, true, DOING.NOTHING);
        }
        // Done with it all: nothing in hand, no tray, no block, dressed; standing about.
        held(c, '');
        c.trayPose(TRAY_AT.NONE, 1);
        c.blocking = false;
        c.undressed = false;
        c.towel = 0;
        c.attention = false;
        for (let k = 0; k < 6 * FPS; k++, t += DT) {
          c.pose(0, 0, 0, false, DT, t, true, DOING.NOTHING);
          twin.pose(x, 0, 0, false, DT, t, true, DOING.NOTHING);
        }
        const off = jump(bones(c), bones(twin));
        const shown = props(c) === props(twin);
        if (off > 1e-4 || !shown || Math.abs(c.root.position.y - twin.root.position.y) > 1e-4)
          stuck.push(
            `${NAMES[d]}${item ? ` holding ${item}` : ''} (${name}): ${off > 1e-4 ? `the limbs ${off.toFixed(3)} off` : ''}${shown ? '' : ' a prop still showing'}`,
          );
        c.dispose();
        twin.dispose();
      }
  check(stuck.length === 0, `left in a pose: ${stuck.slice(0, 10).join('; ')}${stuck.length > 10 ? ` and ${stuck.length - 10} more` : ''}`);
  console.log(
    `never stuck: ${runs} runs (each activity, holding each way, a tray, blows, a wash), ${stuck.length} left in a pose 6 s after`,
  );
}

// ------------------------------------------------------------------ reduced motion
{
  /** The rest pose, reduced motion. */
  const still = new Character(LOOK, 8);
  for (let k = 0; k < FPS; k++) still.pose(0, 0, 0, false, DT, k * DT, false, DOING.NOTHING, BED);
  const rest = bones(still);
  const shows: string[] = [];
  const none: string[] = [];
  for (const d of ALL) {
    const c = new Character(LOOK, 8);
    // (A change of activity snaps: the very next frame is already on its way, never eased from before.)
    for (let k = 0; k < FPS; k++) c.pose(0, 0, 0, false, DT, k * DT, false, d, BED);
    (jump(bones(c), rest) > 0.2 ? shows : none).push(NAMES[d]);
    c.dispose();
  }
  // Standing about with reduced motion: no stance, no fidgets, nothing new held grows in: they stand as they are.
  const plain = new Character(LOOK, 9);
  let t = 0;
  for (let k = 0; k < 20 * FPS; k++, t += DT) plain.pose(0, 0, 0, false, DT, t, false, DOING.NOTHING);
  const fresh = new Character(LOOK, 9);
  fresh.pose(0, 0, 0, false, DT, t, false, DOING.NOTHING);
  check(jump(bones(plain), bones(fresh)) < 1e-6, 'reduced motion: someone standing about for 20 s stands as they did at once');
  held(plain, 'plastic_cup');
  plain.pose(0, 0, 0, false, DT, t, false, DOING.NOTHING);
  let cup = 0;
  plain.root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) && o.visible && o.scale.x > 0.9) cup++;
  });
  check(cup > 0, 'reduced motion: an item put in the hand is there at once, full size');
  check(
    ALL.every((d) => shows.includes(NAMES[d]) || none.includes(NAMES[d])),
    'every activity looked at',
  );
  console.log(`reduced motion: ${shows.length} activities still posed (${shows.join(' ')}); stood as they are: ${none.join(' ')}`);
}

// ------------------------------------------------------------------ the stride
{
  const lines: string[] = [];
  for (const [label, pace, d] of [
    ['a slow walker', 0.93, DOING.NOTHING],
    ['the walk', 1, DOING.NOTHING],
    ['a chase', 196 / 184, DOING.NOTHING],
    ['catching up', 1.17, DOING.NOTHING],
    ['a jog', 1.3, DOING.RUN],
    ['a flight', 1.5, DOING.NOTHING],
  ] as const) {
    const c = new Character(LOOK, 10);
    const legs = [rig(c).legL, rig(c).legR];
    const sole = new THREE.Vector3();
    let t = 0;
    let x = 0;
    let lastFoot = [NaN, NaN];
    let lastAngle = [0, 0];
    const slides: number[] = [];
    for (let k = 0; k < 4 * FPS; k++, t += DT) {
      x += WALK_TILES * pace * DT;
      c.pose(0, x, 0, true, DT, t, true, d);
      c.root.updateMatrixWorld(true);
      legs.forEach((leg, j) => {
        const foot = leg.localToWorld(sole.set(0, -0.42, 0)).z;
        const angle = leg.rotation.x;
        // At the stride's middle, the foot under the hip and going back: planted, it should keep up with the ground.
        if (k > FPS && Math.abs(angle) < 0.12 && angle > lastAngle[j]) slides.push(Math.abs(foot - lastFoot[j]) / DT / (WALK_TILES * pace));
        lastFoot[j] = foot;
        lastAngle[j] = angle;
      });
    }
    const slide = slides.reduce((a, b) => a + b, 0) / Math.max(1, slides.length);
    check(slide < 0.12, `${label}: a planted foot slides ${(slide * 100).toFixed(0)}% of the pace`);
    lines.push(`${label} ${(slide * 100).toFixed(0)}%`);
    c.dispose();
  }
  console.log(`a planted foot's slide against the ground at the stride's middle: ${lines.join(', ')}`);
}

// ------------------------------------------------------------------ a fight
{
  // Someone with arms folded standing about, then trading blows every 0.8 s (a punch, then one taken): no stance between them.
  const { styleFor } = await import('../src/render/characterMotion');
  let seed = 100;
  while (styleFor(seed, false).stance !== STANCE.FOLDED) seed++;
  const c = new Character(LOOK, seed);
  let t = 0;
  for (let k = 0; k < 5 * FPS; k++, t += DT) c.pose(0, 0, 0, false, DT, t, true, DOING.NOTHING);
  const settled = (c as unknown as { rest: number }).rest;
  let most = 0;
  let last = bones(c);
  let worst = 0;
  for (let k = 0; k < 10 * FPS; k++, t += DT) {
    if (k % 48 === 0) c.punch();
    if (k % 48 === 24) c.flinch();
    c.pose(0, 0, 0, false, DT, t, true, DOING.NOTHING);
    if (k > 1.5 * FPS) most = Math.max(most, (c as unknown as { rest: number }).rest);
    const now = bones(c);
    // (A punch's own quick out and back, as it always was, aside: what's measured is what the stance and the flinch add.)
    if ((c as unknown as { jab: number }).jab === 0) worst = Math.max(worst, jump(last, now));
    last = now;
  }
  check(
    settled > 0.99 && most < 0.01,
    `a fight: settled ${settled.toFixed(2)} before, back in the stance up to ${most.toFixed(2)} between blows`,
  );
  check(worst < POP, `a fight: the most a frame ${worst.toFixed(2)} rad, the punch's own move aside`);
  console.log(
    `a fight, arms folded before it, a blow every 0.8 s: back in the stance at most ${most.toFixed(2)} between blows; the most a frame ${worst.toFixed(2)} rad, the punch's own move aside`,
  );
  c.dispose();
}

// ------------------------------------------------------------------ what's in hand at a blow, and with no hands for it
{
  type Held = { held: THREE.Mesh | null };
  // A mop swung at a blow as a tool is (out of the fist), upright again after.
  const c = new Character(LOOK, 13);
  held(c, 'mop');
  let t = 0;
  for (let k = 0; k < FPS; k++, t += DT) c.pose(0, 0, 0, false, DT, t, true, DOING.NOTHING);
  const fist = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
  const upright = (c as unknown as Held).held!.quaternion.angleTo(fist);
  c.strike();
  for (let k = 0; k < 0.12 * FPS; k++, t += DT) c.pose(0, 0, 0, false, DT, t, true, DOING.NOTHING);
  const swung = (c as unknown as Held).held!.quaternion.angleTo(fist);
  for (let k = 0; k < FPS; k++, t += DT) c.pose(0, 0, 0, false, DT, t, true, DOING.NOTHING);
  const after = (c as unknown as Held).held!.quaternion.angleTo(fist);
  check(
    swung < 0.1 && upright > 1 && Math.abs(after - upright) < 0.05,
    `a mop at a strike: ${swung.toFixed(2)} rad off a tool's grip (${upright.toFixed(2)} held at the side, ${after.toFixed(2)} after)`,
  );
  // A bundle carried in both hands isn't drawn sunk into the chest when the hands go elsewhere (jumping jacks, out cold).
  const shown: string[] = [];
  for (const d of [DOING.NOTHING, DOING.WORK, DOING.EXERCISE, DOING.KNOCKED_OUT]) {
    const b = new Character(LOOK, 14);
    held(b, 'dirty_laundry');
    for (let k = 0; k < 2 * FPS; k++) b.pose(0, 0, 0, false, DT, k * DT, true, d, BED);
    shown.push(`${NAMES[d]} ${(b as unknown as Held).held!.visible ? 'shown' : 'hidden'}`);
    b.dispose();
  }
  check(shown.join() === 'NOTHING shown,WORK shown,EXERCISE hidden,KNOCKED_OUT hidden', `a bundle in both hands: ${shown.join(', ')}`);
  console.log(
    `in hand at a blow: a mop swung out of the fist (${swung.toFixed(2)} rad off a tool's grip), upright again after; a bundle: ${shown.join(', ')}`,
  );
  c.dispose();
}

// ------------------------------------------------------------------ fast-forward and slow devices
{
  // A replay at ×4 or ×16, a knockout's time-lapse, a phone at 30 frames a second, each frame a little longer or
  // shorter than the last: the stride turns steadily (no stutter), nobody runs at a walk.
  const lines: string[] = [];
  for (const [fps, speed] of [
    [60, 1],
    [30, 1],
    [60, 4],
    [30, 4],
    [60, 16],
    [30, 16],
  ] as const) {
    const c = new Character(LOOK, 12);
    c.timeScale = speed;
    const raw = c as unknown as { phase: number; runNow: number };
    let x = 0;
    let t = 0;
    let s = 1;
    const turns: number[] = [];
    let run = 0;
    for (let k = 0; k < 4 * fps; k++) {
      s = (s * 16807) % 2147483647;
      const dt = (1 / fps) * (0.94 + 0.12 * (s / 2147483647));
      x += WALK_TILES * speed * dt;
      t += dt;
      const before = raw.phase;
      c.pose(x, 0, Math.PI / 2, true, dt, t, true);
      if (k > fps) {
        turns.push((raw.phase - before) / dt);
        run = Math.max(run, raw.runNow);
      }
    }
    const sorted = [...turns].sort((a, b) => a - b);
    const mid = sorted[sorted.length >> 1];
    const steady = turns.every((v) => Math.abs(v - mid) <= mid * 0.25);
    check(
      steady,
      `×${speed} at ${fps} fps: the stride turns unevenly (${sorted[0].toFixed(1)}–${sorted[sorted.length - 1].toFixed(1)} rad/s)`,
    );
    check(run < 0.05, `×${speed} at ${fps} fps: a walk shown as a run (${run.toFixed(2)})`);
    lines.push(`×${speed} at ${fps} fps ${(mid / speed).toFixed(1)}`);
    c.dispose();
  }
  console.log(`a walk's stride, radians a game second, steady and never a run: ${lines.join(', ')}`);
}

// ------------------------------------------------------------------ a crowd
{
  // 24 inmates set off together at one pace, as a line to the canteen does: how many pairs are in step?
  const crowd = Array.from({ length: 24 }, (_, k) => new Character({ ...inmateLook(k + 1), silhouette: undefined }, 100 + k + 1));
  let t = 0;
  let x = 0;
  for (let k = 0; k < 3 * FPS; k++, t += DT) {
    x += WALK_TILES * DT;
    for (const c of crowd) c.pose(0, x, 0, true, DT, t, true, DOING.NOTHING);
  }
  const legs = crowd.map((c) => rig(c).legL.rotation.x);
  let inStep = 0;
  let pairs = 0;
  for (let a = 0; a < legs.length; a++)
    for (let b = a + 1; b < legs.length; b++) {
      pairs++;
      if (Math.abs(legs[a] - legs[b]) < 0.1) inStep++;
    }
  check(inStep / pairs < 0.25, `a crowd setting off together: ${inStep} of ${pairs} pairs in step`);
  // Standing about: their stances and fidgets.
  for (let k = 0; k < 30 * FPS; k++, t += DT) for (const c of crowd) c.pose(0, x, 0, false, DT, t, true, DOING.NOTHING);
  const stances = new Map<number, number>();
  for (const c of crowd) {
    const s = (c as unknown as { style: { stance: number } }).style.stance;
    stances.set(s, (stances.get(s) ?? 0) + 1);
  }
  check(stances.size >= 3, 'a crowd stands about in at least three ways');
  const guards = Array.from({ length: 12 }, (_, k) => new Character(guardLook(k), 1000 + k));
  const behind = guards.filter((c) => (c as unknown as { style: { stance: number } }).style.stance === STANCE.BEHIND).length;
  // The same character, fed the same, moves the same: two of one seed through a minute of everything.
  const a = new Character(LOOK, 42);
  const b = new Character(LOOK, 42);
  let same = true;
  for (let k = 0; k < 60 * FPS; k++) {
    const d = ALL[Math.floor(k / 180) % ALL.length];
    const moving = Math.floor(k / 90) % 3 === 0;
    a.pose(k * 0.01, 0, 1, moving, DT, k * DT, true, d, BED);
    b.pose(k * 0.01, 0, 1, moving, DT, k * DT, true, d, BED);
    if (jump(bones(a), bones(b)) > 0) same = false;
  }
  check(same, 'two characters of one number, fed the same minute, move exactly alike');
  check(randomDrawn === 0, `Math.random drawn ${randomDrawn} times by characters`);
  console.log(
    `a crowd of 24 setting off together: ${inStep} of ${pairs} pairs in step; standing about: ${[...stances.entries()]
      .sort((p, q) => p[0] - q[0])
      .map(([s, n]) => `${['at the sides', 'hands behind', 'arms folded'][s]} ${n}`)
      .join(', ')}; ${behind} of 12 guards with their hands behind their backs; one number moves alike every time; Math.random never drawn`,
  );
  for (const c of [...crowd, ...guards, a, b]) c.dispose();
}

// ------------------------------------------------------------------ nothing piles up
{
  const c = new Character(LOOK, 11);
  const twin = new Character(LOOK, 11);
  const parts = () => {
    let n = 0;
    c.root.traverse(() => n++);
    return n;
  };
  // (A blow's flash is made at the first, and kept.)
  c.flinch();
  const before = parts();
  let t = 0;
  let x = 0;
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const ITEMS = ['', 'light_shovel', 'plastic_cup', 'mop', 'dirty_laundry', 'thick_book', 'baton', 'soda'];
  let finite = true;
  for (let n = 0; n < 600; n++) {
    const d = ALL[Math.floor(rnd() * ALL.length)];
    const moving = rnd() < 0.4;
    held(c, ITEMS[Math.floor(rnd() * ITEMS.length)]);
    c.trayPose(rnd() < 0.1 ? TRAY_AT.HANDS : TRAY_AT.NONE, 1);
    if (rnd() < 0.1) c.strike();
    if (rnd() < 0.1) c.punch();
    if (rnd() < 0.1) c.flinch();
    for (let k = 0; k < 2 * FPS; k++, t += DT) {
      if (moving) x += WALK_TILES * DT;
      c.pose(x, 0, 0.5, moving, DT, t, true, d, BED);
      twin.pose(x, 0, 0.5, true, DT, t, true, DOING.NOTHING);
    }
    if (!bones(c).every(Number.isFinite)) finite = false;
  }
  held(c, '');
  c.trayPose(TRAY_AT.NONE, 1);
  for (let k = 0; k < 6 * FPS; k++, t += DT) {
    c.pose(x, 0, 0.5, false, DT, t, true, DOING.NOTHING);
    twin.pose(x, 0, 0.5, false, DT, t, true, DOING.NOTHING);
  }
  check(finite, 'twenty minutes of everything: every limb a number');
  check(parts() === before, `twenty minutes of everything: as many parts as it started with (${parts()} against ${before})`);
  check(jump(bones(c), bones(twin)) < 1e-4, 'twenty minutes of everything, then standing about: as one that only walked');
  console.log(
    `twenty minutes of everything (600 turns, items swapped, blows): ${parts()} parts as at the start, standing as one that only walked`,
  );
}

// ------------------------------------------------------------------ a day in each prison
{
  /** Two frames a step: the sim's 20 a second drawn at 40, positions in between as the game's frames have them. */
  const SUB = 2;
  for (const def of [TRAINING, ...PRISONS]) {
    const bot = new Bot(def, 3);
    const st = bot.st;
    const cast = st.inmates.map((m) => new Character({ ...inmateLook(m.cell), silhouette: undefined }, 100 + m.cell));
    const guards = st.guards.map((_, k) => new Character(guardLook(k), 1000 + k));
    const who = [...cast, ...guards];
    const last = who.map((c) => bones(c));
    const prev = [...st.inmates.map((m) => ({ x: m.body.x, z: m.body.z })), ...st.guards.map((g) => ({ x: g.body.x, z: g.body.z }))];
    const doing = who.map(() => -1);
    const stoodFor = who.map(() => 0);
    let changes = 0;
    let pops = 0;
    let checked = 0;
    let leftOver = 0;
    const popAt = new Map<string, number>();
    const leftAt = new Map<string, number>();
    const lastDoing = who.map((): number => DOING.NOTHING);
    let t = 0;
    let steps = 0;
    /** Drawn after each step (called before the next: keepRoutine's test). */
    const draw = () => {
      steps++;
      const bodies = [
        ...st.inmates.map((m) => ({ b: m.body, d: m.body.moving && m.then === DOING.JOG ? DOING.RUN : m.doing })),
        ...st.guards.map((g) => ({ b: g.body, d: g.doing })),
      ];
      for (let s = 1; s <= SUB; s++) {
        t += 1 / (20 * SUB);
        bodies.forEach(({ b, d }, k) => {
          const c = who[k];
          const p = prev[k];
          const f = s / SUB;
          const x = (p.x + (b.x - p.x) * f) / UNIT;
          const z = (p.z + (b.z - p.z) * f) / UNIT;
          const moving = b.moving && (p.x !== b.x || p.z !== b.z);
          const teleport = Math.hypot(b.x - p.x, b.z - p.z) > UNIT / 2;
          c.pose(x, z, headingAngle(b.facing), moving, 1 / (20 * SUB), t, true, d, { x, z, angle: 0 });
          const now = bones(c);
          const most = jump(last[k], now);
          // (A move of more than half a tile in a step is a cut, put there: not a frame anyone sees as motion.)
          if (steps > 1 && most > POP * 1.5 && !teleport) {
            pops++;
            const key = `${NAMES[lastDoing[k]]}→${NAMES[d]}`;
            popAt.set(key, (popAt.get(key) ?? 0) + 1);
          }
          last[k] = now;
          if (s === SUB) {
            if (d !== doing[k]) changes++;
            doing[k] = d;
            lastDoing[k] = d;
            stoodFor[k] = d === DOING.NOTHING && !moving ? stoodFor[k] + 1 : 0;
            // Standing about with nothing to do for 4 s: nothing of before may show (a lying body, a crawl, a prop, legs apart, a lean).
            if (stoodFor[k] >= 80 && stoodFor[k] % 20 === 0) {
              checked++;
              const raw = c as unknown as { lie: number; crawl: number; prone: number; blend: number; phoneOff: number; kioskOff: number };
              const r = rig(c);
              const bad =
                raw.lie > 0 ||
                raw.crawl > 0 ||
                raw.prone > 0 ||
                raw.blend < 1 ||
                raw.phoneOff > 0 ||
                raw.kioskOff > 0 ||
                Math.abs(r.legR.rotation.z) > 1e-3 ||
                Math.abs(r.body.rotation.x) > 0.2 ||
                props(c) !== '0';
              if (bad) {
                leftOver++;
                leftAt.set(NAMES[d], (leftAt.get(NAMES[d]) ?? 0) + 1);
              }
            }
          }
        });
      }
      st.inmates.forEach((m, k) => (prev[k] = { x: m.body.x, z: m.body.z }));
      st.guards.forEach((g, k) => (prev[cast.length + k] = { x: g.body.x, z: g.body.z }));
      return false;
    };
    bot.keepRoutine(draw, 24 * 60 * 20);
    check(pops === 0, `${def.id}: ${pops} jumps in a day (${[...popAt.entries()].map(([k, n]) => `${k} ×${n}`).join(', ')})`);
    check(leftOver === 0, `${def.id}: ${leftOver} left in a pose standing about (${[...leftAt.keys()].join(', ')})`);
    console.log(
      `${def.id}: a day (${steps} steps), ${who.length} people, ${changes} changes of what they do: ${pops} jumps; ${checked} times standing about with nothing to do, ${leftOver} left in a pose`,
    );
    for (const c of who) c.dispose();
  }
}
Math.random = realRandom;
