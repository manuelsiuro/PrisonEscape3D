import { itemNumber } from '../../content/items';
import { readPrisoner } from '../../game/prisoner';
import { t, type Key } from '../../i18n';
import { banner, click, controls, hint, settings, sound, view } from '../../play/context';
import { play, tickPlayClock, type SideRun } from '../../play/game';
import { inPlace } from '../../play/lazy';
import { settingsChanged } from '../../play/tips';
import { emptyFrame, type Frame } from '../../render/viewFrame';
import { Autopilot } from '../../sim/ai/autopilot';
import { command, headingAngle } from '../../sim/command';
import { hhmm } from '../../sim/systems/clock';
import { NIGHT_FROM, NIGHT_TO, STEPS_PER_SECOND, UNIT } from '../../sim/tuning';
import { MAP_W } from '../../sim/world/World';
import { h } from '../../ui/dom';
import { hideLoading } from '../../ui/loading';
import { showHelp } from '../../ui/screens/help';
import { showPause } from '../../ui/screens/pause';
import { showSettings } from '../../ui/screens/settings';
import { CityView } from '../render/CityView';
import { writeCitySave } from '../save';
import type { City, CityEvent } from '../sim/City';
import { CityHud, type CityHudState } from '../ui/hud';
import { paintDistrict } from '../ui/mapPaint';
import { showCityIntro, showCityMap } from '../ui/screens';

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
  paused: boolean;
  /** Written to storage since it last changed district or was paused. */
  saved: boolean;
  resolve: () => void;
}

const INMATE_OUTFIT = itemNumber('inmate_outfit');

// (Made as its code comes in, after the rest of the page: put where they'd have been made, see lazy.ts.)
const [cityView, cityHud, veil] = inPlace('city', () => {
  const v = new CityView();
  view.scene.add(v.group);
  const veilEl = h('div', 'city-veil');
  document.body.append(veilEl);
  return [v, new CityHud(), veilEl] as const;
});
cityHud.onPause = () => void pauseCity();
cityHud.onMap = () => void openMap();

const run = (): CityRun | null => play.side as CityRun | null;

/** Night, as the prisons' lamps have it (21:00 to 05:00). */
const nightAt = (minute: number) => minute >= NIGHT_FROM || minute < NIGHT_TO;

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
  cityView.clear();
  banner.clear();
  controls.enabled = false;
  controls.reset();
  sound.ambience(false);
  veil.classList.remove('on');
  document.body.classList.remove('is-playing', 'city-on');
  r.resolve();
}

// ------------------------------------------------------------------ the player's input
function cityKey(r: CityRun, code: string, e: KeyboardEvent) {
  if (code === 'Escape') void pauseCity();
  else if (code === 'KeyM') {
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
    play.acc += dt;
    let steps = 0;
    while (play.acc >= 1 / STEPS_PER_SECOND && steps++ < 40) {
      play.acc -= 1 / STEPS_PER_SECOND;
      r.prev.x = p.x;
      r.prev.z = p.z;
      if (controls.steering) r.pilot.stop();
      c.step(command(controls.steering ? controls.dir() : r.pilot.dir(p)));
      for (const e of c.events) cityEvent(r, e);
    }
    if (play.acc > 1) play.acc = 0;
  }
  const a = r.paused ? 1 : play.acc * STEPS_PER_SECOND;
  view.draw(frameOf(r, a), dt, now / 1000);
  cityHud.update(hudOf(r));
}

function cityEvent(r: CityRun, e: CityEvent) {
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
  return f;
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
