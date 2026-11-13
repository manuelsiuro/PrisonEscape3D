import { itemNumber } from '../../content/items';
import { readPrisoner } from '../../game/prisoner';
import { t, type Key } from '../../i18n';
import { buzz } from '../../app/haptics';
import { banner, click, controls, hint, settings, sleepVeil, sound, view } from '../../play/context';
import { play, tickPlayClock, type SideRun } from '../../play/game';
import { inPlace } from '../../play/lazy';
import { settingsChanged } from '../../play/tips';
import { emptyFrame, type Frame } from '../../render/viewFrame';
import { Autopilot } from '../../sim/ai/autopilot';
import { command, headingAngle } from '../../sim/command';
import { hhmm } from '../../sim/systems/clock';
import { STEPS_PER_SECOND, UNIT } from '../../sim/tuning';
import { MAP_W } from '../../sim/world/World';
import { h } from '../../ui/dom';
import { hideLoading } from '../../ui/loading';
import { showHelp } from '../../ui/screens/help';
import { showPause } from '../../ui/screens/pause';
import { showSettings } from '../../ui/screens/settings';
import { BLOW } from '../content/dead';
import { CityView, type DeadFrame } from '../render/CityView';
import { nightAt, ZED, type Zed } from '../sim/dead';
import { cityItem } from '../content/items';
import { SEARCH_STEPS } from '../content/loot';
import { deleteCitySave, writeCitySave } from '../save';
import { COP, FULL, type City, type CityEvent } from '../sim/City';
import { CityHud, type CityHudState } from '../ui/hud';
import { paintDistrict } from '../ui/mapPaint';
import { CityPockets, type PocketsState } from '../ui/pockets';
import { showCityIntro, showCityMap, showCityOver } from '../ui/screens';

/**
 * City Escape in play (C1): its own simulation (city/sim/City.ts) stepped at the prisons' pace from
 * the same controls (the stick, the keys, a tap to walk, a pad), drawn by the same view on the
 * district's world (city/render/CityView.ts the rest), its own HUD and map. No prison game is in
 * progress meanwhile: the loop, the keys and the pad reach it as `play.side`. A part of its own,
 * fetched when City Escape is first opened (play/lazy.ts).
 */
interface CityRun extends SideRun {
  city: City;
  /** Where the player was before the last step (the view eases between the two). */
  prev: { x: number; z: number };
  pilot: Autopilot;
  /** One-step operations waiting for the next steps (one a step): [op, a]. */
  ops: Array<[number, number]>;
  paused: boolean;
  /** Written to storage since it last changed district or was paused. */
  saved: boolean;
  resolve: () => void;
}

const INMATE_OUTFIT = itemNumber('inmate_outfit');
/** What lies on the ground is drawn as a parcel (the view's items are the prisons'). */
const PILE = itemNumber('parcel');
/** Asleep, the night runs fast (as the prisons' does). */
const SLEEP_SPEED = 40;

// (Made as its code comes in, after the rest of the page: put where they'd have been made, see lazy.ts.)
const [cityView, cityHud, veil, pockets] = inPlace('city', () => {
  const v = new CityView();
  view.scene.add(v.root);
  const veilEl = h('div', 'city-veil');
  document.body.append(veilEl);
  return [v, new CityHud(), veilEl, new CityPockets()] as const;
});
/** A bite: the screen's edges flash red. */
const bitten = h('div', 'city-bitten');
document.body.append(bitten);
pockets.onOp = (op, a = 0) => {
  click();
  run()?.ops.push([op, a]);
};
pockets.onAct = () => {
  click();
  act();
};
pockets.onHit = () => hit();
cityHud.onPause = () => void pauseCity();
cityHud.onMap = () => void openMap();

const run = (): CityRun | null => play.side as CityRun | null;

/**
 * A city on screen: the district the player is in, their prisoner as they look, the HUD and the
 * controls the city's. `fresh`: a new city (the story's first card). Resolves when it's left for
 * the title (saved as it is).
 */
