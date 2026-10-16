import { itemDef } from '../content/items';
import { t, type Key } from '../i18n';
import type { AimView } from '../render/Noise';
import { DIR_X, DIR_Z, EXT, OP, tossArgs } from '../sim/command';
import { itemOf } from '../sim/systems/items';
import { aimToss, earshot, hearers, tossRange, type NoiseAt, type TossAim } from '../sim/systems/noise';
import { FIRECRACKER } from '../sim/systems/structure';
import type { TossRefusal } from '../sim/state';
import { BANG_NOISE, THUD_NOISE, UNIT } from '../sim/tuning';
import { LAYER, MAP_W } from '../sim/world/World';
import { TOUCH } from '../ui/dom';
import { aimUI, controls, itemsUI, sound, view } from './context';
import { play, sendOp } from './game';

/**
 * Throwing (P14). On a mouse, hold the right button over the picture to aim and let go to
 * throw; or pick Throw in the item's menu, then click. On touch, Throw in the item's menu
 * (or a firecracker's own button), then drag to aim and lift to throw (Cancel to give up).
 * F throws straight ahead (Space too, with a firecracker). The aim shows the reach, the
 * arc, the landing ring, where the thud (a firecracker: its bang) would carry and the guards
 * who would hear it; the simulation checks it all again when the throw comes (aimToss).
 */
const aim = {
  /** Held: the right button down. Armed: Throw picked, the next press throws. */
  how: null as 'held' | 'armed' | null,
  /** The pointer the aim follows (screen px); before any (armed on touch), it points ahead. */
  px: 0,
  py: 0,
  pointer: false,
  dx: 0,
  dz: 0,
};
const result: TossAim = { why: null, to: -1 };
const shown: AimView = { fromX: 0, fromZ: 0, toX: 0, toZ: 0, valid: false, range: 6, tiles: [] };
const tiles: number[] = [];
const ears: number[] = [];
const earIds: number[] = [];
const spotAt = { x: 0, y: 0 };
const landing: NoiseAt = { layer: LAYER.GROUND, tile: -1, reach: 0 };
const headAt = (id: number, out: { x: number; y: number }) => view.screenOf(id, out, 1.95);

/** Throws at a tile (tiles across and down from the player's now): the sim gets the tile itself. */
function send(dx: number, dz: number) {
  const p = play.game!.rec.sim.state.player;
  const [b, c] = tossArgs((Math.floor(p.z / UNIT) + dz) * MAP_W + Math.floor(p.x / UNIT) + dx);
  sendOp(OP.EXT, EXT.THROW, b, c);
}

export const aiming = () => aim.how !== null;

/** Throw picked from a menu (or a firecracker's button): the next press aims and throws. */
export function armThrow() {
  const g = play.game;
  if (!g || g.paused) return;
  aim.how = 'armed';
  aim.pointer = false;
  controls.aimArmed = true;
  g.pilot.stop();
}

export function cancelThrow() {
  aim.how = null;
  controls.aimArmed = false;
  view.setAim(null);
  aimUI.show(null);
}

/** Why not, said: a toast, or only the sting while the aim's own label says it (armed, still aiming). */
function refuse(why: TossRefusal, shown = false) {
  sound.sting();
  if (!shown) itemsUI.toast(t(`toss.${why}` as Key));
}

/** The pointer, from Controls: the right button (or a press while armed) aims, letting go throws. */
export function onAim(phase: 'down' | 'move' | 'up' | 'cancel', x: number, y: number) {
  const g = play.game;
  if (!g || g.paused) {
    cancelThrow();
    return;
  }
  if (phase === 'cancel') {
    if (aim.how === 'held') cancelThrow();
    return;
  }
  aim.px = x;
  aim.py = y;
  aim.pointer = true;
  if (phase === 'down') {
    aim.how ??= 'held';
    g.pilot.stop();
    return;
  }
  if (phase !== 'up' || !aim.how) return;
  // Let go: thrown if it can go. A held aim ends either way; an armed one waits for another try.
  target();
  if (!result.why) {
    send(aim.dx, aim.dz);
    cancelThrow();
    return;
  }
  refuse(result.why, aim.how === 'armed');
  if (aim.how === 'held') cancelThrow();
}

