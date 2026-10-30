import { itemDef } from '../content/items';
import { CATALOGUE, FEES, PARCEL_MINUTE, VISIT_STEPS, WAY } from '../content/smuggling';
import { currentLang, t, type Key } from '../i18n';
import { placePhrase } from '../i18n/barks/grammar';
import { EXT, headingAngle, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { planOf, TODAY } from '../sim/systems/calendar';
import { DAY_STEPS, dayMinute, prisonDay } from '../sim/systems/clock';
import { itemOf } from '../sim/systems/items';
import { archesUp, arrival, awaitingVisit, catalogueItem, dropTile, firstDay, guestSpot, landingTile, PHONE, smugglingOf, visitExits, visitPairs, wayOpen } from '../sim/systems/smuggling';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { seatSpot } from '../sim/systems/rest';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { DRONE_IN, DRONE_OUT, type SmuggleFrame } from '../render/Smuggling';
import { MAP_W, tileOfKey } from '../sim/world/World';
import type { ZoneId } from '../content/zones';
import type { HudState } from '../ui/hud';
import { itemName } from '../ui/items';
import type { PhoneView, PhoneWay } from '../ui/phone';
import { guardSubject } from '../ui/social';
import { banner, closeSocial, hud, itemsUI, phonePanel, sound } from './context';
import { dayTime } from './day';
import { play, sendOp } from './game';
import { coachOnce, markTip, seenTip } from './tips';
import { TOUCH } from '../ui/dom';
import { HEARINGS } from '../content/parole';
import { boardShown } from './parole';
import { centerX, centerZ } from '../sim/world/grid';

/**
 * Smuggling on screen (P21): the phone's panel (what an order costs each way, and when and
 * where it would come), the order's pill on the HUD, the visitor's wait, and what its events
 * say. All of it from the sim's own schedule (smuggling.ts `arrival`), so what the phone says
 * is what happens.
 */

/** A zone's words in the language ("in the yard", "the yard"). */
function zoneWords(z: ZoneId): { at: string; the: string } {
  return placePhrase(currentLang(), z) ?? { at: t(`zone.${z}` as Key), the: t(`zone.${z}` as Key) };
}

/** Where the drone drops: the zone in the middle of its area. */
function dropZone(sim: Sim): ZoneId {
  const r = smugglingOf(sim)!.drop;
  return sim.world.zoneAt((r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1);
}

/** Where visitors sit: the zone in the middle of the visiting room. */
function visitZone(sim: Sim): ZoneId {
  const r = smugglingOf(sim)!.visits!;
  return sim.world.zoneAt((r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1);
}

/** Where the visitors sit, in a sentence ("in the canteen"; '' where nobody visits). */
export const visitPlaceAt = (sim: Sim) => (smugglingOf(sim)?.visits ? zoneWords(visitZone(sim)).at : '');

/** When and where an order would come (or the one on its way will): "Tonight at 21:20, over the yard". */
function whenText(sim: Sim, way: number, order: readonly number[]): string {
  const a = arrival(sim, order);
  if (!a) return t('phone.whenNone');
  const now = prisonDay(sim.state.step);
  const rel = a.day === now ? 'Today' : a.day === now + 1 ? 'Tomorrow' : 'Day';
  // (Where that night's drop lands: the drop area is one zone, but its own tile says it.)
  if (way === WAY.DRONE) {
    const tile = dropTile(sim, a.day);
    return t(`phone.drone${rel}` as Key, { n: a.day, time: dayTime(a.minute), place: zoneWords(tile >= 0 ? sim.world.zoneAt(tile % MAP_W, Math.floor(tile / MAP_W)) : dropZone(sim)).the });
  }
  if (smugglingOf(sim)!.parcel) return t(`phone.parcel${rel}` as Key, { n: a.day, time: dayTime(PARCEL_MINUTE) });
  const until = planOf(sim, a.day).until;
  return t(`phone.visit${rel}` as Key, { n: a.day, from: dayTime(a.minute), to: dayTime(until), place: zoneWords(visitZone(sim)).at });
}

/** A way's icon and name here (the visitor's is a parcel at Stalag Flucht). */
function wayLook(sim: Sim, way: number): { icon: string; label: string } {
  if (way === WAY.DRONE) return { icon: 'drone', label: t('phone.wayDrone') };
  return smugglingOf(sim)!.parcel ? { icon: 'box', label: t('phone.wayParcel') } : { icon: 'users', label: t('phone.wayVisitor') };
}

const ways: PhoneWay[] = [];
const rows = CATALOGUE.map((c, k) => ({ k, item: catalogueItem(k), name: '', price: c.price, contraband: itemDef(catalogueItem(k)).contraband }));
const view: PhoneView = { status: '', statusIcon: 'phone', say: '', ready: false, note: '', ways, rows, cash: 0 };

/** The order on its way, or what the drone left lying (a sentence; '' none), and its icon. */
function orderStatus(sim: Sim): { text: string; icon: string } {
  const s = sim.state;
  if (s.order.length === 3) {
    const [k, way] = s.order;
    const item = itemName(catalogueItem(k));
    const key = way === WAY.DRONE ? 'phone.onWayDrone' : smugglingOf(sim)!.parcel ? 'phone.onWayParcel' : 'phone.onWayVisitor';
    // (Mid-sentence: "…by drone: tonight at 21:20".)
    const when = whenText(sim, way, s.order);
    return { text: t(key, { item, when: when.charAt(0).toLocaleLowerCase() + when.slice(1) }), icon: wayLook(sim, way).icon };
  }
  if (s.drops.length) {
    const [key, item] = s.drops[s.drops.length - 1];
    const tile = tileOfKey(key);
    return { text: t('phone.lying', { item: itemName(item), place: zoneWords(sim.world.zoneAt(tile % MAP_W, Math.floor(tile / MAP_W))).at }), icon: 'drone' };
  }
  return { text: '', icon: 'phone' };
}

/** The phone's panel (null where there's no smuggling). */
export function phoneView(sim: Sim): PhoneView | null {
  const d = smugglingOf(sim);
  if (!d) return null;
  const s = sim.state;
  const held = itemOf(s.items.inv[s.items.hand]) === PHONE;
  const st = orderStatus(sim);
  view.status = st.text;
  view.statusIcon = st.icon;
  view.say = st.text || t('phone.nothing');
  view.ready = held && !s.order.length && !s.sleeping && !s.stowed && !sim.away;
  view.note = !held ? t('phone.holdIt') : s.order.length ? t('phone.oneAtATime') : t('phone.cash', { n: s.cash });
  view.cash = s.cash;
  ways.length = 0;
  for (const way of [WAY.DRONE, WAY.VISITOR]) {
    if (!wayOpen(d, way)) continue;
    const hypo = [0, way, firstDay(sim, way)];
    ways.push({ way, ...wayLook(sim, way), fee: FEES[way], when: whenText(sim, way, hypo), open: !!arrival(sim, hypo) });
  }
  for (const r of rows) r.name = itemName(r.item);
  return view;
}

/** The HUD's order pill: an order on its way, a drop lying, the visitor coming (null: none of them). */
const hudOrder: NonNullable<HudState['order']> = { icon: '', text: '', sr: '', urgent: false, done: null, panel: true };
/** Worked out once a step (and again with the language): its strings never change between steps. */
let hudKey = '';
let hudLast: HudState['order'] = null;
export function orderHud(sim: Sim): HudState['order'] {
  const s = sim.state;
  const key = `${s.step}|${s.items.rev}|${currentLang()}`;
  if (key === hudKey) return hudLast;
  hudKey = key;
  hudLast = orderPill(sim);
  return hudLast;
}

/** Whether the phone's panel has anything to show: a phone carried, an order on its way, a drop lying. */
function phoneMatters(sim: Sim): boolean {
  const s = sim.state;
  return !!smugglingOf(sim) && (s.items.inv.some((v) => itemOf(v) === PHONE) || s.order.length > 0 || s.drops.length > 0);
}

function orderPill(sim: Sim): HudState['order'] {
  const d = smugglingOf(sim);
  if (!d) return null;
  const s = sim.state;
  hudOrder.done = null;
  hudOrder.urgent = false;
  // (Tapped, the phone's panel, if there's anything for it to show; a visitor alone has nothing there.)
  hudOrder.panel = phoneMatters(sim);
  // Sat waiting for the visitor: how long it's been.
  if (awaitingVisit(sim)) {
    hudOrder.icon = 'users';
    hudOrder.text = t('phone.pillVisit');
    hudOrder.sr = t('phone.pillVisitSr');
    hudOrder.done = s.visit / VISIT_STEPS;
    return hudOrder;
  }
  if (s.drops.length) {
    hudOrder.icon = 'drone';
    hudOrder.text = t('phone.pillDrop');
    hudOrder.sr = orderStatus(sim).text;
    hudOrder.urgent = true;
    return hudOrder;
  }
  if (s.order.length !== 3) return null;
  const a = arrival(sim);
  const look = wayLook(sim, s.order[1]);
  hudOrder.icon = look.icon;
  // (Its time today; "now" once it's come round: visiting hours on, the parcel waiting for room.)
  const today = !!a && a.day === prisonDay(s.step);
  hudOrder.text = !a ? '…' : !today ? t('phone.pillDay', { n: a.day }) : dayMinute(s.step) >= a.minute ? t('phone.pillNow') : dayTime(a.minute);
  hudOrder.sr = orderStatus(sim).text;
  return hudOrder;
}

/** The panel's Order button, and the pill. */
export function wirePhone() {
  hud.onOrder = () => {
    const g = play.game;
    if (!g || g.paused || (!phonePanel.isOpen && !phoneMatters(g.rec.sim))) return;
    sound.click();
    if (!phonePanel.isOpen) {
      closeSocial();
      itemsUI.closePanels();
    }
    togglePhone();
  };
  phonePanel.onOrder = (k, way) => {
    sendOp(OP.EXT, EXT.ORDER, k, way);
    phonePanel.close();
  };
}

/** P, the phone's button, or the pill: the panel open or shut (only where there's smuggling, with a phone or an order to see to). */
export function togglePhone(focus = false) {
  const g = play.game;
  if (!g || g.paused) return;
  const sim = g.rec.sim;
  if (!phoneMatters(sim) && !phonePanel.isOpen) return;
  if (!phonePanel.isOpen) closeSocial();
  phonePanel.toggle(focus);
}

/** Who visits today: one of the language's visitors, by the run and the day. */
function visitorName(sim: Sim): string {
  const names = t('visit.who').split('|');
  return names[((sim.state.salt >>> 3) + prisonDay(sim.state.step) * 7) % names.length];
}

/** How near a ground tile is to the player (full close by, a whisper far off). */
function gainAt(sim: Sim, tile: number) {
  const p = sim.state.player;
  const x = (tile % MAP_W) + 0.5;
  const z = Math.floor(tile / MAP_W) + 0.5;
  return Math.max(0.2, Math.min(1, 1.2 - Math.hypot(x - p.x / UNIT, z - p.z / UNIT) / 20));
}

/** What a smuggling event says and sounds like. */
export function announceSmuggle(sim: Sim, e: Extract<SimEvent, { type: 'smuggle' }>) {
  const item = e.item ? itemName(e.item) : '';
  switch (e.what) {
    case 'ordered':
      sound.phone();
      banner.toast(t('toast.ordered', { item, when: whenText(sim, e.way ?? 0, sim.state.order) }), 'good', 4600);
      coachOnce('ordered', e.way === WAY.DRONE ? 'hint.drone' : smugglingOf(sim)?.parcel ? 'hint.parcel' : 'hint.visit');
      break;
    case 'turnedBack':
      // (The sirens, or a guard looking right where it would land.)
      if (e.guard !== undefined) itemsUI.toast(t('toast.turnedBackWatched', { item, guard: t('guard.the', { name: sim.prison.guards[e.guard]?.name ?? '' }) }));
      else itemsUI.toast(t('toast.turnedBack', { item }));
      break;
    case 'dropped': {
      const tile = e.tile ?? 0;
      sound.parcelThump(gainAt(sim, tile));
      banner.toast(t('toast.dropped', { item, place: zoneWords(sim.world.zoneAt(tile % MAP_W, Math.floor(tile / MAP_W))).at }), 'good', 4600);
      break;
    }
    case 'seized':
      sound.sting();
      banner.toast(t('toast.seized', { guard: guardSubject(sim, e.guard ?? 0), item }), 'bad', 4600);
      break;
    case 'collected':
      sound.chime();
      itemsUI.toast(t('toast.collected', { item }));
      break;
    case 'visit':
      sound.chime();
      banner.toast(t(e.item ? 'toast.visitItem' : 'toast.visit', { who: visitorName(sim), n: e.cash ?? 0, item }), 'good', 5200);
      break;
    case 'noRoom':
      itemsUI.toast(t('toast.visitNoRoom', { item }));
      break;
    case 'parcel':
      sound.chime();
      banner.toast(t('toast.parcel', { item }), 'good', 4600);
      break;
    case 'parcelSeized':
      sound.sting();
      banner.toast(t('toast.parcelSeized', { item }), 'bad', 4600);
      break;
    case 'deskFull':
      itemsUI.toast(t('toast.parcelWaits', { item }));
      break;
  }
}

/** Each frame's hint: the first time the player sits at a visiting seat in visiting hours, what happens next. */
export function smuggleHints(sim: Sim, busy: boolean) {
  if (busy) return;
  // (Short: the visitor comes in three seconds.)
  if (awaitingVisit(sim) && !seenTip('visitWait')) {
    markTip('visitWait');
    banner.toast(t('hint.visitWait'), 'info', 2600);
  }
  const s = sim.state;
  if (itemOf(s.items.inv[s.items.hand]) === PHONE) coachOnce('phone', TOUCH ? 'hint.phone' : 'hint.phoneKeys');
}

// ------------------------------------------------------------------ in the picture

const droneNow: NonNullable<SmuggleFrame['drone']> = { t: 0, x: 0, z: 0, fromX: 0, fromZ: 0, item: 0, lets: true, dropped: false };
const frame: SmuggleFrame = { drone: null, drops: [], arches: [], visitors: [] };
/** The drone's flight seen last (its drop step, the tile it lands on, its item): kept so it flies off after what it dropped is picked up. */
const flight = { step: -1, tile: -1, item: 0 };
/** Where the wind comes from, a tile a step (from north, clockwise in eighths). */
const FROM: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
/** How far off the drone comes from and goes back to (tiles): well off any screen. */
const FLY_FROM = 45;

/** The arches' tiles and which way each beam runs (across its way out), worked out once a prison. */
const archCache = new WeakMap<object, Array<{ tile: number; alongX: boolean }>>();
function archesOf(sim: Sim): Array<{ tile: number; alongX: boolean }> {
  let list = archCache.get(sim.world);
  if (list) return list;
  const w = sim.world;
  const r = smugglingOf(sim)?.visits;
  const outside = (x: number, z: number) => !!r && !(x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) && x >= 0 && z >= 0 && x < MAP_W && (w.ground.base[z * MAP_W + x] === TILE.DOOR || !TILE_INFO[w.ground.base[z * MAP_W + x]].solid);
  list = [...visitExits(w)].map((tile) => {
    const x = tile % MAP_W;
    const z = Math.floor(tile / MAP_W);
    // A way out to the north or south: the beam runs along x.
    return { tile, alongX: outside(x, z - 1) || outside(x, z + 1) };
  });
  archCache.set(w, list);
  return list;
}

/** Each visiting seat's pair as the view wants it: where the visitor sits, facing (radians), on a chair. */
interface Guest {
  tile: number;
  facing: number;
  chair: boolean;
}
const guestCache = new WeakMap<object, Guest[]>();
function guestsOf(sim: Sim): Guest[] {
  let list = guestCache.get(sim.world);
  if (list) return list;
  const seen = new Set<number>();
  list = [];
  for (const p of visitPairs(sim.world)) {
    if (seen.has(p.guest)) continue;
    seen.add(p.guest);
    const x = p.guest % MAP_W;
    const z = Math.floor(p.guest / MAP_W);
    // (Turned round from the seat across: facing the table.)
    const back = ((p.facing - 1 + 8) % 16) + 1;
    list.push({ tile: p.guest, facing: headingAngle(back), chair: sim.world.props.some((q) => q.kind === 'chair' && q.x === x && q.z === z) });
  }
  guestCache.set(sim.world, list);
  return list;
}
/** How many visitors sit about the room besides the player's. */
const AMBIENT = 3;
/** The visitors drawn this frame, reused. */
const pool: Array<SmuggleFrame['visitors'][number]> = Array.from({ length: AMBIENT + 1 }, () => ({ x: 0, z: 0, facing: 0, look: 0, chair: false, arrive: 1 }));
/** The parole board's three (P39): suits, never the guards' navy nor the inmates' orange. */
const members: Array<SmuggleFrame['visitors'][number]> = [0x34363c, 0x5a4636, 0x55595f].map((suit, k) => ({ x: 0, z: 0, facing: 0, look: 101 + k * 17, chair: false, arrive: 1, suit }));
/** The board's three as the room draws them, by place (their faces on the parole card: play/parole.ts). */
export const boardLooks: ReadonlyArray<{ look: number; suit?: number }> = members;
const NO_TILES: number[] = [];
/** Where the player's visitor sat today (a guest tile, -1 none): they stay there until visiting hours are over. */
let metAt = -1;
let metDay = 0;

function seat(k: number, g: Guest, look: number, arrive: number): void {
  const v = pool[k];
  v.x = (g.tile % MAP_W) + 0.5;
  v.z = Math.floor(g.tile / MAP_W) + 0.5;
  v.facing = g.facing;
  v.look = look;
  v.chair = g.chair;
  v.arrive = Math.max(0, Math.min(1, arrive));
  frame.visitors.push(v);
}

/** What smuggling shows this frame (null where there's none): the drone, the drops, the arches and the visitors. */
export function smuggleFrame(sim: Sim, a: number): SmuggleFrame | null {
  const d = smugglingOf(sim);
  if (!d) return null;
  const s = sim.state;
  // (A step behind, as everyone is drawn: between the last step and this one.)
  const now = s.step - 1 + a;
  // The drone to come (an order by drone, due within its flight in), or the drop it just made.
  if (s.order.length === 3 && s.order[1] === WAY.DRONE) {
    const when = arrival(sim);
    if (when) {
      const step = (when.day - 1) * DAY_STEPS + when.minute * STEPS_PER_MINUTE;
      if (step - now <= DRONE_IN * STEPS_PER_SECOND && step >= now - 1) {
        flight.step = step;
        flight.tile = landingTile(sim, when.day);
        flight.item = catalogueItem(s.order[0]);
      }
    }
  }
  const last = s.drops[s.drops.length - 1];
  if (last && last[2] >= flight.step) {
    flight.step = last[2];
    flight.tile = tileOfKey(last[0]);
    flight.item = last[1];
  }
  const t = (now - flight.step) / STEPS_PER_SECOND;
  frame.drone = null;
  if (flight.step >= 0 && flight.tile >= 0 && t >= -DRONE_IN && t <= DRONE_OUT) {
    const wind = planOf(sim, prisonDay(flight.step)).wind;
    const v = droneNow;
    v.t = t;
    v.x = (flight.tile % MAP_W) + 0.5;
    v.z = Math.floor(flight.tile / MAP_W) + 0.5;
    v.fromX = v.x + FROM[wind][0] * FLY_FROM;
    v.fromZ = v.z + FROM[wind][1] * FLY_FROM;
    v.item = flight.item;
    v.lets = !s.lockdown;
    // (Whether it let go: a drop made at its minute; the sirens or a guard watching turn it back with the parcel.)
    v.dropped = !!last && last[2] === flight.step;
    frame.drone = v;
  }
  frame.drops.length = 0;
  for (let k = 0; k < s.drops.length && k < dropPoints.length; k++) {
    const tile = tileOfKey(s.drops[k][0]);
    dropPoints[k].x = (tile % MAP_W) + 0.5;
    dropPoints[k].z = Math.floor(tile / MAP_W) + 0.5;
    frame.drops.push(dropPoints[k]);
  }
  // Visiting hours: the arches, and the visitors.
  const up = archesUp(sim);
  frame.arches = up ? archesOf(sim) : NONE;
  frame.visitors.length = 0;
  // The parole board (P39): its three at their places while the hearing is called, sits and gives its word.
  const board = boardShown(sim) ? HEARINGS[sim.prison.id] : null;
  if (board) {
    const facing = headingAngle(board.face);
    board.board.forEach((q, k) => {
      const tile = q.z * MAP_W + q.x;
      if (occupied(sim, tile)) return;
      const v = members[k];
      v.x = q.x + 0.5;
      v.z = q.z + 0.5;
      v.facing = facing;
      v.chair = sim.world.props.some((r) => r.kind === 'chair' && r.x === q.x && r.z === q.z);
      frame.visitors.push(v);
    });
  }
  const taken = board ? board.board.map((q) => q.z * MAP_W + q.x) : NO_TILES;
  if (!up) {
    metAt = -1;
    return frame;
  }
  const day = prisonDay(s.step);
  if (metDay !== day) {
    metAt = -1;
    metDay = day;
  }
  const guests = guestsOf(sim);
  const mine = s.seat >= 0 ? guestSpot(sim) : -1;
  const came = (s.eventFlags & TODAY.VISITED) !== 0;
  if (came && mine >= 0 && metAt < 0) metAt = mine;
  // The player's visitor: sitting down while they wait; after the visit, staying at that table all morning.
  const at = came ? metAt : mine;
  const k0 = came ? 1 : s.visit / VISIT_STEPS;
  const playerLook = day * 31 + 7;
  // Where the player sits: nobody drawn on them.
  const own = s.seat >= 0 ? seatTile(sim) : -1;
  // A few others at the tables, the same ones all morning whoever sits where: one across from the
  // player's seat is the player's visitor (already there); none where the player or an inmate sits.
  let n = 0;
  let met = false;
  for (let k = 0; k < Math.min(AMBIENT, guests.length); k++) {
    const g = guests[(k * 7 + day * 5 + (s.salt % 11)) % guests.length];
    if (g.tile === own || occupied(sim, g.tile) || taken.includes(g.tile)) continue;
    if (g.tile === at && at >= 0) met = true;
    seat(n++, g, g.tile + day * 13, 1);
  }
  if (at >= 0 && !met && (came || k0 >= 0.4)) {
    for (const g of guests) if (g.tile === at && !occupied(sim, g.tile)) seat(n++, g, playerLook, came ? 1 : (k0 - 0.4) / 0.6);
  }
  return frame;
}

const NONE: SmuggleFrame['arches'] = [];

/** The tile the player's seat is (they stand beside it; the view seats them there). */
function seatTile(sim: Sim): number {
  const sp = seatSpot(sim.world, sim.state.seat, sim.state.player);
  return sp.z * MAP_W + sp.x;
}

/** An inmate standing or sitting still on a ground tile (one walking by doesn't count). */
function occupied(sim: Sim, tile: number): boolean {
  const cx = centerX(tile);
  const cz = centerZ(tile);
  for (const m of sim.state.inmates) if (!m.body.moving && Math.abs(m.body.x - cx) < OCCUPIED && Math.abs(m.body.z - cz) < OCCUPIED) return true;
  return false;
}
const OCCUPIED = Math.round(UNIT * 0.7);
const dropPoints = Array.from({ length: 4 }, () => ({ x: 0, z: 0 }));

/** A game starts or loads: no flight remembered, no visitor met. */
export function resetSmuggle() {
  flight.step = -1;
  flight.tile = -1;
  metAt = -1;
}