export function runCity(city: City, fresh: boolean): Promise<void> {
  return new Promise((resolve) => {
    const s = city.state;
    const r: CityRun = {
      city,
      prev: { x: s.player.x, z: s.player.z },
      pilot: new Autopilot(city.world, () => city.grid),
      ops: [],
      paused: false,
      saved: false,
      resolve,
      frame: (dt, now) => cityFrame(r, dt, now),
      key: (code, e) => cityKey(r, code, e),
      tap: (cx, cy) => cityTap(r, cx, cy),
    };
    stage(r, true);
    view.setPrisoner(readPrisoner());
    view.zoomTo(1.1);
    cityHud.show(true);
    pockets.show(true);
    sleepVeil.querySelector('span')!.textContent = t('sleep.asleep');
    hint.hide();
    document.body.classList.add('is-playing', 'city-on');
    controls.reset();
    controls.enabled = true;
    play.side = r;
    play.acc = 0;
    play.last = performance.now();
    sound.music('tension');
    sound.ambience(true);
    sound.setCoast(false);
    sound.setForest(false);
    hideLoading();
    save(r);
    if (fresh) void under(r, () => showCityIntro(click)).then(() => arrive(r));
    else arrive(r);
  });
}

/** The district the player is in, on screen (`first`: the camera starts a little wide and settles in). */
function stage(r: CityRun, first = false) {
  const c = r.city;
  const p = c.state.player;
  view.setWorld(c.world, null);
  view.setCast(0);
  view.setGuards([], []);
  cityView.set(c.plan, c.district);
  view.snapTo(p.x / UNIT, p.z / UNIT, first && !settings.reducedMotion ? 0.8 : undefined);
  r.pilot = new Autopilot(c.world, () => c.grid);
  r.prev.x = p.x;
  r.prev.z = p.z;
  picture = null;
  sound.setScene(nightAt(c.minute) ? 'outdoorNight' : 'outdoorDay');
}

/** Where they've come to, said. */
function arrive(r: CityRun) {
  const c = r.city;
  banner.show(c.plan.names[c.state.district], t(`city.kind.${c.plan.kinds[c.state.district]}` as Key), 'routine', 3200);
}

/** The city in progress written to its slot. */
function save(r: CityRun) {
  const c = r.city;
  // (A city lost, Hardcore: nothing to carry on.)
  if (c.state.over) return void deleteCitySave();
  r.saved = writeCitySave({
    v: 1,
    at: Date.now(),
    game: __APP_VERSION__,
    name: c.plan.names[c.state.district],
    day: c.day,
    minute: c.minute,
    mode: c.state.mode,
    snap: c.snapshot(),
  });
}

/** A screen of the city's own over it: the city waits, the controls let go; back on when it closes (unless the city was left meanwhile). */
async function under<T>(r: CityRun, screen: () => Promise<T>): Promise<T> {
  r.paused = true;
  r.pilot.stop();
  controls.enabled = false;
  controls.reset();
  const out = await screen();
  if (play.side === r) {
    r.paused = false;
    controls.enabled = true;
    play.last = performance.now();
  }
  return out;
}

async function openMap() {
  const r = run();
  if (!r || r.paused) return;
  click();
  await under(r, () => showCityMap(r.city, click));
}

/** The pause card: saved as it opens; Settings, How to play, back to the title. */
async function pauseCity() {
  const r = run();
  if (!r || r.paused) return;
  click();
  save(r);
  await under(r, async () => {
    for (;;) {
      const c = r.city;
      const place = `${t('city.title')} · ${c.plan.names[c.state.district]} · ${t('city.hud.day', { n: c.day })}`;
      const choice = await showPause(click, r.saved, false, '', false, place);
      if (choice === 'settings') await showSettings(settings, settingsChanged, click);
      else if (choice === 'help') await showHelp(click, {});
      else if (choice === 'quit') return stopCity();
      else return;
    }
  });
}

/** The city comes down (back to the title): saved as it is, its HUD and pieces away. */
export function stopCity() {
  const r = run();
  if (!r) return;
  save(r);
  play.side = null;
  cityHud.show(false);
  pockets.show(false);
  sleepVeil.classList.remove('on');
  cityView.clear();
  banner.clear();
  controls.enabled = false;
  controls.reset();
  sound.ambience(false);
  veil.classList.remove('on');
  bitten.classList.remove('on');
  document.body.classList.remove('is-playing', 'city-on');
  r.resolve();
}

// ------------------------------------------------------------------ the player's input
/** The action button / E: what's in reach searched, looked at, slept in. */
function act() {
  const r = run();
  if (!r || r.paused) return;
  r.pilot.stop();
  pockets.pick(-1);
  r.ops.push([COP.ACT, 0]);
}

