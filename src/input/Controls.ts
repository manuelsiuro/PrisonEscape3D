import { dirFromVector } from '../sim/command';

/** How far the thumb can pull the stick's knob, and the dead zone, in CSS pixels. */
const STICK_RADIUS = 56;
const DEAD_ZONE = 10;

const KEYS_X: Record<string, number> = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 };
const KEYS_Z: Record<string, number> = { KeyW: -1, ArrowUp: -1, KeyS: 1, ArrowDown: 1 };

/**
 * Keyboard and touch, turned into the one thing the simulation reads: a direction (0–16).
 * Keys are physical (`e.code`), so WASD sits under the same fingers on AZERTY. On touch, a
 * stick appears wherever the thumb lands; two fingers pinch to zoom. The screen's up is
 * north (−z): the camera looks north.
 */
export class Controls {
  enabled = false;
  private readonly held = new Set<string>();
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private stickId: number | null = null;
  private origin = { x: 0, y: 0 };
  private vec = { x: 0, y: 0 };
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  constructor(
    surface: HTMLElement,
    private readonly onZoom: (factor: number) => void,
  ) {
    addEventListener('keydown', (e) => {
      if (!this.enabled || e.metaKey || e.ctrlKey) return;
      if (e.code in KEYS_X || e.code in KEYS_Z) {
        e.preventDefault();
        this.held.add(e.code);
      }
    });
    addEventListener('keyup', (e) => this.held.delete(e.code));
    addEventListener('blur', () => this.reset());

    this.stick = document.createElement('div');
    this.stick.className = 'stick hidden';
    this.knob = document.createElement('i');
    this.stick.append(this.knob);
    document.body.append(this.stick);

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) surface.addEventListener(ev, (e) => this.up(e));
    surface.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.onZoom(Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }

  private down(e: PointerEvent) {
    if (!this.enabled || e.pointerType === 'mouse') return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      /* not capturable (synthetic events): moves still arrive while over the canvas */
    }
    if (this.pointers.size === 2) {
      // A second finger: pinch to zoom, the stick lets go.
      this.endStick();
      this.pinch = this.spread();
      return;
    }
    if (this.stickId === null && this.pointers.size === 1) {
      this.stickId = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.vec = { x: 0, y: 0 };
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = '';
      this.stick.classList.remove('hidden');
    }
  }

  private move(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.pinch > 0) {
      const now = this.spread();
      this.onZoom(now / this.pinch);
      this.pinch = now;
      return;
    }
    if (e.pointerId !== this.stickId) return;
    let x = e.clientX - this.origin.x;
    let y = e.clientY - this.origin.y;
    const len = Math.hypot(x, y);
    if (len > STICK_RADIUS) {
      // Past the rim, the stick follows the thumb, so it never feels stuck.
      const pull = len - STICK_RADIUS;
      this.origin.x += (x / len) * pull;
      this.origin.y += (y / len) * pull;
      this.stick.style.left = `${this.origin.x}px`;
      this.stick.style.top = `${this.origin.y}px`;
      x = (x / len) * STICK_RADIUS;
      y = (y / len) * STICK_RADIUS;
    }
    this.vec = { x, y };
    this.knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  private up(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    if (e.pointerId === this.stickId) this.endStick();
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  private endStick() {
    this.stickId = null;
    this.vec = { x: 0, y: 0 };
    this.stick.classList.add('hidden');
  }

  /** Lets go of everything (pause, leaving the game, the window losing focus). */
  reset() {
    this.held.clear();
    this.pointers.clear();
    this.pinch = 0;
    this.endStick();
  }

  /** The direction asked for right now: the stick if a thumb is on it, else the keys. */
  dir(): number {
    if (this.stickId !== null) return Math.hypot(this.vec.x, this.vec.y) < DEAD_ZONE ? 0 : dirFromVector(this.vec.x, this.vec.y);
    let x = 0;
    let z = 0;
    for (const k of this.held) {
      x += KEYS_X[k] ?? 0;
      z += KEYS_Z[k] ?? 0;
    }
    return dirFromVector(Math.sign(x), Math.sign(z));
  }
}
