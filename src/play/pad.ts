/**
 * A gamepad playing the game (2.45): read each frame (input/pad.ts) and turned into what the keyboard
 * and the fingers already do. The game was built on keys, so the pad sends them (synthetic key events,
 * the bound key of each action), and on a card or a screen it moves the focus between the buttons and
 * clicks the one chosen (a synthetic key doesn't press a button by itself).
 *
 * The layout (fixed; `i18n/keys.ts` names its buttons in the texts):
 * - In play: the left stick walks (16 ways), the D-pad too (as the arrow keys); A acts (E), X uses the tool
 *   (Space, held), Y locks on (R), LT blocks (V, held), RT throws ahead (F), L3 drops (Q), R3 digs up (U,
 *   held), LB and RB step along the hotbar, the right stick zooms, View opens the panels' wheel, Menu pauses,
 *   B closes what's open (Escape, never the pause).
 * - On a card in play with buttons: the D-pad moves between them and A presses; the stick still walks.
 *   Where the card's game is played with the arrows (the gym, an arm-wrestle, penalties, the stage show,
 *   the tattoo), the D-pad and the stick are the arrows, as on a keyboard.
 * - On a screen (the title, the pause, settings, help…): the D-pad or the stick moves, A presses, B goes
 *   back, LB and RB are ← and → (the help's and the trophies' pages), the right stick scrolls.
 */
import { t } from '../i18n';
import { BTN, nextBox, PadReader, stickArrow, type Btn, type PadFrame, type PadKind, type Way } from '../input/pad';
import { keyFor, setPadLabels, type Action } from '../input/bindings';
import { setRumble } from '../app/haptics';
import { HOTBAR } from '../sim/systems/items';
import { OP } from '../sim/command';
import { PadWheel, WHEEL } from '../ui/padWheel';
import { controls, hooks, sound, view } from './context';
import { play, sendOp } from './game';
import { closeSomething } from './keys';
import { aiming, padAimMove, padAimStart, padAimThrow } from './aim';
import { itemsUI } from './context';

const reader = new PadReader();
const wheel = new PadWheel();
/** The pad's own key events (a synthetic one is never trusted): told apart from the player's own keys. */
let kind: PadKind | null = null;

// ------------------------------------------------------------------ keys sent

const KEY_OF: Record<string, string> = {
  Space: ' ',
  Escape: 'Escape',
  Enter: 'Enter',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};
/** The keys the pad holds down now (let go together when the pad's use changes). */
const down = new Set<string>();

function send(type: 'keydown' | 'keyup', code: string) {
  const key = KEY_OF[code] ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code);
  const ev = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true });
  // (At the focus: some cards listen on their own elements.)
  (document.activeElement ?? document.body).dispatchEvent(ev);
}
function press(code: string) {
  if (down.has(code)) return;
  down.add(code);
  send('keydown', code);
}
function release(code: string) {
  if (!down.delete(code)) return;
  send('keyup', code);
}
function tap(code: string) {
  send('keydown', code);
  send('keyup', code);
}
function releaseAll() {
  for (const c of [...down]) {
    down.delete(c);
    // (The stick's arrows are held under a name of their own: see the frame.)
    send('keyup', c.startsWith('Stick') ? c.slice(5) : c);
  }
}
const act = (a: Action) => keyFor(a);

// ------------------------------------------------------------------ where the pad is

const shown = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && !el.closest('.hidden') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** What the pad is driving now. */
type Mode =
  /** A screen over everything (a `.modal`, the title): choose, press, back. */
  | { kind: 'menu'; layers: HTMLElement[] }
  /** Playing, with cards or panels up whose buttons the D-pad chooses. */
  | { kind: 'card'; layers: HTMLElement[] }
  /** Playing, the arrows the card's own (or no card): the D-pad and the stick are the arrows. */
  | { kind: 'play'; arrows: boolean }
  /** The escape's film: any button skips it. */
  | { kind: 'film' }
  /** Nothing to drive (a game loading). */
  | { kind: 'none' };