/** F (and Space with a firecracker on a keyboard): straight ahead, as far as it can go. */
export function throwAhead() {
  const g = play.game;
  if (!g || g.paused) return;
  const sim = g.rec.sim;
  const p = sim.state.player;
  const r = tossRange(sim.state.str);
  const x0 = Math.floor(p.x / UNIT);
  const z0 = Math.floor(p.z / UNIT);
  let first: TossRefusal | null = null;
  for (let d = r; d >= 1; d--) {
    const dx = Math.floor(p.x / UNIT + (DIR_X[p.facing] / 1024) * d) - x0;
    const dz = Math.floor(p.z / UNIT + (DIR_Z[p.facing] / 1024) * d) - z0;
    aimToss(sim, dx, dz, result);
    if (!result.why) {
      send(dx, dz);
      return;
    }
    first ??= result.why;
    if (result.why === 'nothing' || result.why === 'busy') break;
  }
  refuse(first ?? 'there');
}

/** The tile aimed at: the pointer's, kept within reach (as far as the throw goes towards it); with no pointer yet, 3 tiles ahead. */
function target() {
  const sim = play.game!.rec.sim;
  const st = sim.state;
  const p = st.player;
  const r = tossRange(st.str);
  const px = p.x / UNIT;
  const pz = p.z / UNIT;
  let vx = (DIR_X[p.facing] / 1024) * 3;
  let vz = (DIR_Z[p.facing] / 1024) * 3;
  if (aim.pointer) {
    const at = view.groundAt(aim.px, aim.py);
    if (at) {
      vx = at.x - px;
      vz = at.z - pz;
    }
  }
  let len = Math.hypot(vx, vz);
  for (;;) {
    const dx = Math.floor(px + vx) - Math.floor(px);
    const dz = Math.floor(pz + vz) - Math.floor(pz);
    if (dx * dx + dz * dz <= r * r || len < 0.5) {
      aim.dx = dx;
      aim.dz = dz;
      break;
    }
    const s = (len - 0.25) / len;
    vx *= s;
    vz *= s;
    len -= 0.25;
  }
  aimToss(sim, aim.dx, aim.dz, result);
}

/**
 * Each frame: the aim follows the pointer; the view draws it, the labels say who would hear
 * it (or why it can't go). It lets go by itself when the game is busy or the hand empties.
 */
export function updateAim(busy: boolean) {
  const g = play.game;
  if (!aim.how) return;
  const sim = g?.rec.sim;
  const held = sim ? itemOf(sim.state.items.inv[sim.state.items.hand]) : 0;
  if (!g || !sim || g.paused || busy || !held) {
    cancelThrow();
    return;
  }
  target();
  const st = sim.state;
  // A firecracker's noise is its bang (it wakes the sleepers too); anything else, its thud.
  const bang = held === FIRECRACKER;
  landing.tile = result.to;
  landing.reach = bang ? BANG_NOISE : THUD_NOISE[itemDef(held).thud ?? 0];
  const n = result.why ? null : landing;
  earshot(sim, n, tiles);
  hearers(sim, n, ears, bang);
  const x0 = Math.floor(st.player.x / UNIT);
  const z0 = Math.floor(st.player.z / UNIT);
  const to = result.to >= 0 ? result.to : (z0 + aim.dz) * MAP_W + x0 + aim.dx;
  shown.fromX = st.player.x / UNIT;
  shown.fromZ = st.player.z / UNIT;
  shown.toX = (to % MAP_W) + 0.5;
  shown.toZ = Math.floor(to / MAP_W) + 0.5;
  shown.valid = !result.why;
  shown.range = tossRange(st.str);
  shown.tiles = tiles;
  view.setAim(shown);
  aimUI.show(aim.how === 'held' ? 'mouse' : TOUCH ? 'touch' : 'click');
  const spot = view.screenAt(shown.toX, 0, shown.toZ, spotAt);
  const text = result.why ? t(`toss.${result.why}` as Key) : !ears.length ? t('aim.quiet') : ears.length === 1 ? t('aim.heardOne') : t('aim.heardMany', { n: ears.length });
  earIds.length = 0;
  for (const k of ears) earIds.push(st.inmates.length + k);
  aimUI.update(spot, text, !!result.why, earIds, headAt);
}