/** The blow (Space, its button): as often as the arm allows. */
function hit() {
  const r = run();
  if (!r || r.paused || r.city.state.sleeping) return;
  if (r.city.state.step - r.city.state.swung < BLOW.every) return;
  if (!r.ops.some((o) => o[0] === COP.HIT)) r.ops.push([COP.HIT, 0]);
}

function cityKey(r: CityRun, code: string, e: KeyboardEvent) {
  // Escape shuts a thing's card, then the open box, and only then pauses.
  if (code === 'Escape') {
    if (pockets.open) pockets.pick(-1);
    else if (r.city.state.open) r.ops.push([COP.CLOSE, 0]);
    else void pauseCity();
  } else if (code === 'KeyE' || (code === 'Enter' && !(document.activeElement instanceof HTMLButtonElement))) act();
  else if (code === 'Space' || code === 'KeyF') {
    e.preventDefault();
    hit();
  } else if (/^Digit[1-8]$/.test(e.code)) {
    const k = Number(e.code.slice(5)) - 1;
    if (r.city.state.inv[k]?.[0]) pockets.pick(k);
  } else if (code === 'KeyM') {
    e.preventDefault();
    void openMap();
  } else if (code === 'KeyH') void under(r, () => showHelp(click, {}));
}

/** A tap on the ground: walk there (the nearest open tile where the spot itself is taken). */
function cityTap(r: CityRun, cx: number, cy: number) {
  const p = view.groundAt(cx, cy);
  if (!p) return;
  const c = r.city;
  const tx = Math.floor(p.x);
  const tz = Math.floor(p.z);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (!c.world.inside(x, z) || c.grid[z * MAP_W + x]) continue;
      const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  if (best >= 0) r.pilot.goTo(best);
}

// ------------------------------------------------------------------ every frame
function cityFrame(r: CityRun, dt: number, now: number) {
  const c = r.city;
  const p = c.state.player;
  if (!r.paused) {
    tickPlayClock(dt * 1000);
    const speed = c.state.sleeping ? SLEEP_SPEED : 1;
    play.acc += dt * speed;
    let steps = 0;
    while (play.acc >= 1 / STEPS_PER_SECOND && steps++ < 40 * speed) {
      play.acc -= 1 / STEPS_PER_SECOND;
      r.prev.x = p.x;
      r.prev.z = p.z;
      for (const z of c.state.zeds) {
        const q = was.get(z);
        if (q) {
          q.x = z.body.x;
          q.z = z.body.z;
        } else was.set(z, { x: z.body.x, z: z.body.z });
      }
      if (controls.steering) r.pilot.stop();
      const op = r.ops.shift();
      c.step(command(controls.steering ? controls.dir() : r.pilot.dir(p), op?.[0] ?? 0, op?.[1] ?? 0));
      for (const e of c.events) cityEvent(r, e);
      // (Over, or carried home: what was waiting is dropped, and nothing slides from the old place.)
      if (c.state.over || c.events.some((e) => e.type === 'dead')) break;
    }
    if (play.acc > 1) play.acc = 0;
  }
  const a = r.paused ? 1 : play.acc * STEPS_PER_SECOND;
  const f = frameOf(r, a);
  cityView.drawDead(deadOf(r, a), now / 1000, r.paused || settings.reducedMotion, nightAt(c.minute), f);
  view.draw(f, dt, now / 1000);
  cityHud.update(hudOf(r));
  pockets.update(pocketsOf(r));
  sleepVeil.classList.toggle('on', c.state.sleeping);
}