/** The cards and panels in play the D-pad chooses in. */
const CARDS = '.item-panel, .train-card, .stow-panel, .story-card, .item-info';
/** The pockets chosen from the wheel: the D-pad along the hotbar. */
let pockets = false;

function modeNow(): Mode {
  if (document.body.classList.contains('cinema-on')) return { kind: 'film' };
  // (The screens over everything: the modals, and the intake's card beside the new prisoner.)
  const modals = [...document.querySelectorAll<HTMLElement>('.modal, .intake')].filter(shown);
  if (modals.length) return { kind: 'menu', layers: [modals.at(-1)!] };
  // (2.46: a mode of its own, City Escape: played, unless a screen of its own is up.)
  if (play.side) return play.side.paused ? { kind: 'none' } : { kind: 'play', arrows: false };
  const g = play.game;
  if (!g) {
    const title = document.querySelector<HTMLElement>('.title-screen');
    return shown(title) ? { kind: 'menu', layers: [title] } : { kind: 'none' };
  }
  // (A replay: its bar is the screen.)
  if (g.replay) {
    const bar = document.querySelector<HTMLElement>('.rp-panel');
    return shown(bar) ? { kind: 'menu', layers: [bar] } : { kind: 'none' };
  }
  if (g.paused) return { kind: 'none' };
  if (wheel.isOpen) return { kind: 'card', layers: [wheel.el] };
  const bar = document.querySelector<HTMLElement>('.hotbar');
  const info = document.querySelector<HTMLElement>('.item-info');
  // (The pockets, chosen from the wheel: the hotbar and an item's menu; gone with the hotbar.)
  if (pockets && !shown(bar)) pockets = false;
  if (pockets) return { kind: 'card', layers: [bar!, ...(shown(info) ? [info] : [])] };
  if (g.hunt) return { kind: 'play', arrows: false };
  const st = g.rec.sim.state;
  // The cards played with the arrows, as keys.ts and the loop read them.
  // (Not the tattoo: its needle is steered like a walk, the stick's 16 ways.)
  if (st.train >= 0 || st.askTurn.length > 0 || st.bout.length > 0 || st.pens || st.show) return { kind: 'play', arrows: true };
  const cards = [...document.querySelectorAll<HTMLElement>(CARDS)].filter((c) => shown(c) && choices(c).length > 0);
  // (Crafting or a container open: the pockets are part of it, an item picked there, then where it goes.)
  if (itemsUI.panelOpen && shown(bar)) cards.push(bar!);
  return cards.length ? { kind: 'card', layers: cards } : { kind: 'play', arrows: false };
}

/** What can be chosen in a layer: buttons and the like, shown and enabled (not a text box: a pad can't type). */
function choices(layer: HTMLElement): HTMLElement[] {
  return [
    ...layer.querySelectorAll<HTMLElement>(
      'button, a[href], select, input:not([type=text]):not([type=search]):not([type=hidden]), [tabindex]:not([tabindex="-1"]), [role=tab]',
    ),
  ].filter((el) => !(el as HTMLButtonElement).disabled && !el.closest('[inert], [aria-hidden=true]') && shown(el));
}

/** A way out of a card (a ×, Stop, Give up): never chosen for the player, only by the D-pad. */
const leaves = (el: HTMLElement) =>
  el.matches(
    '[data-close], .train-stop, .close, .ink-quit, .quiz-quit, .stage-quit, .rp-close, .dc-close, .oddjobs-close, .race-close, .pa-close, .coach-skip',
  ) || el.getAttribute('aria-label') === t('common.close');

/**
 * The first choice on a layer: the one it marks first (`.primary`, the item in hand), else the first that isn't a
 * way out. On a card in play, a way out is never the first (`leaveOk` false): A on a tattoo's card would give it up.
 */
function firstChoice(all: HTMLElement[], leaveOk: boolean): HTMLElement | undefined {
  return (
    all.find((el) => el.matches('.primary, [autofocus], .slot.hand')) ?? all.find((el) => !leaves(el)) ?? (leaveOk ? all[0] : undefined)
  );
}

/** The last choice made on a card, by what it was (a card redrawn loses its focus: it's put back). */
let lastChoice: { layer: HTMLElement; sig: string; at: number } | null = null;
const sig = (el: HTMLElement) =>
  `${el.tagName}|${el.className}|${Object.entries(el.dataset)
    .map(([k, v]) => `${k}=${v}`)
    .join(',')}|${el.textContent?.trim().slice(0, 40)}`;

/** The choice now: the focus if it's on the layers, else one put there. */
function current(layers: HTMLElement[], all: HTMLElement[], leaveOk: boolean): HTMLElement | undefined {
  const f = document.activeElement as HTMLElement | null;
  if (f && all.includes(f)) return f;
  if (lastChoice && layers.includes(lastChoice.layer)) {
    const again = all.find((el) => sig(el) === lastChoice!.sig) ?? all[Math.min(lastChoice.at, all.length - 1)];
    if (again) return again;
  }
  return firstChoice(all, leaveOk);
}

function choose(el: HTMLElement, layers: HTMLElement[], all: HTMLElement[]) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const layer = layers.find((l) => l.contains(el)) ?? layers[0];
  lastChoice = { layer, sig: sig(el), at: all.indexOf(el) };
}

/** The D-pad on a layer: the next choice that way (a slider takes left and right). */
function move(layers: HTMLElement[], way: Way) {
  const all = layers.flatMap(choices);
  if (!all.length) return;
  // (The D-pad may land on a way out: it's the player's own choice then.)
  const now = current(layers, all, false) ?? all[0];
  if (document.activeElement !== now) return choose(now, layers, all);
  if (now instanceof HTMLInputElement && now.type === 'range' && (way === 'left' || way === 'right')) {
    if (way === 'left') now.stepDown();
    else now.stepUp();
    now.dispatchEvent(new Event('input', { bubbles: true }));
    now.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const boxes = all.map((el) => el.getBoundingClientRect());
  const i = nextBox(boxes[all.indexOf(now)], boxes, way);
  if (i >= 0) {
    sound.click();
    choose(all[i], layers, all);
  }
}

/** A on a layer: the choice pressed (chosen first, if none was); false when there's none to press (A acts then). */
function pressChoice(layers: HTMLElement[], leaveOk: boolean): boolean {
  const all = layers.flatMap(choices);
  const now = current(layers, all, leaveOk);
  if (!now) return false;
  if (document.activeElement !== now) choose(now, layers, all);
  now.click();
  return true;
}

/** The right stick on a screen: the part that scrolls, round the choice (else the first in the layer). */
function scroll(layers: HTMLElement[], dy: number, dt: number): boolean {
  const scrolls = (el: HTMLElement) => {
    const o = getComputedStyle(el).overflowY;
    return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight;
  };
  let el = document.activeElement as HTMLElement | null;
  if (!el || !layers.some((l) => l.contains(el))) el = null;
  while (el && !scrolls(el) && layers.some((l) => l.contains(el))) el = el.parentElement;
  if (!el || !scrolls(el)) el = [layers[0], ...layers[0].querySelectorAll<HTMLElement>('*')].find(scrolls) ?? null;
  if (!el) return false;
  el.scrollBy(0, dy * 900 * dt);
  return true;
}

// ------------------------------------------------------------------ the D-pad held, repeated

const REPEAT_FIRST = 0.38;
const REPEAT_EVERY = 0.11;
let navHeld: Way | '' = '';
let navNext = 0;
let stickWay: Way | '' = '';
/** The arrow keys the D-pad and the stick hold in play. */
const ARROW: Record<Way, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const DPAD: [Btn, Way][] = [
  [BTN.UP, 'up'],
  [BTN.DOWN, 'down'],
  [BTN.LEFT, 'left'],
  [BTN.RIGHT, 'right'],
];

/** The way the D-pad or the stick points on a screen, once and then repeated while held. */
function navWay(f: PadFrame, t: number, stick = true): Way | '' {
  let way: Way | '' = '';
  for (const [b, w] of DPAD) if (f.held[b]) way = w;
  // (On a card in play the stick walks: only the D-pad chooses there.)
  if (!way && stick) way = stickWay;
  if (!way) {
    navHeld = '';
    return '';
  }
  if (way !== navHeld) {
    navHeld = way;
    navNext = t + REPEAT_FIRST;
    return way;
  }
  if (t >= navNext) {
    navNext = t + REPEAT_EVERY;
    return way;
  }
  return '';
}

// ------------------------------------------------------------------ the frame

let modeKind = '';
let lastT = 0;

/** The pad in hand (labels, the focus ring, the rumble) or put down for the keys or a finger. */
function using(k: PadKind | null) {
  if (k === kind) return;
  // (Put down: what it held is let go now, its let-go would never be read; its wheel shuts.)
  if (k === null) {
    releaseAll();
    wheel.close();
  }
  kind = k;
  setPadLabels(k);
  document.body.classList.toggle('pad', k !== null);
}

/** Each frame (the loop's, on the title too). */
export function padFrame(now: number) {
  const t = now / 1000;
  const dt = Math.min(0.1, Math.max(0, t - lastT));
  lastT = t;
  const pads = navigator.getGamepads?.() ?? [];
  const f = reader.read(pads as unknown as Parameters<PadReader['read']>[0]);
  if (!f) {
    if (down.size) releaseAll();
    controls.padStick = { x: 0, y: 0 };
    setRumble(null);
    return;
  }
  if (f.touched) {
    using(f.kind);
    // (Sound waits for a gesture: a pad's press may be one, where the browser counts it.)
    sound.wake();
  }
  // (The rumble only while the pad is in hand: a keyboard player with one on the desk feels nothing.)
  const pad = kind ? ((pads as (Gamepad | null)[]).find((p) => p?.connected && p.mapping === 'standard' && rumbles(p)) ?? null) : null;
  setRumble(pad ? (ms, strong, weak) => void rumbleOn(pad, ms, strong, weak) : null);
  if (kind === null) return;

  stickWay = stickArrow(f.left.x, f.left.y, stickWay) as Way | '';
  const m = modeNow();
  const mk = m.kind === 'play' ? `play${m.arrows}` : m.kind;
  if (mk !== modeKind) {
    // (The pad's use changed: what it held as keys is let go, so nothing walks or strikes on.)
    releaseAll();
    modeKind = mk;
    navHeld = '';
  }
  const pressed = (b: Btn) => f.down.includes(b);
  const letGo = (b: Btn) => f.up.includes(b);

  if (m.kind === 'film') {
    seen = [];
    controls.padStick = { x: 0, y: 0 };
    if (f.down.length) tap('Enter');
    return;
  }
  if (m.kind === 'none') {
    controls.padStick = { x: 0, y: 0 };
    return;
  }

  if (m.kind === 'menu') {
    controls.padStick = { x: 0, y: 0 };
    // (A screen over the wheel: the wheel goes.)
    wheel.close();
    keepChoice(m.layers, true);
    const way = navWay(f, t);
    if (way) move(m.layers, way);
    if (pressed(BTN.A)) pressChoice(m.layers, true);
    if (pressed(BTN.B) || pressed(BTN.MENU)) tap('Escape');
    if (pressed(BTN.LB)) tap('ArrowLeft');
    if (pressed(BTN.RB)) tap('ArrowRight');
    if (f.right.y) scroll(m.layers, f.right.y, dt);
    return;
  }

  // (2.46: a mode of its own, City Escape: the stick walks, the right one zooms, A acts, Menu pauses, View opens its map.)
  if (play.side) {
    controls.padStick = f.left;
    if (f.right.y) view.zoomBy(Math.exp(-f.right.y * 1.6 * dt));
    if (pressed(BTN.A)) tap(act('act'));
    if (pressed(BTN.X) || pressed(BTN.RT)) tap(act('use'));
    if (pressed(BTN.B)) tap('Escape');
    if (pressed(BTN.MENU)) tap('Escape');
    if (pressed(BTN.VIEW)) tap('KeyM');
    return;
  }
  // In play (and on cards in play).
  const g = play.game!;
  const arrows = m.kind === 'play' && m.arrows;
  // The left stick walks; on a card played with the arrows it's the arrows (a slant would step off the gym).
  controls.padStick = arrows ? { x: 0, y: 0 } : f.left;
  if (m.kind === 'card') {
    keepChoice(m.layers, false);
    const way = navWay(f, t, false);
    if (way) move(m.layers, way);
  } else {
    seen = [];
    for (const [b, w] of DPAD) {
      if (pressed(b)) press(ARROW[w]);
      if (letGo(b)) release(ARROW[w]);
    }
    if (arrows) {
      for (const w of ['up', 'down', 'left', 'right'] as const) {
        const code = `Stick${ARROW[w]}`;
        // (The stick's arrows are held apart from the D-pad's: either let go doesn't let the other go.)
        if (stickWay === w && !down.has(code)) {
          down.add(code);
          send('keydown', ARROW[w]);
        } else if (stickWay !== w && down.delete(code)) send('keyup', ARROW[w]);
      }
    } else for (const w of ['up', 'down', 'left', 'right'] as const) if (down.delete(`Stick${ARROW[w]}`)) send('keyup', ARROW[w]);
  }

  if (wheel.isOpen) {
    if (pressed(BTN.A)) pressChoice(m.kind === 'card' ? m.layers : [wheel.el], true);
    if (pressed(BTN.B) || pressed(BTN.VIEW)) wheel.close();
    if (pressed(BTN.MENU)) {
      wheel.close();
      hooks.pause();
    }
    return;
  }

  // RT: a quick press throws straight ahead; held, it aims (the right stick moves the spot), let go throws.
  if (pressed(BTN.RT)) {
    rtAt = t;
    rtAimed = false;
    // (Armed from the item's menu: RT throws where it aims.)
    if (aiming()) {
      padAimThrow();
      rtAt = -1;
    }
  }
  // (Not in the manhunt: its stone goes straight ahead, the outside has no aim.)
  if (rtAt >= 0 && !g.hunt && f.held[BTN.RT] && !rtAimed && (t - rtAt > RT_HOLD || f.right.x !== 0 || f.right.y !== 0)) {
    padAimStart();
    rtAimed = true;
  }
  if (letGo(BTN.RT) && rtAt >= 0) {
    if (rtAimed) {
      if (aiming()) padAimThrow();
    } else tap(act('throwAhead'));
    rtAt = -1;
  }
  if (aiming()) {
    pockets = false;
    if (f.right.x || f.right.y) padAimMove(f.right.x, f.right.y, dt);
  } else if (f.right.y && !(m.kind === 'card' && scroll(m.layers, f.right.y, dt))) view.zoomBy(Math.exp(-f.right.y * 1.6 * dt));

  // A: a throw aimed from the menu, else the card's choice, else act.
  if (pressed(BTN.A)) {
    if (aiming()) padAimThrow();
    else if (!(m.kind === 'card' && pressChoice(m.layers, false))) tap(act('act'));
  }
  // B: let go of an aim, the item's menu, the pockets, the announcement's card, then what's open; nothing open, nothing (Menu pauses).
  if (pressed(BTN.B)) {
    if (aiming()) closeSomething();
    else if (shown(document.querySelector('.item-info')) && itemsUI.closeMenu()) {
      /* (the item's menu shut) */
    } else if (pockets) pockets = false;
    else if (shown(document.querySelector('.pa-card'))) tap('Escape');
    else if (!g.hunt) closeSomething();
  }
  if (pressed(BTN.MENU)) hooks.pause();
  if (pressed(BTN.VIEW)) openWheel();
  // Held: the tool, the block, digging up.
  for (const [b, a] of [
    [BTN.X, 'use'],
    [BTN.LT, 'block'],
    [BTN.R3, 'digUp'],
  ] as const) {
    if (pressed(b)) press(act(a));
    if (letGo(b)) release(act(a));
  }
  if (pressed(BTN.Y)) tap(act('lock'));
  if (pressed(BTN.L3)) tap(act('drop'));
  // The hotbar, a slot along (not on a card, where the digits answer).
  if ((pressed(BTN.LB) || pressed(BTN.RB)) && m.kind === 'play' && !g.hunt) {
    const hand = g.rec.sim.state.items.hand;
    sendOp(OP.SELECT, ((hand < 0 || hand >= HOTBAR ? 0 : hand) + (pressed(BTN.RB) ? 1 : HOTBAR - 1)) % HOTBAR);
  }
}

/** RT held this long (s) aims rather than throwing straight ahead. */
const RT_HOLD = 0.2;
let rtAt = -1;
let rtAimed = false;

/** The layers seen last frame: one new since gets its first choice (a card just opened: A presses what it shows first). */
let seen: HTMLElement[] = [];
/** On a card or a screen, the choice kept: one just opened gets its first, one redrawn gets back the one it had. */
function keepChoice(layers: HTMLElement[], leaveOk: boolean) {
  const fresh = layers.filter((l) => !seen.includes(l));
  seen = layers;
  const f = document.activeElement;
  if (fresh.length) {
    // (Unless it put the focus somewhere itself: the pause on Resume, a panel on its own first.)
    if (f && fresh.some((l) => l.contains(f))) return;
    const pick = firstChoice(fresh.flatMap(choices), leaveOk);
    if (pick) choose(pick, layers, layers.flatMap(choices));
    return;
  }
  if (f && f !== document.body && layers.some((l) => l.contains(f))) return;
  // The focus lost (the card redrawn under it): the choice it had, put back.
  const all = layers.flatMap(choices);
  const pick = all.length ? current(layers, all, leaveOk) : undefined;
  if (pick) choose(pick, layers, all);
}

/** The wheel, with the panels there's something for now (as the HUD's chips show them). */
function openWheel() {
  const g = play.game;
  if (!g) return;
  releaseAll();
  const chip = (sel: string) => shown(document.querySelector(sel));
  const has: Partial<Record<Action | 'pockets', boolean>> = {
    job: chip('.hud-job'),
    rat: chip('.hud-rat'),
    phone: chip('.hud-order'),
    crew: g.rec.sim.state.followers.length > 0,
    objectives: !!g.lesson,
    pockets: shown(document.querySelector('.hotbar')),
  };
  // (The manhunt, outside: only How to play and a lesson's objectives, as its keys H and O.)
  wheel.open(WHEEL.filter((r) => (g.hunt ? r.action === 'help' || (r.action === 'objectives' && !!g.lesson) : (has[r.action] ?? true))));
}

wheel.onPick = (a) => {
  wheel.close();
  if (a === 'pockets') {
    pockets = true;
    return;
  }
  // (Its key, as if pressed: keys.ts opens the panel as it always does.)
  tap(act(a));
};

// ------------------------------------------------------------------ rumble

type Actuator = { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> };
const rumbles = (p: Gamepad) => typeof (p as unknown as { vibrationActuator?: Actuator }).vibrationActuator?.playEffect === 'function';
async function rumbleOn(p: Gamepad, ms: number, strong: number, weak: number) {
  try {
    await (p as unknown as { vibrationActuator: Actuator }).vibrationActuator.playEffect!('dual-rumble', {
      duration: ms,
      strongMagnitude: strong,
      weakMagnitude: weak,
    });
  } catch {
    /* the pad said no */
  }
}

// ------------------------------------------------------------------ the keys and fingers take over

/** A real key or a finger: the pad is put down (texts name keys again, no ring). */
export function listenPad() {
  const off = (e: Event) => {
    if (e.isTrusted) using(null);
  };
  addEventListener('keydown', off, true);
  addEventListener('pointerdown', off, true);
  addEventListener('wheel', off, { capture: true, passive: true });
  // Hidden or out of focus: whatever the pad held is let go, and what's still held then waits to be let go.
  const lose = () => {
    releaseAll();
    reader.reset();
    controls.padStick = { x: 0, y: 0 };
  };
  addEventListener('blur', lose);
  document.addEventListener('visibilitychange', lose);
}

/** Whether the pad is the device in hand (tests, the help's layout). */
export const padInHand = () => kind;