function cityEvent(r: CityRun, e: CityEvent) {
  const c = r.city;
  switch (e.type) {
    case 'search':
      sound.stow(true);
      break;
    case 'open':
      if (e.first) sound.stow(false);
      break;
    case 'took':
      sound.pickup();
      break;
    case 'stored':
    case 'dropped':
      sound.stow(true);
      break;
    case 'used':
      if (cityItem(e.item)?.kind === 'med') sound.chime();
      else if (cityItem(e.item)?.shape === 'bottle' || cityItem(e.item)?.shape === 'can') sound.gulp();
      else sound.munch(true);
      break;
    case 'full':
      banner.toast(t('city.toast.full'), 'info', 2200);
      break;
    case 'refused':
      banner.toast(t(`city.toast.${e.why}` as Key), 'info', 2400);
      break;
    case 'starving':
      banner.toast(t('city.toast.starving'), 'bad', 3600);
      buzz('missed');
      break;
    case 'sleep':
      r.pilot.stop();
      r.ops.length = 0;
      if (e.on) {
        sleepVeil.querySelector('span')!.textContent = t('sleep.asleep');
        sound.yawn();
        save(r);
      } else {
        play.acc = 0;
        if (e.why && e.why !== 'stirred')
          banner.toast(t(`city.toast.woke.${e.why}` as Key), e.why === 'hungry' || e.why === 'attacked' ? 'bad' : 'good', 3000);
        save(r);
      }
      break;
    case 'spotted':
      sound.grunt();
      break;
    case 'bite':
      sound.slap();
      buzz('missed');
      bitten.classList.remove('on');
      void bitten.offsetWidth;
      bitten.classList.add('on');
      break;
    case 'swing':
      sound.swish();
      if (e.hit) sound.scuffle();
      if (e.dead) sound.dud();
      break;
    case 'dusk':
      banner.show(t('city.dusk.title'), t(e.soon > 60 ? 'city.dusk.two' : 'city.dusk.half'), 'alarm', 5200);
      sound.chime();
      break;
    case 'night':
      banner.show(
        t(e.on ? 'city.night.title' : 'city.dawn.title'),
        t(e.on ? 'city.night.sub' : 'city.dawn.sub'),
        e.on ? 'alarm' : 'routine',
        5200,
      );
      sound.setScene(e.on ? 'outdoorNight' : 'outdoorDay');
      break;
    case 'dead':
      r.ops.length = 0;
      r.pilot.stop();
      sound.sting();
      buzz('missed');
      if (e.final) {
        save(r);
        void under(r, () => showCityOver(c.day, c.plan.names[c.state.district], click)).then(() => stopCity());
        break;
      }
      // A Survivor: home, the next morning, behind a blink of dark.
      veil.classList.remove('on');
      void veil.offsetWidth;
      veil.classList.add('on');
      if (e.moved) stage(r);
      else {
        view.snapTo(c.state.player.x / UNIT, c.state.player.z / UNIT);
        r.prev.x = c.state.player.x;
        r.prev.z = c.state.player.z;
      }
      play.acc = 0;
      sound.setScene(nightAt(c.minute) ? 'outdoorNight' : 'outdoorDay');
      banner.show(t('city.fell.title'), t('city.fell.sub'), 'alarm', 5200);
      save(r);
      break;
    default:
      break;
  }
  if (e.type === 'travel') {
    // Through a checkpoint: the next district put up behind a blink of dark, then said.
    veil.classList.remove('on');
    void veil.offsetWidth;
    veil.classList.add('on');
    stage(r);
    play.acc = 0;
    sound.gateShut();
    arrive(r);
    save(r);
  }
}

// ------------------------------------------------------------------ what the view and the HUD are handed
const frame: Frame = { ...emptyFrame(), wearRev: 0 };
const tapAt = { x: 0, z: 0 };

function frameOf(r: CityRun, a: number): Frame {
  const c = r.city;
  const p = c.state.player;
  const f = frame;
  f.x = (r.prev.x + (p.x - r.prev.x) * a) / UNIT;
  f.z = (r.prev.z + (p.z - r.prev.z) * a) / UNIT;
  f.facing = headingAngle(p.facing);
  f.moving = p.moving && !r.paused;
  f.speed = 1;
  f.minuteOfDay = c.minute + ((c.state.step % STEPS_PER_SECOND) + a) / STEPS_PER_SECOND;
  f.surface = c.world.ground.kind[c.tile];
  f.tilesRev = c.world.rev;
  f.outfit = INMATE_OUTFIT;
  const dest = r.pilot.destination;
  if (dest >= 0) {
    tapAt.x = (dest % MAP_W) + 0.5;
    tapAt.z = Math.floor(dest / MAP_W) + 0.5;
  }
  f.tap = dest >= 0 ? tapAt : null;
  // What the action button would use, framed on the floor; what lies on the ground.
  const tg = c.state.sleeping ? null : c.target();
  if (tg) {
    const tiles = tg.kind === 'pile' ? [tg.tile] : c.tilesOf(Number(tg.key));
    focus.x0 = Math.min(...tiles.map((i) => i % MAP_W));
    focus.x1 = Math.max(...tiles.map((i) => i % MAP_W));
    focus.z0 = Math.min(...tiles.map((i) => Math.floor(i / MAP_W)));
    focus.z1 = Math.max(...tiles.map((i) => Math.floor(i / MAP_W)));
  }
  f.focus = tg ? focus : null;
  const mine = `${c.state.district}:g`;
  const lying = Object.keys(c.state.boxes).filter((k) => k.startsWith(mine) && c.state.boxes[k].some((st) => st[0]));
  const key = lying.join();
  if (key !== pilesFor.key) {
    pilesFor.key = key;
    piles = lying
      .map((k) => Number(k.slice(mine.length)))
      .map((i) => ({ x: (i % MAP_W) + 0.5, z: Math.floor(i / MAP_W) + 0.5, item: PILE }));
    f.groundRev++;
  }
  f.ground = piles;
  return f;
}
const focus = { x0: 0, z0: 0, x1: 0, z1: 0 };

/** Where each of the dead was before the last step, and what the view is handed of them. */
const was = new WeakMap<Zed, { x: number; z: number }>();
const deadList: DeadFrame[] = [];
function deadOf(r: CityRun, a: number): DeadFrame[] {
  const zeds = r.city.state.zeds;
  deadList.length = zeds.length;
  zeds.forEach((z, k) => {
    const q = was.get(z) ?? z.body;
    const o = (deadList[k] ??= { x: 0, z: 0, facing: 0, moving: false, chasing: false, reeling: false, seed: 0 });
    o.x = (q.x + (z.body.x - q.x) * a) / UNIT;
    o.z = (q.z + (z.body.z - q.z) * a) / UNIT;
    o.facing = headingAngle(z.body.facing);
    o.moving = z.body.moving && !r.paused;
    o.chasing = z.mode === ZED.CHASE;
    o.reeling = z.reel > 0;
    o.seed = z.pace;
  });
  return deadList;
}
let piles: Array<{ x: number; z: number; item: number }> = [];
const pilesFor = { key: '?' };

const pocketsState = {} as PocketsState;
function pocketsOf(r: CityRun): PocketsState {
  const c = r.city;
  const s = c.state;
  const st = pocketsState;
  const tg = c.target();
  st.inv = s.inv;
  const open = s.open;
  st.box = !open ? '' : open.startsWith('g') ? 'city.box.pile' : `city.box.${c.district.props[Number(open)]?.kind ?? 'shelf'}`;
  st.slots = c.box();
  st.target = tg;
  st.targetOpen = !!tg && tg.key === open;
  st.searched = !!tg && c.searched(tg.key);
  st.searching = s.search ? 1 - s.searchLeft / SEARCH_STEPS : 0;
  st.asleep = s.sleeping;
  return st;
}

/** The district's picture as seen so far, painted again when more of it is. */
let picture: { img: ImageData; rev: number } | null = null;
const hudState = {} as CityHudState;

function hudOf(r: CityRun): CityHudState {
  const c = r.city;
  const d = c.state.district;
  if (!picture || picture.rev !== c.seenRev) picture = { img: paintDistrict(c.district, c.seen[d], picture?.img), rev: c.seenRev };
  const lot = c.district.lotAt[c.tile];
  const st = hudState;
  st.name = c.plan.names[d];
  st.kind = t(`city.kind.${c.plan.kinds[d]}` as Key);
  st.place = lot ? t(`city.use.${c.district.lots[lot - 1].use}` as Key) : '';
  st.day = c.day;
  st.time = hhmm(c.minute);
  st.night = nightAt(c.minute);
  st.picture = picture.img;
  st.pictureRev = picture.rev + d * 100003;
  st.x = c.state.player.x / UNIT;
  st.z = c.state.player.z / UNIT;
  st.health = c.state.health / 100;
  st.hunger = c.state.hunger / FULL;
  st.energy = c.state.energy / FULL;
  st.chasing = c.state.zeds.reduce((n, z) => n + (z.mode === ZED.CHASE ? 1 : 0), 0);
  return st;
}

// (Dev builds: the city under way, for the browser checks, as `__game()` is the prisons'.)
if (import.meta.env.DEV) (window as unknown as { __city: () => CityRun | null }).__city = run;

// A hidden page pauses the city and saves it (phones switching apps); the tab closing: one last save.
document.addEventListener('visibilitychange', () => {
  const r = run();
  if (!document.hidden || !r) return;
  save(r);
  if (!r.paused) void pauseCity();
});
addEventListener('pagehide', () => {
  const r = run();
  if (r) save(r);
});
