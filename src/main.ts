import * as THREE from 'three';
import './styles/index.css';
import { PRISONS } from './content/prisons';
import type { PrisonDef } from './content/prisons/types';
import { ROUTINE } from './content/routine';
import { ZONES } from './content/zones';
import { Autopilot } from './sim/ai/autopilot';
import { findPath, smooth, tileAt } from './sim/ai/path';
import { isFloor, placesOf } from './sim/ai/places';
import { command, DIR_X, DIR_Z, OP, SLOT } from './sim/command';
import { Recorder } from './sim/Recorder';
import { Sim, type SimEvent } from './sim/Sim';
import { FAVOR_STATE, jobRooms, nearestProp, STATION_REACH, type Station } from './sim/systems/economy';
import { BoardPanel, inmateName, jobName, TalkPanel, TrainCard, WorkChips } from './ui/social';
import { ProfilePanel } from './ui/profile';
import type { BadgeKind } from './render/Character';
import { DOING } from './sim/systems/inmates';
import { alertOf, CHASE_SPEED, GUARD } from './sim/systems/guards';
import { itemDef, itemNumber, KEY_ITEM_COLORS } from './content/items';
import { CombatUI, type TargetInfo } from './ui/combat';
import { isGuard, lockCandidates, maxHealth, personOf, reachOf, swingSteps } from './sim/systems/combat';
import { lineOfSight } from './sim/ai/sight';
import type { BedPose } from './render/Character';
import { SolitaryPanel } from './ui/solitary';
import { tileOfBody } from './sim/systems/movement';
import { CHOCOLATE_ENERGY, KO_STEPS, STEPS_PER_MINUTE, STRIKE_STEPS, STEPS_PER_SECOND, THROW_RANGE, UNIT, WALK_SPEED } from './sim/tuning';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey } from './sim/world/World';
import { TILE } from './sim/world/tiles';
import { climbTarget, DIRT, facesProp, ladderFootOf, preferClimb, STRIKES, toolTarget, underMyDesk, WALL_CHUNK, type ClimbTarget, type ToolTarget } from './sim/systems/structure';
import { ToolControls, type ToolView } from './ui/tool';
import { showEscaped } from './ui/screens/escaped';
import { formatTime } from './sim/systems/clock';
import type { Body } from './sim/systems/movement';
import { View, type Frame, type Quality } from './render/View';
import { Controls } from './input/Controls';
import { Sound } from './audio/Sound';
import { hasSeen, loadSettings, markSeen, saveSettings } from './game/settings';
import { migrateStorage } from './game/storage';
import { MOBILE, TOUCH, h } from './ui/dom';
import { Hud, routineName, routinePlace, type HudState } from './ui/hud';
import { Hint } from './ui/hint';
import { Banner } from './ui/banner';
import { ItemsUI, itemName, type ItemsView } from './ui/items';
import { interactTarget, itemOf, ownerOf, usesOf, type ItemState, type Target } from './sim/systems/items';
import { containersOf } from './sim/world/containers';
import { warmIcons } from './render/itemIcons';
import type { Key } from './i18n';
import { showTitle } from './ui/screens/title';
import { showPause } from './ui/screens/pause';
import { showSettings } from './ui/screens/settings';
import { registerServiceWorker } from './app/pwa';
import { buzz, setHaptics } from './app/haptics';
import { currentLang, setLang, t } from './i18n';

/**
 * Wiring: storage first, then the long-lived objects, then the flows between screens.
 * Screens are functions that resolve with the player's choice, so each flow reads as a
 * script (title → play → pause → …). The simulation runs in fixed steps; the view
 * interpolates between the last two.
 */
migrateStorage();
const settings = loadSettings();
const sound = new Sound();
const click = () => sound.click();

// ------------------------------------------------------------------ graphics quality
/** Tiers from best to lightest; "auto" starts by device and steps down while frames run slow. */
const TIERS: Quality[] = [
  { shadows: 2048, pixelRatio: Math.min(devicePixelRatio, 2) },
  { shadows: 1024, pixelRatio: Math.min(devicePixelRatio, 1.5) },
  { shadows: 0, pixelRatio: 1 },
];
let tier = MOBILE ? 1 : 0;
const tierFor = () => (settings.quality === 'high' ? 0 : settings.quality === 'low' ? 2 : tier);

// The stencil buffer lets the player's silhouette show through walls (Character.ts).
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
document.body.append(renderer.domElement);
const view = new View(renderer, TIERS[tierFor()]);
const controls = new Controls(renderer.domElement, (f) => view.zoomBy(f));

/** Applies every setting (on start and on each change in the settings screen). */
function applySettings() {
  setLang(settings.lang);
  setHaptics(settings.haptics);
  sound.setVolume(settings.muted ? 0 : settings.sfxVolume);
  view.reducedMotion = settings.reducedMotion;
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  view.setQuality(TIERS[tierFor()]);
  saveSettings(settings);
}
applySettings();

/** Auto quality: if a few seconds of play average under 40 fps, step down one tier. */
const fps = { frames: 0, time: 0 };
function governQuality(dt: number) {
  if (settings.quality !== 'auto' || tier >= TIERS.length - 1) return;
  fps.frames++;
  fps.time += dt;
  if (fps.time < 4) return;
  const rate = fps.frames / fps.time;
  fps.frames = fps.time = 0;
  if (rate < 40) {
    tier++;
    view.setQuality(TIERS[tier]);
  }
}

// ------------------------------------------------------------------ the game
interface Game {
  rec: Recorder;
  /** The player's and inmates' positions before the last step (interpolation). */
  prev: { x: number; z: number };
  prevInmates: Array<{ x: number; z: number }>;
  prevGuards: Array<{ x: number; z: number }>;
  paused: boolean;
  /** How far the player has walked (tiles), for the first-play hint. */
  walked: number;
  /** Tap-to-walk: steers the player with ordinary commands. */
  pilot: Autopilot;
  /** The floor arrows: the way to the routine's place, recomputed now and then. */
  guide: Array<{ x: number; z: number }> | null;
  guideAge: number;
  guideFrom: number;
  /** Dev builds: simulation speed (`]` toggles fast-forward). */
  speed: number;
  /** One-step operations waiting for the next steps (one per step), from the item UI and keys. */
  ops: Array<[number, number, number]>;
  /** Where the ladder comes down (for the action button's label), worked out once. */
  ladderFoot: number;
  /** The escape screen is up: the game is over. */
  over: boolean;
  /** Each guard's own key (item number): the view hangs it on the belt while it's in the guard's pockets. */
  guardKeys: number[];
}
let game: Game | null = null;
let acc = 0;
let last = performance.now();

const hud = new Hud(
  () => pause(),
  () => {
    click();
    toggleProfile();
  },
);
const hint = new Hint();
const banner = new Banner();
const solitaryPanel = new SolitaryPanel();
const vignette = h('div', 'alarm-vignette');
/** Solitary is a dark cell: the edges of the screen close in. */
const darkCell = h('div', 'solitary-veil');
document.body.append(vignette, darkCell);
view.onStep = (surface) => sound.step(surface);

/** Tap or click a spot: walk there (the nearest free floor if the spot itself is taken). */
controls.onTap = (cx, cy) => {
  if (!game || game.paused) return;
  const p = view.groundAt(cx, cy);
  const w = game.rec.sim.world;
  if (!p) return;
  // A tap on someone: lock on to them (GDD §10.1), unless they're already the target (then walk to them).
  const sim = game.rec.sim;
  if (sim.state.layer === LAYER.GROUND) {
    // On screen, against each one's middle (a tap on the head or the torso counts, not just the feet).
    const list = lockCandidates(w, sim.state, sim.state.player, lockList);
    let who = -1;
    let bestPx = TAP_PERSON_PX * TAP_PERSON_PX;
    for (const id of list) {
      const at = view.screenOf(id, floatPoint, 0.75);
      if (!at) continue;
      const d = (at.x - cx) ** 2 + (at.y - cy) ** 2;
      if (d < bestPx) {
        bestPx = d;
        who = id;
      }
    }
    if (who >= 0 && who !== sim.state.lock) {
      sendOp(OP.LOCK, 2 + who);
      return;
    }
  }
  const tx = Math.floor(p.x);
  const tz = Math.floor(p.z);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (!w.inside(x, z) || w.blocked(x, z, game.rec.sim.state.layer)) continue;
      const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  }
  if (best < 0) return;
  game.pilot.goTo(best);
  sound.click();
  if (hint.visible) {
    hint.hide();
    markSeen('walk');
  }
};

const lockList: number[] = [];
/** How close (CSS px) a tap must land to someone's middle to lock on to them. */
const TAP_PERSON_PX = 40;

/** Where the floor arrows lead now: the routine's place while the player hasn't checked in, the cell in a lockdown. */
function guideTarget(sim: Sim): ((i: number) => boolean) | null {
  const s = sim.state;
  const w = sim.world;
  const places = placesOf(w);
  const home = places.bedside[1];
  // A lockdown ends when the guards catch you, wherever you are; solitary and a knockout go
  // nowhere; off the ground floor the player knows their own way.
  if (s.lockdown || s.solitary > 0 || s.ko > 0 || s.layer !== LAYER.GROUND) return null;
  const r = ROUTINE[s.routine];
  // Lights Out is about being in the cell, not having been there.
  if (r.id === 'lightsOut') return sim.playerZone === 'playerCell' ? null : (i) => i === home;
  // The Work Period with a job: the janitor's next puddle (mop in the hotbar), the addressee of
  // a letter in the bag, else the job's room until the player is in it (the stations are framed there).
  if (r.id === 'work' && sim.onDuty) {
    const flow = jobRooms(w)[sim.jobActive()].def.flow;
    const inv = s.items.inv;
    if (flow === 'mop' && s.puddles.length && inv.slice(0, 6).some((v) => itemOf(v) === MOP)) return (i) => s.puddles.includes(i);
    if (flow === 'mail') {
      const to = s.mail.filter((id) => inv.slice(0, 6).some((v) => itemOf(v) === LETTER && usesOf(v) - 1 === id) && s.inmates[id].ko === 0);
      if (to.length) {
        const tiles = to.map((id) => tileAt(s.inmates[id].body.x, s.inmates[id].body.z));
        return (i) => tiles.includes(i);
      }
    }
  }
  const zones = sim.dutyZones;
  if (r.id === 'work' && (s.paid || zones.includes(sim.playerZone))) return null;
  if (!zones.length || (s.attended && r.id !== 'work')) return null;
  if (r.id === 'rollCall' || r.id === 'eveningRollCall') {
    const spot = places.rollCall[0].tile;
    return (i) => i === spot;
  }
  return (i) => zones.includes(ZONES[w.ground.zone[i]]) && isFloor(w, i % MAP_W, Math.floor(i / MAP_W));
}

function updateGuide(g: Game, dt: number) {
  const sim = g.rec.sim;
  const p = sim.state.player;
  const from = tileAt(p.x, p.z);
  g.guideAge += dt;
  if (g.guideAge < 0.35 && from === g.guideFrom) return;
  g.guideAge = 0;
  g.guideFrom = from;
  const goal = guideTarget(sim);
  // On the prison as built: the arrows never lead through the player's own holes.
  const path = goal && findPath(sim.world, from, goal, -1, 2600, undefined, sim.world.npcBlock);
  g.guide = path && path.length ? smooth(sim.world, path, p.x, p.z, undefined, sim.world.npcBlock).map((i) => ({ x: (i % MAP_W) + 0.5, z: Math.floor(i / MAP_W) + 0.5 })) : null;
}

function seenInteract() {
  if (hasSeen('interact')) return;
  markSeen('interact');
  hint.hide();
}

/**
 * First-time tips for guard rules that hinge on items: a contraband tool or weapon in hand
 * (guards who see it get suspicious fast) and the guard outfit (the disguise and its limit).
 */
const coached = { held: 0, outfit: 0 };
function coachItems(held: number, outfit: number) {
  if (held !== coached.held) {
    coached.held = held;
    const d = held ? itemDef(held) : null;
    // The first tool: how to use it first; the warning about contraband in hand the next time.
    if (d?.tool && !hasSeen('tools')) {
      markSeen('tools');
      banner.toast(TOUCH ? t('hint.toolsTouch') : t('hint.toolsKeys'), 'info', 7000);
    } else if (d?.contraband && (d.cat === 'tool' || d.cat === 'weapon') && !hasSeen('contrabandHand')) {
      markSeen('contrabandHand');
      banner.toast(t('hint.contrabandHand'), 'info', 6500);
    }
  }
  if (outfit !== coached.outfit) {
    coached.outfit = outfit;
    if (outfit === GUARD_OUTFIT && !hasSeen('disguise')) {
      markSeen('disguise');
      banner.toast(t('hint.disguise'), 'info', 7000);
    }
  }
}

/** The last thing guards noticed, and when (real time): repeats are quiet for a moment. */
const lastSpotted = { reason: '', at: 0 };

/** Sound, vibration, banners and toasts for what the simulation reports. */
function announce(e: SimEvent, sim: Sim) {
  switch (e.type) {
    case 'routine': {
      if (sim.state.lockdown) break;
      sound.bell();
      buzz('bell');
      const r = ROUTINE[e.routine];
      // The Work Period with a job: to its room; without one, more free time.
      const job = r.id === 'work' ? sim.jobActive() : -1;
      const sub =
        r.id === 'lightsOut'
          ? t('banner.lightsOut')
          : job >= 0
            ? t('banner.toWork', { place: t(`zone.${jobRooms(sim.world)[job].def.zone}` as Key), n: jobRooms(sim.world)[job].def.quota })
            : r.zones.length
              ? t('banner.goTo', { place: routinePlace(e.routine) })
              : t('banner.free');
      banner.show(routineName(e.routine), sub);
      break;
    }
    case 'attended':
      if (ROUTINE[e.routine].id === 'lightsOut') break;
      sound.chime();
      buzz('attended');
      break;
    case 'missed':
      sound.sting();
      buzz('missed');
      if (e.heat < 100) banner.toast(t('toast.missed', { routine: routineName(e.routine), n: e.heat }), 'bad');
      break;
    case 'lockdown':
      // The siren and the red glow follow the state every frame (see frame()).
      if (e.on) {
        buzz('lockdown');
        const missed = sim.events.find((m) => m.type === 'missed' && m.heat >= 100);
        const seen = sim.events.find((m) => m.type === 'spotted');
        const why =
          missed?.type === 'missed'
            ? t('banner.lockdownSub', { routine: routineName(missed.routine) })
            : seen?.type === 'spotted'
              ? t(`spotted.${seen.reason}` as Key)
              : t('banner.lockdownHeat');
        banner.show(t('banner.lockdown'), why, 'alarm', 5000);
      }
      break;
    case 'spotted': {
      // The same thing noticed again within a few seconds (a guard glancing away and back): say it once.
      const now = performance.now();
      if (e.reason === lastSpotted.reason && now - lastSpotted.at < 6000) break;
      lastSpotted.reason = e.reason;
      lastSpotted.at = now;
      sound.whistle();
      buzz('missed');
      // A lockdown in the same step says it in its banner.
      if (!sim.events.some((m) => m.type === 'lockdown')) banner.toast(t(`spotted.${e.reason}` as Key), 'bad');
      break;
    }
    case 'caught':
      sound.thud();
      buzz('lockdown');
      itemsUI.closePanels();
      game?.pilot.stop();
      banner.show(t('banner.caught'), e.solitary ? t('banner.caughtSolitary') : t('banner.caughtInfirmary'), 'alarm', 3000);
      break;
    case 'solitary':
      if (e.on) {
        sound.lockClank();
        banner.show(t('banner.solitary'), e.taken ? t('banner.taken', { n: e.taken }) : t('banner.nothingTaken'), 'alarm', 4500);
      } else {
        sound.chime();
        banner.toast(t('toast.released'), 'good');
      }
      break;
    case 'infirmary':
      sound.chime();
      banner.show(t('banner.infirmary'), e.taken ? t('banner.taken', { n: e.taken }) : t('banner.nothingTaken'), 'routine', 4500);
      break;
    case 'peel':
      seenInteract();
      sound.peel(e.done);
      if (e.done) {
        buzz('bell');
        itemsUI.toast(t('toast.peeled'));
      }
      break;
    case 'shakedown':
      if (e.cells.includes(1)) {
        sound.sting();
        banner.toast(t('toast.shakedownYou'), 'bad', 5000);
      } else banner.toast(t('toast.shakedown', { a: e.cells[0], b: e.cells[1] }), 'info', 4500);
      break;
    case 'searched':
      if (e.cell !== 1) break;
      if (e.taken) {
        sound.sting();
        banner.toast(t('toast.searchedYou', { n: e.taken }), 'bad', 4500);
      } else banner.toast(t('toast.searchedClean'), 'good');
      break;
    case 'bedCheck':
      // Asleep, the night runs fast: no need to hear about it.
      if (sim.state.sleeping) break;
      if (e.result === 'start') banner.toast(t('toast.bedCheck'), 'info');
      else if (e.result === 'pass' && sim.playerZone !== 'playerCell') banner.toast(t('toast.bedCheckPass'), 'good');
      break;
    case 'pickup':
      seenInteract();
      sound.pickup();
      buzz('bell');
      break;
    case 'drop':
      sound.drop();
      break;
    case 'full':
      sound.sting();
      itemsUI.toast(t('items.full'));
      break;
    case 'noRoom':
      sound.sting();
      itemsUI.toast(t('items.noRoom'));
      break;
    case 'open':
      seenInteract();
      itemsUI.closeCraft();
      sound.drawer();
      if (ownerOf(sim.world, e.container) < 0 && !hasSeen('items')) {
        markSeen('items');
        banner.toast(t('hint.items'), 'info', 5000);
      }
      break;
    case 'crafted':
      sound.craft();
      buzz('attended');
      itemsUI.toast(t('craft.made', { item: itemName(e.item) }));
      if (e.first) banner.toast(t('craft.newRecipe'), 'good');
      break;
    case 'sleep':
      sound.click();
      if (e.on) sleepVeil.querySelector('span')!.textContent = t('sleep.asleep');
      break;
    case 'cells':
      if (e.locked) sound.lockClank();
      if (e.locked && !sim.state.lockdown) banner.toast(t('toast.cellsLocked'), 'info');
      break;
    case 'strike':
      sound.strike(e.action, e.broke);
      view.impact(e.action, e.tile, e.layer, e.broke);
      buzz(e.broke ? 'giveWay' : 'strike');
      if (e.broke) {
        const done = ({ chip: 'toast.wallGone', cut: 'toast.fenceGone', unscrew: 'toast.grateGone', dig: e.layer === LAYER.GROUND ? 'toast.shaftDone' : '' } as Record<string, string>)[e.action];
        if (done) itemsUI.toast(t(done as Key));
        if (e.action === 'chip') coachOnce('damage', 'hint.damage');
        // The first chunk or dirt in hand: it's evidence.
        if (e.action === 'chip' || e.action === 'dig' || e.action === 'digUp') coachOnce('evidence', 'hint.evidence');
        if (e.action === 'dig' && e.layer === LAYER.GROUND && underMyDesk(sim.world, e.tile)) coachOnce('deskTunnel', 'hint.deskTunnel');
      }
      break;
    case 'cantStrike': {
      // Holding the button repeats the try: say why once in a while, not every step.
      const now = performance.now();
      if (now - lastCant < 1800) break;
      lastCant = now;
      sound.sting();
      const why = e.why === 'tired' ? 'toast.tired' : e.why === 'reinforced' ? 'toast.reinforced' : e.why === 'poster' ? 'toast.posterCell' : e.why === 'full' ? (e.action === 'eat' ? 'toast.notHungry' : 'toast.pocketsFull') : NEED[e.action];
      itemsUI.toast(t(why as Key));
      break;
    }
    case 'broke':
      sound.sting();
      itemsUI.toast(t('toast.broke', { item: itemName(e.item) }));
      break;
    case 'shocked':
      sound.zap();
      buzz('lockdown');
      itemsUI.closePanels();
      game?.pilot.stop();
      banner.show(t('banner.shocked'), t('banner.shockedSub'), 'alarm', 3500);
      break;
    case 'caveIn':
      tools.release();
      sound.caveIn();
      buzz('lockdown');
      view.impact('dig', e.tile, LAYER.UNDER, true);
      banner.toast(t('toast.caveIn'), 'bad', 5000);
      break;
    case 'layer':
      sound.climb();
      game?.pilot.stop();
      itemsUI.closeCraft();
      // Into or out of the tunnels: a blink of dark while the view changes.
      if ((e.layer === LAYER.UNDER || e.from === LAYER.UNDER) && !settings.reducedMotion) {
        const fade = h('div', 'layer-fade');
        document.body.append(fade);
        fade.addEventListener('animationend', () => fade.remove());
      }
      if (e.layer === LAYER.UNDER) coachOnce('tunnel', TOUCH ? 'hint.tunnelTouch' : 'hint.tunnel');
      if (e.layer === LAYER.VENTS || e.layer === LAYER.ROOF) coachOnce('restrictedUp', 'hint.restrictedUp');
      break;
    case 'covered':
      sound.cover();
      if (e.on) itemsUI.toast(t('toast.covered'));
      break;
    case 'braced':
      sound.cover();
      itemsUI.toast(t('toast.braced'));
      break;
    case 'ate':
      sound.pickup();
      itemsUI.toast(t('toast.ate', { n: CHOCOLATE_ENERGY }));
      break;
    case 'flushed':
      sound.flush();
      itemsUI.toast(t('toast.flushed'));
      break;
    case 'clogged':
      sound.flush(true);
      itemsUI.toast(t('toast.clogged'));
      break;
    case 'repaired':
      banner.toast(t('toast.repaired'), 'info', 4500);
      break;
    case 'escaped':
      escaped();
      break;
    case 'gaveUp':
      banner.show(t('banner.gaveUp'), t('banner.gaveUpSub'), 'routine', 5000);
      break;
    // ---------------------------------------------------------------- combat
    case 'lock':
      // The lock letting go of someone just knocked out: the knockout says it.
      if (e.who >= 0 || !sim.events.some((x) => x.type === 'koed')) sound.lockOn(e.who >= 0);
      if (e.who >= 0) coachOnce('fight', TOUCH ? 'hint.fightTouch' : 'hint.fightKeys');
      break;
    case 'hit':
      sound.punch(e.ko, !!e.weapon);
      buzz(e.ko ? 'giveWay' : 'strike');
      view.blow(-1, e.who, e.ko);
      floatAt(e.who, `${e.dmg}`, 'dealt');
      break;
    case 'thrown':
      sound.splash();
      buzz('giveWay');
      view.throwAt(e.who);
      thrownAt = performance.now();
      break;
    case 'cantHit': {
      const now = performance.now();
      if (now - lastCant < 1200) break;
      lastCant = now;
      sound.whoosh();
      itemsUI.toast(t('toast.tooFar'));
      break;
    }
    case 'hurt':
      sound.hurt();
      buzz('strike');
      combatUI.hurt(e.dmg >= 25);
      if (e.by >= 0) view.blow(e.by, -1, false);
      floatAt(-1, `${e.dmg}`, 'taken');
      // Hit while working: the tool stops (a fight goes on: a held Hit button keeps swinging).
      if (!toolNow?.attack) tools.release();
      break;
    case 'koed': {
      // Knocked out by a thrown cup: the stars when it lands, not while it's in the air.
      const who = e.who;
      const g0 = game;
      const land = () => {
        if (game !== g0) return;
        sound.ko();
        floatAt(who, t('combat.ko'), 'ko');
        coachOnce('loot', 'hint.loot', { s: KO_STEPS / STEPS_PER_SECOND });
      };
      if (performance.now() - thrownAt < 100) setTimeout(land, THROW_FLIGHT_MS);
      else land();
      break;
    }
    case 'floored':
      sound.thud();
      buzz('lockdown');
      itemsUI.closePanels();
      game?.pilot.stop();
      banner.show(t('banner.floored'), t('banner.flooredSub'), 'alarm', 3500);
      break;
    case 'sharpened':
      sound.craft();
      buzz('attended');
      itemsUI.toast(t('toast.sharpened', { item: itemName(e.item) }));
      break;
    // ---------------------------------------------------------------- economy and social life (P6)
    case 'cash':
      if (e.n > 0) {
        sound.coin(e.n >= 20);
        floatAt(-1, `+$${e.n}`, 'cash');
        if (e.why === 'loot') itemsUI.toast(t('toast.foundCash', { n: e.n }));
        coachOnce('file', TOUCH ? 'hint.fileTouch' : 'hint.fileKeys');
        if (e.why === 'wage') {
          buzz('attended');
          banner.show(t('banner.paid', { n: e.n }), t('banner.paidSub', { job: jobName(sim, sim.playerJob) }), 'routine', 3600);
        }
      }
      break;
    case 'work':
      seenInteract();
      sound.work(e.act);
      if (e.act === 'running') itemsUI.toast(t('toast.machineBusy'));
      if (e.act === 'take' || e.act === 'unload') coachOnce('work', 'hint.work');
      break;
    case 'quota': {
      const done = e.n >= e.of;
      if (!done) {
        sound.chime();
        itemsUI.toast(t('toast.quota', { n: e.n, of: e.of }));
      }
      break;
    }
    case 'delivered':
      sound.pickup();
      floatAt(e.who, '✉', 'cash');
      break;
    case 'job':
      if (e.who === -1) {
        if (e.change === 'hired') {
          sound.chime();
          buzz('attended');
          const later = sim.state.jobDay > sim.today;
          banner.toast(t(later ? 'toast.hiredTomorrow' : 'toast.hired', { job: jobName(sim, e.job) }), 'good', 5000);
        } else if (e.change === 'fired') {
          // The bell for the next block rings in the same step: a long toast, not a banner it would replace.
          sound.sting();
          buzz('missed');
          banner.toast(t('toast.fired', { job: jobName(sim, e.job) }), 'bad', 7000);
        } else banner.toast(t('toast.quit', { job: jobName(sim, e.job) }), 'info');
      } else if (e.change === 'fired') banner.toast(t('toast.jobOpen', { name: inmateName(sim, e.who), job: jobName(sim, e.job) }), 'info', 5000);
      break;
    case 'board':
      seenInteract();
      sound.drawer();
      itemsUI.closePanels();
      profile.close();
      board.show();
      break;
    case 'train':
      if (e.on) {
        seenInteract();
        sound.click();
        game?.pilot.stop();
        coachOnce('train', TOUCH ? 'hint.trainTouch' : 'hint.trainKeys');
      }
      break;
    case 'rep':
      sound.rep();
      buzz('strike');
      break;
    case 'trained':
      sound.levelUp();
      buzz('attended');
      floatAt(-1, `+2 ${t(`attr.${e.attr}Short` as Key)}`, 'gain');
      break;
    case 'cantTrain':
      sound.sting();
      itemsUI.toast(t(e.why === 'tired' ? 'toast.tooTiredTrain' : 'toast.maxed'));
      break;
    case 'decay':
      banner.toast(t('toast.decay', { attrs: e.attrs.map((a) => t(`attr.${a}Short` as Key)).join(', ') }), 'bad', 5000);
      break;
    case 'talk':
      if (e.who >= 0) {
        seenInteract();
        sound.drawer();
        itemsUI.closePanels();
        board.close();
        profile.close();
        coachOnce('talk', 'hint.talk');
      }
      break;
    case 'opinion':
      if (e.by > 0) sound.opinionUp();
      break;
    case 'bought':
      sound.buy();
      buzz('bell');
      itemsUI.toast(t('toast.bought', { item: itemName(e.item), n: e.price }));
      break;
    case 'gift':
      sound.pickup();
      itemsUI.toast(e.item ? t('toast.gaveItem', { item: lower(itemName(e.item)), name: inmateName(sim, e.who) }) : t('toast.gaveCash', { n: e.cash, name: inmateName(sim, e.who) }));
      break;
    case 'favor':
      if (e.state === 'taken') {
        sound.chime();
        coachOnce('favor', 'hint.favor');
      } else if (e.state === 'done') {
        sound.chime();
        buzz('attended');
        banner.toast(t('toast.favorDone', { name: inmateName(sim, e.who) }), 'good', 5000);
      } else if (e.state === 'paid') buzz('attended');
      break;
    case 'recruit':
      if (e.on) {
        sound.levelUp();
        banner.toast(t('toast.recruited', { name: inmateName(sim, e.who) }), 'good', 4500);
      } else banner.toast(t('toast.leftYou', { name: inmateName(sim, e.who) }), 'info');
      break;
    case 'ambush':
      sound.whistle();
      buzz('missed');
      banner.toast(t('toast.ambush', { name: inmateName(sim, e.who) }), 'bad', 4500);
      break;
    case 'allyHit':
      sound.punch(e.ko, false);
      view.blow(e.by, e.who, e.ko);
      floatAt(e.who, `${e.dmg}`, 'ally');
      if (e.ko) floatAt(e.who, t('combat.ko'), 'ko');
      break;
    case 'refused': {
      const now = performance.now();
      if (now - lastCant < 600) break;
      lastCant = now;
      sound.sting();
      itemsUI.toast(t(`refused.${e.why}` as Key));
      break;
    }
  }
  if (e.type === 'pickup' && (e.item === DIRT || e.item === WALL_CHUNK)) coachOnce('evidence', 'hint.evidence');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** When a cup was last thrown (real ms), and how long it's in the air (View's flight). */
let thrownAt = -1e9;
const THROW_FLIGHT_MS = 320;

/** A number (or word) floating up from someone (Cast id, -1 the player). */
const floatPoint = { x: 0, y: 0 };
function floatAt(id: number, text: string, kind: 'dealt' | 'taken' | 'ko' | 'cash' | 'gain' | 'ally') {
  const at = view.screenOf(id, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

/** Why a strike can't land, by what it needs. */
const NEED: Record<string, string> = {
  rope: 'toast.noLanding', chip: 'toast.needChip', cut: 'toast.needCut', unscrew: 'toast.needUnscrew', dig: 'toast.needDig', digUp: 'toast.needDig', eat: 'toast.needDig' };
let lastCant = 0;

/** A tip shown the first time something happens (and never again). */
function coachOnce(name: string, key: Key, params?: Record<string, string | number>) {
  if (hasSeen(name)) return;
  markSeen(name);
  banner.toast(t(key, params), 'info', 7000);
}

/** A short fade from black when a game starts. */
function fadeIn() {
  if (settings.reducedMotion) return;
  const veil = h('div', 'veil');
  document.body.append(veil);
  veil.addEventListener('animationend', () => veil.remove());
}

function startGame(prison: PrisonDef) {
  const sim = new Sim(prison, Date.now() & 0x7fffffff);
  view.setWorld(sim.world);
  // Start a little wide and settle in on the player.
  view.snapTo(sim.state.player.x / UNIT, sim.state.player.z / UNIT, settings.reducedMotion ? 1 : 0.8);
  view.zoomBy(1.25);
  view.setCast(sim.state.inmates.map((m) => ({ cell: m.cell, gait: m.speed / WALK_SPEED })));
  view.setGuards(
    guardBeds(sim),
    sim.prison.guards.map((d) => KEY_ITEM_COLORS.find(([c]) => c === d.key)![2]),
  );
  game = {
    rec: new Recorder(sim),
    prev: { x: sim.state.player.x, z: sim.state.player.z },
    prevInmates: sim.state.inmates.map((m) => ({ x: m.body.x, z: m.body.z })),
    prevGuards: sim.state.guards.map((m) => ({ x: m.body.x, z: m.body.z })),
    paused: false,
    walked: 0,
    pilot: new Autopilot(sim.world, () => sim.world.layers[sim.state.layer].block),
    guide: null,
    guideAge: 1,
    guideFrom: -1,
    speed: 1,
    ops: [],
    ladderFoot: ladderFootOf(sim.world),
    over: false,
    guardKeys: sim.prison.guards.map((d) => itemNumber(`key_${d.key}`)),
  };
  itemsUI.show(true);
  tools.show(true);
  combatUI.show(true);
  targets.step = -1;
  pressQueued = false;
  acc = 0;
  controls.reset();
  controls.enabled = true;
  hud.show(true);
  sound.ambience(true);
  fadeIn();
  document.body.classList.add('is-playing');
  // Day 1 opens on roll call: the bell and the banner, once the fade is over.
  const g = game;
  const later = (ms: number, f: () => void) => startTimers.push(window.setTimeout(() => game === g && !g.paused && f(), ms));
  later(700, () => announce({ type: 'routine', routine: sim.state.routine }, sim));
  if (!hasSeen('walk')) {
    later(4600, () => hint.show(TOUCH ? [t('hint.walkTouch'), t('hint.tapWalk'), t('hint.arrows')] : [t('hint.walkKeys'), t('hint.clickWalk'), t('hint.arrows')]));
  }
}

/** Where each guard sleeps at night: the guard-quarters beds, in order, for those without a night round. */
function guardBeds(sim: Sim): Array<BedPose | undefined> {
  const beds = placesOf(sim.world).guardBeds;
  let n = 0;
  return sim.prison.guards.map((d) => {
    if (d.night) return undefined;
    const b = sim.world.props[beds[n++]?.bed ?? -1];
    return b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 };
  });
}

/** Timers set when a game starts (cleared when it ends, so they never reach the next one). */
let startTimers: number[] = [];

/** Resolves when the player quits to the title. */
let quit: (() => void) | null = null;

async function pause() {
  if (!game || game.paused) return;
  click();
  game.paused = true;
  game.speed = 1;
  controls.enabled = false;
  controls.reset();
  for (;;) {
    const choice = await showPause(click);
    if (!game) return;
    if (choice === 'settings') {
      await showSettings(settings, applySettings, click);
      continue;
    }
    if (choice === 'resume') {
      game.paused = false;
      controls.enabled = true;
      last = performance.now();
      return;
    }
    break;
  }
  endGame();
}

/** Back to the title: everything the game put up comes down. */
function endGame() {
  game = null;
  for (const id of startTimers) clearTimeout(id);
  startTimers = [];
  controls.enabled = false;
  hud.show(false);
  itemsUI.show(false);
  tools.show(false);
  combatUI.show(false);
  sleepVeil.classList.remove('on', 'ko');
  solitaryPanel.update(null, 0);
  darkCell.classList.remove('on');
  hint.hide();
  banner.clear();
  vignette.classList.remove('on');
  sound.siren(false);
  sound.ambience(false);
  talk.hide();
  board.close();
  profile.close();
  trainCard.hide();
  workChips.hide();
  document.body.classList.remove('is-playing', 'panel-open', 'training');
  quit?.();
}

/** Out on the road: the escape screen, then the title. */
async function escaped() {
  const g = game;
  if (!g || g.over) return;
  g.over = true;
  g.paused = true;
  controls.enabled = false;
  controls.reset();
  tools.held = false;
  itemsUI.closePanels();
  sound.siren(false);
  sound.chime();
  buzz('attended');
  const sim = g.rec.sim;
  const clock = sim.clock;
  // A moment to see the road under their feet before the card.
  await new Promise((r) => setTimeout(r, 900));
  if (game !== g) return;
  await showEscaped({ prison: t(`prison.${sim.prison.id}` as Key), day: clock.day, time: formatTime(clock) }, click);
  if (game === g) endGame();
}
addEventListener('keydown', (e) => {
  if (!game || game.paused || e.metaKey || e.ctrlKey || e.repeat) return;
  // Escape closes a panel first, and pauses only when none is open.
  if (e.code === 'Escape') {
    if (itemsUI.panelOpen) itemsUI.closePanels();
    else if (socialOpen()) closeSocial();
    else pause();
    return;
  }
  const g = game;
  // Asleep: only waking up (E) means anything; knocked out, nothing does.
  if (g.rec.sim.state.ko > 0) return;
  if (g.rec.sim.state.sleeping && e.code !== 'KeyE') return;
  if (e.code === 'KeyE') {
    // E again closes what it opened (a container, a talk, the board) and steps off the equipment.
    const st = g.rec.sim.state;
    if (st.items.open >= 0 || st.talk >= 0 || st.train >= 0) sendOp(OP.CLOSE);
    else if (board.isOpen) board.close();
    else act();
  }
  if (e.code === 'KeyC') {
    closeSocial();
    itemsUI.toggleCraft();
  }
  if (e.code === 'KeyI') {
    click();
    toggleProfile();
  }
  // Training (GDD §3.2): left and right in turn fill the bar.
  if (g.rec.sim.state.train >= 0 && (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'ArrowRight')) {
    sendOp(OP.TRAIN, e.code === 'KeyA' || e.code === 'ArrowLeft' ? 1 : 2);
    return;
  }
  // R: lock on to the next nearest person (past the last, none).
  if (e.code === 'KeyR' && !itemsUI.panelOpen && !socialOpen()) {
    // Nobody in reach (and nobody locked): say so rather than nothing.
    if (!targets.canLock && g.rec.sim.state.lock < 0) {
      sound.sting();
      itemsUI.toast(t('toast.nobodyToLock'));
    } else sendOp(OP.LOCK);
  }
  // Space: the tool in hand (held, it keeps striking).
  // Space: the tool in hand (not while a panel is open: the tool controls are put away then).
  if (e.code === 'Space') {
    e.preventDefault();
    if (itemsUI.panelOpen || socialOpen()) return;
    tools.held = true;
    usePress();
  }
  if (e.code === 'KeyQ' && g.rec.sim.state.items.inv[g.rec.sim.state.items.hand]) sendOp(OP.DROP, g.rec.sim.state.items.hand);
  const digit = /^Digit([1-6])$/.exec(e.code);
  if (digit) sendOp(OP.SELECT, Number(digit[1]) - 1);
  // Dev builds: fast-forward the prison clock (×30) to test the routine.
  if (import.meta.env.DEV && e.code === 'BracketRight' && game) game.speed = game.speed === 1 ? 30 : 1;
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') tools.release();
});
// Focus gone with Space held: the keyup never comes.
addEventListener('blur', () => tools.release());
// A hidden page pauses the game (phones switching apps, a closed laptop).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && !game.paused) pause();
});

const NO_OP: [number, number, number] = [0, 0, 0];
const USE_OP: [number, number, number] = [OP.USE, 0, 0];
const PRESS_OP: [number, number, number] = [OP.USE, 1, 0];
const SLEEP_SPEED = 40;
/** Knocked out, the 30 seconds pass in 3. */
const KO_SPEED = 10;
const BATON = itemNumber('baton');
const GUARD_OUTFIT = itemNumber('guard_outfit');

/** Queues a one-step operation (sent with the next simulation step). */
function sendOp(op: number, a = 0, b = 0) {
  game?.ops.push([op, a, b]);
}

/** The action button / E: use what is in reach (or wake up). */
function act() {
  if (!game) return;
  game.pilot.stop();
  itemsUI.closeCraft();
  profile.close();
  sendOp(OP.INTERACT);
}

// ------------------------------------------------------------------ social life and work (P6)
const talk = new TalkPanel(sendOp, click);
const board = new BoardPanel(sendOp, click);
const profile = new ProfilePanel(click);
const trainCard = new TrainCard(sendOp);
const workChips = new WorkChips();
/** A social panel is up (the talk, the job board, the file): the tool controls step aside. */
const socialOpen = () => talk.open || board.isOpen || profile.isOpen;
function closeSocial() {
  if (game && game.rec.sim.state.talk >= 0) sendOp(OP.CLOSE);
  board.close();
  profile.close();
}
function toggleProfile() {
  if (!game || game.paused) return;
  if (!profile.isOpen) {
    itemsUI.closePanels();
    board.close();
    if (game.rec.sim.state.talk >= 0) sendOp(OP.CLOSE);
  }
  profile.toggle();
}

const itemsUI = new ItemsUI(sendOp, click);
const combatUI = new CombatUI();
combatUI.onLock = () => {
  if (!game || game.paused) return;
  sendOp(OP.LOCK);
};
itemsUI.onAction = act;
const tools = new ToolControls();
tools.onPress = usePress;

/** What the tool button does right now (worked out each frame), and whether holding it repeats. */
let toolNow: ToolView | null = null;
const toolView: ToolView = { verb: '', what: '', icon: '', fits: true, progress: null, repeat: true };

/**
 * The tool button or Space pressed: strikes repeat while it's held (sent with each step, see
 * frame()); eating happens once. With no tool target, a plain USE still lets the sim say why
 * nothing happens (a sock against a wall).
 */
function usePress() {
  if (!game || game.paused) return;
  game.pilot.stop();
  // A fresh press (arg 1): only a fresh press digs up, eats or puts things in place. It waits
  // for the arm to come back from the last strike (a quick tap is never lost).
  pressQueued = true;
  heldOn = toolKey;
  if (!toolNow?.repeat) tools.release();
}
let pressQueued = false;

/** What the held button is working on: when it changes (the earth gave way, a cave-in), the hold ends. */
let toolKey = 0;
let heldOn = 0;
const sleepVeil = h('div', 'sleep-veil', `<span>${''}</span>`);
document.body.append(sleepVeil);

/** Who someone is (Cast id): "Inmate · cell 3", "Guard · purple key". */
function personName(sim: Sim, id: number): string {
  const s = sim.state;
  if (!isGuard(s, id)) return t('combat.inmateNamed', { name: inmateName(sim, id), n: s.inmates[id]?.cell ?? 0 });
  return t('combat.guard', { key: t(`keyColor.${sim.prison.guards[id - s.inmates.length].key}` as Key) });
}

/** What a container is called ("your desk", "bookshelf", someone's pockets). */
function thingName(sim: Sim, index: number): string {
  const who = ownerOf(sim.world, index);
  if (who >= 0) return personName(sim, who);
  const c = containersOf(sim.world)[index];
  if (!c) return '';
  const k = c.prop.kind;
  if (c.mine && (k === 'desk' || k === 'bed')) return t(k === 'desk' ? 'thing.myDesk' : 'thing.myBed');
  return t(`thing.${k}` as Key);
}
/** The open container's title, worked out once per container and language. */
let titleKey = '';
let titleText = '';
function boxTitle(sim: Sim, index: number) {
  // Someone's pockets: and how long before they come round.
  const who = ownerOf(sim.world, index);
  const ko = who >= 0 ? (personOf(sim.state, who)?.ko ?? 0) : 0;
  const key = `${index}:${currentLang()}:${Math.ceil(ko / STEPS_PER_SECOND)}`;
  if (key !== titleKey) {
    titleKey = key;
    const name = thingName(sim, index);
    titleText = name.charAt(0).toUpperCase() + name.slice(1);
    if (who >= 0) titleText = t(isGuard(sim.state, who) ? 'box.pocketsGuard' : 'box.pocketsInmate', { s: Math.ceil(ko / STEPS_PER_SECOND) });
  }
  return titleText;
}

/** The action label for what is in reach, worked out only when the target (or language) changes. */
const actionLabel = { verb: '', what: '' };
let actionKey = '';
function describeTarget(sim: Sim, target: Target, climb: ClimbTarget | null, held: number, station: Station | null = null): { verb: string; what: string } | null {
  if (station && !climb) {
    // On the job: the station's step ("Load the washer", "Take out: clean laundry").
    const key = `station:${station.act}:${station.prop}:${station.item}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const prop = sim.world.props[station.prop];
      const what = station.act === 'take' || station.act === 'unload' || station.act === 'put' || station.act === 'load' ? itemName(station.item) : prop ? t(`thing.${prop.kind}` as Key) : t('thing.puddle');
      Object.assign(actionLabel, { verb: t(`work.${station.act}` as Key), what: station.act === 'mop' ? t('thing.puddle') : station.act === 'running' || station.act === 'full' ? (prop ? t(`thing.${prop.kind}` as Key) : '') : what });
    }
    return actionLabel;
  }
  if (climb) {
    const key = `climb:${climb.action}:${climb.item ?? 0}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const what: Record<string, string> = {
        climbVent: t('thing.vent'),
        dropDown: '',
        climbRoof: t('thing.ladderRoof'),
        climbDownLadder: '',
        climbDown: t('thing.tunnel'),
        climbUp: '',
        uncover: climb.item ? itemName(climb.item) : '',
      };
      Object.assign(actionLabel, { verb: t(`act.${climb.action}` as Key), what: what[climb.action] });
    }
    return actionLabel;
  }
  if (!target) return null;
  // Dirt in hand at a toilet: down it goes.
  const flush = target.kind === 'container' && (held === DIRT || held === WALL_CHUNK) && containersOf(sim.world)[target.index].prop.kind === 'toilet';
  if (target.kind === 'person') {
    // The player's letter for them (the mail round), else a talk.
    const letter = LETTER;
    const it = sim.state.items;
    const mail = sim.onDuty && sim.state.mail.includes(target.who) && it.inv.slice(0, 6).some((v) => itemOf(v) === letter && usesOf(v) - 1 === target.who);
    const key = `person:${target.who}:${mail}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      Object.assign(actionLabel, { verb: t(mail ? 'act.deliver' : 'act.talk'), what: inmateName(sim, target.who) });
    }
    return actionLabel;
  }
  if (target.kind === 'fixture') {
    const key = `fixture:${target.use}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      Object.assign(actionLabel, { verb: t(`act.${target.use}` as Key), what: t(`thing.${target.use === 'board' ? 'jobBoard' : target.use}` as Key) });
    }
    return actionLabel;
  }
  const key = `${target.kind}:${target.index}:${target.kind === 'ground' ? target.item : 0}:${flush}:${currentLang()}`;
  if (key !== actionKey) {
    actionKey = key;
    if (target.kind === 'ground') Object.assign(actionLabel, { verb: t('act.pickUpVerb'), what: itemName(target.item) });
    else if (target.kind === 'sleep') Object.assign(actionLabel, { verb: t('act.sleep'), what: '' });
    else if (target.kind === 'pockets') Object.assign(actionLabel, { verb: t('act.searchVerb'), what: t('thing.pockets') });
    else if (flush) Object.assign(actionLabel, { verb: t('act.flush'), what: itemName(held) });
    else Object.assign(actionLabel, { verb: t('act.searchVerb'), what: thingName(sim, target.index) });
  }
  return actionLabel;
}

/** Who stands on the ground floor besides the player (nobody digs under them). */
const others: Body[] = [];
function bodiesOf(sim: Sim): Body[] {
  others.length = 0;
  for (const m of sim.state.inmates) others.push(m.body);
  for (const g of sim.state.guards) others.push(g.body);
  return others;
}

/** Tool actions as numbers (the held button's target key, compared each frame without strings). */
const ACTION_IDS = ['chip', 'cut', 'unscrew', 'dig', 'digUp', 'eat', 'cover', 'brace', 'rope', 'sharpen'];
const TOOL_ICON: Record<string, string> = { chip: 'pick', dig: 'shovel', digUp: 'up', cut: 'cutters', unscrew: 'screw', eat: 'cookie', cover: 'lock', brace: 'hammer', rope: 'down', sharpen: 'sword' };

/** Everyone who can be looted, by Cast id (inmates, then guards); one array, refilled. */
const lootable: Array<{ body: Body; ko: number; angry?: number }> = [];
function peopleOf(sim: Sim) {
  lootable.length = 0;
  for (const m of sim.state.inmates) lootable.push(m);
  for (const g of sim.state.guards) lootable.push(g);
  return lootable;
}

/** The weapon the player fights with: one in hand, else the weapon slot (0: fists). */
function weaponOf(it: ItemState): number {
  const inHand = itemOf(it.inv[it.hand]);
  return inHand && itemDef(inHand).cat === 'weapon' ? inHand : itemOf(it.inv[SLOT.WEAPON]);
}

/** Steps between the player's blows now (the press waits for it, as the sim does). */
let attackPace = 14;

/** The tool button while locked on (GDD §10.1): a blow (held, it keeps swinging) or a throw. */
function describeAttack(sim: Sim): ToolView | null {
  const s = sim.state;
  if (s.lock < 0 || s.layer !== LAYER.GROUND) return null;
  const f = personOf(s, s.lock);
  if (!f) return null;
  const weapon = weaponOf(s.items);
  const d = weapon ? itemDef(weapon) : null;
  const thrown = !!d?.thrown;
  const reach = thrown ? THROW_RANGE : reachOf(d);
  const p = s.player;
  const inReach = (f.body.x - p.x) ** 2 + (f.body.z - p.z) ** 2 <= reach * reach && lineOfSight(sim.world, p.x, p.z, f.body.x, f.body.z);
  attackPace = swingSteps(s.spd, d);
  const v = toolView;
  v.verb = t(thrown ? 'act.throw' : weapon ? 'act.hit' : 'act.punch');
  v.what = weapon ? itemName(weapon) : '';
  v.icon = thrown ? 'splash' : 'fist';
  v.fits = inReach;
  v.progress = null;
  v.repeat = !thrown;
  v.attack = true;
  return v;
}

/** The target card's contents, refilled in place. */
let targetNameKey = -1;
const targetView: TargetInfo = { name: '', guard: false, health: 1, str: 0, attitude: 'calm', inReach: false };
function targetInfo(sim: Sim): TargetInfo | null {
  const s = sim.state;
  const f = s.lock >= 0 ? personOf(s, s.lock) : undefined;
  if (!f) return null;
  const v = targetView;
  const guard = isGuard(s, s.lock);
  const nameKey = s.lock * 8 + (currentLang() === 'fr' ? 1 : 0);
  if (nameKey !== targetNameKey) {
    targetNameKey = nameKey;
    v.name = personName(sim, s.lock);
  }
  v.guard = guard;
  v.health = f.hp / maxHealth(f.str);
  v.str = f.str;
  v.attitude = guard ? (s.guards[s.lock - s.inmates.length].mode === GUARD.CHASE ? 'chasing' : 'onDuty') : s.inmates[s.lock].angry > 0 ? 'angry' : 'calm';
  v.inReach = !!toolNow?.attack && toolNow.fits;
  return v;
}

/** The tool button's face for a strike target, refilled in place (no garbage per frame). */
function describeTool(sim: Sim, tt: ToolTarget | null, held: number): ToolView | null {
  if (!tt) return null;
  const d = held ? itemDef(held) : null;
  const strike = STRIKES.has(tt.action);
  // Only with a tool (or something to put in place) in hand: a sock against a wall offers nothing.
  if (strike && !d?.tool && tt.action !== 'sharpen') return null;
  const w = sim.world;
  const v = toolView;
  v.attack = false;
  v.verb = t(`act.${tt.action}` as Key);
  v.icon = TOOL_ICON[tt.action];
  // A comb or toothbrush on a wall: strokes so far against those it takes.
  if (tt.action === 'sharpen') {
    v.what = t('thing.wall');
    v.fits = true;
    v.repeat = true;
    v.progress = Math.min(1, usesOf(sim.state.items.inv[sim.state.items.hand]) / tt.hp);
    return v;
  }
  // Grey when it can't be done: the wrong tool, reinforced concrete, or too tired to swing.
  v.fits = tt.fits && (!strike || (tt.hp !== 0 && sim.state.energy >= (d?.tool?.energy ?? 0)));
  // Digging up takes a press per strike (a hold never surfaces the player).
  v.repeat = strike && tt.action !== 'digUp';
  if (tt.action === 'eat') v.fits = sim.state.energy < 100;
  if (!strike) {
    v.what = tt.action === 'eat' ? t('thing.chocolate') : tt.action === 'cover' ? t(tt.layer === LAYER.VENTS ? 'thing.grate' : 'thing.hole') : tt.action === 'brace' ? '' : t('thing.rope');
    v.progress = null;
    return v;
  }
  const k = tt.layer === LAYER.GROUND ? w.ground.kind[tt.tile] : 0;
  v.what =
    tt.action === 'chip'
      ? t(k === TILE.REINFORCED ? 'thing.reinforced' : 'thing.wall')
      : tt.action === 'cut'
        ? t(k === TILE.ELECTRIC ? 'thing.electric' : 'thing.fence')
        : tt.action === 'unscrew'
          ? t('thing.grate')
          : tt.action === 'digUp'
            ? t('thing.surface')
            : t(tt.layer === LAYER.UNDER ? 'thing.earth' : 'thing.floor');
  const worn = sim.state.wear[placeKey(tt.layer, tt.tile)] ?? 0;
  v.progress = tt.hp > 0 ? Math.min(1, worn / tt.hp) : 0;
  // The last blow would drop a chunk or dirt at the player's feet with no room in their pockets: grey, as the sim refuses it.
  const yields = tt.action === 'chip' || (tt.action === 'dig' && tt.layer === LAYER.GROUND);
  if (yields && sim.state.layer === LAYER.GROUND && d?.tool && worn + d.tool.damage >= tt.hp && !sim.state.items.inv.slice(0, 6).includes(0)) v.fits = false;
  return v;
}
const focusAt = { x0: 0, z0: 0, x1: 0, z1: 0 };
function focusOf(sim: Sim, target: Target, climb: ClimbTarget | null = null, station: Station | null = null) {
  if (station && !climb) {
    if (station.prop < 0) {
      focusAt.x0 = (station.tile % MAP_W) + 0.06;
      focusAt.z0 = Math.floor(station.tile / MAP_W) + 0.06;
      focusAt.x1 = focusAt.x0 + 0.88;
      focusAt.z1 = focusAt.z0 + 0.88;
      return focusAt;
    }
    const p = sim.world.props[station.prop];
    focusAt.x0 = p.x;
    focusAt.z0 = p.z;
    focusAt.x1 = p.x + p.w;
    focusAt.z1 = p.z + p.d;
    return focusAt;
  }
  if (climb) {
    focusAt.x0 = (climb.tile % MAP_W) + 0.08;
    focusAt.z0 = Math.floor(climb.tile / MAP_W) + 0.08;
    focusAt.x1 = focusAt.x0 + 0.84;
    focusAt.z1 = focusAt.z0 + 0.84;
    return focusAt;
  }
  if (!target) return null;
  if (target.kind === 'pockets') {
    // Lying where they fell, head back along the way they faced.
    const b = personOf(sim.state, target.who)!.body;
    const cx = b.x / UNIT - (DIR_X[b.facing] / 1024) * 0.62;
    const cz = b.z / UNIT - (DIR_Z[b.facing] / 1024) * 0.62;
    const along = Math.abs(DIR_X[b.facing]) > Math.abs(DIR_Z[b.facing]);
    focusAt.x0 = cx - (along ? 0.82 : 0.5);
    focusAt.x1 = cx + (along ? 0.82 : 0.5);
    focusAt.z0 = cz - (along ? 0.5 : 0.82);
    focusAt.z1 = cz + (along ? 0.5 : 0.82);
    return focusAt;
  }
  if (target.kind === 'person') {
    const b = sim.state.inmates[target.who].body;
    focusAt.x0 = b.x / UNIT - 0.45;
    focusAt.z0 = b.z / UNIT - 0.45;
    focusAt.x1 = focusAt.x0 + 0.9;
    focusAt.z1 = focusAt.z0 + 0.9;
    return focusAt;
  }
  if (target.kind === 'fixture') {
    const p = sim.world.props[target.index];
    focusAt.x0 = p.x;
    focusAt.z0 = p.z;
    focusAt.x1 = p.x + p.w;
    focusAt.z1 = p.z + p.d;
    return focusAt;
  }
  if (target.kind === 'ground') {
    const tile = tileOfKey(sim.state.items.ground[target.index][0]);
    focusAt.x0 = (tile % MAP_W) + 0.2;
    focusAt.z0 = Math.floor(tile / MAP_W) + 0.2;
    focusAt.x1 = focusAt.x0 + 0.6;
    focusAt.z1 = focusAt.z0 + 0.6;
    return focusAt;
  }
  const p = containersOf(sim.world)[target.index].prop;
  focusAt.x0 = p.x;
  focusAt.z0 = p.z;
  focusAt.x1 = p.x + p.w;
  focusAt.z1 = p.z + p.d;
  return focusAt;
}
const groundFrame: Array<{ x: number; z: number; item: number }> = [];
const itemsView: ItemsView = { items: null as unknown as ItemState, boxTitle: '', boxHidden: 0, action: null, sleeping: false, deskTunnel: false, study: false };

const frameData: Frame = {
  x: 0,
  z: 0,
  facing: 0,
  moving: false,
  minuteOfDay: 0,
  surface: 0,
  inmates: [],
  guide: null,
  tap: null,
  alarm: false,
  ground: groundFrame,
  groundRev: -1,
  focus: null,
  held: 0,
  outfit: 0,
  sleeping: false,
  knockedOut: false,
  guards: [],
  layer: LAYER.GROUND,
  tilesRev: -1,
  wearRev: -1,
  deskAside: false,
  wear: {},
  lock: -1,
  lockHostile: false,
  lockFar: false,
  doing: 0,
  trainAt: null,
  reps: 0,
  puddles: [],
  puddlesRev: 0,
};
const LETTER = itemNumber('letter');
const MOP = itemNumber('mop');
const MAGAZINE = itemNumber('magazine');
/** Where the player stands while training on a treadmill (on its belt), refilled. */
const trainAt = { x: 0, z: 0, facing: 0, y: 0 };
const PEEL_ACTION = { verb: '', what: '' };
/** What the buttons would do, worked out once per simulation step. */
const targets: { step: number; busy: boolean; panel: boolean; rev: number; climb: ClimbTarget | null; target: Target; tool: ToolTarget | null; canLock: boolean; fighting: boolean; station: Station | null } = {
  station: null,
  step: -1,
  busy: false,
  panel: false,
  rev: -1,
  climb: null,
  target: null,
  tool: null,
  canLock: false,
  fighting: false,
};
const tapAt = { x: 0, z: 0 };
const hudState: HudState = { routine: 0, attended: false, heat: 0, lockdown: false, seen: false, solitaryMinutes: null, cash: 0, work: null };
const workHud = { place: '', quota: 0, of: 0, paid: false };

/** Reps so far, counted across sets (the view pumps the arms on each). */
let repCount = 0;
let repLast = 0;
function trainReps(reps: number): number {
  if (reps > repLast) repCount++;
  repLast = reps;
  return repCount;
}

const projectAt = (x: number, y: number, z: number, out: { x: number; y: number }) => view.screenAt(x, y, z, out);

/**
 * The badge over an inmate (GDD §13.2): the letter the player carries for them, a favor done
 * (hand it in) or on offer, a merchant open for business, a follower.
 */
const badgeMemo = { step: -1, rev: -1, kinds: [] as BadgeKind[] };
function badgeOf(sim: Sim, who: number): BadgeKind {
  const s = sim.state;
  // Worked out once a step (or when the items change), not every frame.
  if (badgeMemo.step !== s.step || badgeMemo.rev !== s.items.rev) {
    badgeMemo.step = s.step;
    badgeMemo.rev = s.items.rev;
    for (let k = 0; k < s.inmates.length; k++) badgeMemo.kinds[k] = badgeNow(sim, k);
  }
  return badgeMemo.kinds[who] ?? '';
}
function badgeNow(sim: Sim, who: number): BadgeKind {
  const s = sim.state;
  const m = s.inmates[who];
  if (m.ko > 0 || m.angry > 0) return '';
  if (sim.onDuty && s.mail.includes(who) && s.items.inv.slice(0, 6).some((v) => itemOf(v) === LETTER && usesOf(v) - 1 === who)) return 'mail';
  const f = s.favors.find((x) => x.by === who);
  if (f && (f.state === FAVOR_STATE.DONE || ((f.kind === 0 || f.kind === 1) && f.state === FAVOR_STATE.TAKEN && s.items.inv.slice(0, 6).some((v) => itemOf(v) === f.item)))) return 'done';
  if (f?.state === FAVOR_STATE.OFFERED) return 'favor';
  if (sim.shopsOpen && sim.merchantOf(who) >= 0 && s.shops[sim.merchantOf(who)].some((v) => v)) return 'shop';
  if (s.followers.includes(who)) return 'ally';
  return '';
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game) {
    view.drawTitle(dt, now / 1000);
    return;
  }
  const g = game;
  const sim = g.rec.sim;
  const p = sim.state.player;
  if (!g.paused) {
    governQuality(dt);
    // Fixed steps: the simulation never sees the frame time.
    // Asleep, the night runs fast (about 13 s from 23:00 to 07:55).
    const speed = sim.state.sleeping ? SLEEP_SPEED : sim.state.ko > 0 ? KO_SPEED : g.speed;
    acc += dt * speed;
    let steps = 0;
    while (acc >= 1 / STEPS_PER_SECOND && steps++ < 40 * speed) {
      acc -= 1 / STEPS_PER_SECOND;
      // Where everyone was before this step (buffers reused: no garbage per step).
      g.prev.x = p.x;
      g.prev.z = p.z;
      sim.state.inmates.forEach((m, k) => {
        const q = (g.prevInmates[k] ??= { x: 0, z: 0 });
        q.x = m.body.x;
        q.z = m.body.z;
      });
      sim.state.guards.forEach((m, k) => {
        const q = (g.prevGuards[k] ??= { x: 0, z: 0 });
        q.x = m.body.x;
        q.z = m.body.z;
      });
      // The stick and keys win over tap-to-walk; both are plain direction commands.
      if (controls.steering || sim.state.ko > 0) g.pilot.stop();
      // Holding the tool button: a strike is asked for every step (the sim paces them).
      let op = g.ops.shift();
      // A press waiting for the last strike's swing to finish (things that aren't strikes go at once).
      // (A blow waits for the fighter's own pace, a strike for the tool's.)
      const ready = toolNow?.attack ? sim.state.step + 1 - sim.state.swingAt >= attackPace : sim.state.step + 1 - sim.state.struckAt >= STRIKE_STEPS;
      if (!op && pressQueued && (!toolNow?.repeat || ready)) {
        op = PRESS_OP;
        pressQueued = false;
      }
      op ??= tools.held && toolNow?.repeat ? USE_OP : NO_OP;
      let dir = controls.steering ? controls.dir() : g.pilot.dir(p);
      // On the equipment, left and right are reps (sent as ops): only up or down steps off.
      if (sim.state.train >= 0 && (dir === 1 || dir === 9)) dir = 0;
      g.rec.step(command(dir, op[0], op[1], op[2]));
      g.walked += Math.hypot(p.x - g.prev.x, p.z - g.prev.z) / UNIT;
      // Sound, banners and vibration read the events; the simulation never calls them.
      for (const e of sim.events) {
        announce(e, sim);
        // Carried somewhere (solitary, the infirmary, into bed): no slide from the old spot.
        if (e.type === 'solitary' || e.type === 'infirmary' || (e.type === 'sleep' && e.on)) {
          g.prev.x = p.x;
          g.prev.z = p.z;
        }
      }
    }
    if (acc > 1) acc = 0;
    if (hint.visible && g.walked > 4) {
      hint.hide();
      markSeen('walk');
    }
    updateGuide(g, dt);
  }
  const a = g.paused ? 1 : acc * STEPS_PER_SECOND;
  const clock = sim.clock;
  const tile = tileOfBody(p);
  const lerp = (from: number, to: number) => (from + (to - from) * a) / UNIT;
  const st = sim.state;
  // One frame record, refilled every frame (phones notice garbage).
  const f = frameData;
  f.x = lerp(g.prev.x, p.x);
  f.z = lerp(g.prev.z, p.z);
  f.facing = Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]);
  f.moving = p.moving && !g.paused;
  f.minuteOfDay = clock.minuteOfDay + ((st.step % STEPS_PER_MINUTE) + a) / STEPS_PER_MINUTE;
  f.layer = st.layer;
  f.tilesRev = sim.tilesRev;
  f.wearRev = sim.wearRev;
  f.deskAside = st.deskAside;
  f.wear = st.wear;
  // Footsteps: earth in the tunnels, steel in the vents, the floor's own sound elsewhere.
  f.surface = st.layer === LAYER.UNDER ? TILE.DIRT : st.layer === LAYER.GROUND ? sim.world.ground.kind[tile.z * MAP_W + tile.x] : TILE.CONCRETE;
  f.inmates.length = st.inmates.length;
  st.inmates.forEach((m, k) => {
    const o = (f.inmates[k] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, cell: 0, angry: false, badge: '' });
    const q = g.prevInmates[k];
    o.x = lerp(q?.x ?? m.body.x, m.body.x);
    o.z = lerp(q?.z ?? m.body.z, m.body.z);
    o.facing = Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]);
    o.moving = m.body.moving && !g.paused;
    o.doing = m.doing;
    o.cell = m.cell;
    o.angry = m.angry > 0;
    o.badge = badgeOf(sim, k);
  });
  f.guards.length = st.guards.length;
  st.guards.forEach((m, k) => {
    const o = (f.guards[k] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, alert: 0, pace: 1, held: 0, hasKey: true });
    const q = g.prevGuards[k];
    o.x = lerp(q?.x ?? m.body.x, m.body.x);
    o.z = lerp(q?.z ?? m.body.z, m.body.z);
    o.facing = Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]);
    o.moving = m.body.moving && !g.paused;
    o.doing = m.doing;
    o.alert = alertOf(m);
    const chasing = m.mode === GUARD.CHASE;
    o.pace = (chasing ? CHASE_SPEED : m.speed) / WALK_SPEED;
    o.held = chasing ? BATON : 0;
    // Its key on its belt while it's in its pockets (taken from a guard out cold, it's gone).
    const pocket = st.items.containers[st.items.containers.length - st.guards.length + k];
    o.hasKey = !!pocket && (itemOf(pocket[0]) === g.guardKeys[k] || itemOf(pocket[1]) === g.guardKeys[k] || itemOf(pocket[2]) === g.guardKeys[k] || itemOf(pocket[3]) === g.guardKeys[k]);
  });
  f.lock = st.lock;
  // The ring reads the fight: red while they're after the player, dim out of reach.
  f.lockHostile = st.lock >= 0 && (st.lock < st.inmates.length ? st.inmates[st.lock].angry > 0 : st.guards[st.lock - st.inmates.length].mode === GUARD.CHASE);
  f.lockFar = !!toolNow?.attack && !toolNow.fits;
  f.knockedOut = st.ko > 0;
  f.guide = g.guide;
  const dest = g.pilot.destination;
  if (dest >= 0) {
    tapAt.x = (dest % MAP_W) + 0.5;
    tapAt.z = Math.floor(dest / MAP_W) + 0.5;
  }
  f.tap = dest >= 0 ? tapAt : null;
  f.alarm = st.lockdown;
  // Items: the floor (of the player's layer), the hand, the outfit, and what the action button would use.
  const it = st.items;
  let n = 0;
  for (const [key, v] of it.ground) {
    if (layerOfKey(key) !== st.layer) continue;
    const tileIndex = tileOfKey(key);
    const o = (groundFrame[n++] ??= { x: 0, z: 0, item: 0 });
    o.x = (tileIndex % MAP_W) + 0.5;
    o.z = Math.floor(tileIndex / MAP_W) + 0.5;
    o.item = itemOf(v);
  }
  groundFrame.length = n;
  // A layer change redraws the floor items too.
  f.groundRev = it.rev * 4 + st.layer;
  const busy = st.sleeping || st.ko > 0 || st.solitary > 0 || g.paused || g.over;
  const held = itemOf(it.inv[it.hand]);
  // The action button: the structure first (climbing, covers coming off), as the sim decides it.
  // Worked out once per simulation step (nothing it depends on changes between steps).
  const memo = targets;
  const panel = itemsUI.panelOpen || socialOpen();
  document.body.classList.toggle('panel-open', panel);
  if (memo.step !== st.step || memo.busy !== busy || memo.panel !== panel || memo.rev !== it.rev) {
    memo.step = st.step;
    memo.busy = busy;
    memo.panel = panel;
    memo.rev = it.rev;
    const reach = busy ? null : interactTarget(sim.world, it, p, sim.bedtime, st.layer, peopleOf(sim), st.inmates.length);
    memo.station = busy || st.layer !== LAYER.GROUND ? null : sim.station();
    const faced = reach?.kind === 'container' || reach?.kind === 'sleep' ? facesProp(p, containersOf(sim.world)[reach.index].prop) : false;
    memo.climb = busy ? null : preferClimb(climbTarget(sim.world, st.layer, p, g.ladderFoot, bodiesOf(sim)), faced);
    memo.target = memo.climb ? null : reach;
    memo.tool = busy || panel ? null : toolTarget(sim.world, st.layer, p, held, bodiesOf(sim));
    memo.canLock = !busy && st.layer === LAYER.GROUND && lockCandidates(sim.world, st, p, lockList).length > 0;
    let fighting = false;
    for (const m of st.inmates) if (m.angry > 0) fighting = true;
    for (const x of st.guards) if (x.mode === GUARD.CHASE) fighting = true;
    memo.fighting = fighting;
  }
  const climb = memo.climb;
  const target = memo.target;
  // The frame stays on an open container (what the panel shows), else on what is in reach.
  const openWho = ownerOf(sim.world, it.open);
  f.focus =
    it.open >= 0
      ? focusOf(sim, openWho >= 0 ? { kind: 'pockets', index: it.open, who: openWho } : { kind: 'container', index: it.open })
      : st.talk >= 0
        ? focusOf(sim, { kind: 'person', who: st.talk })
        : st.train >= 0
          ? null
          : focusOf(sim, target, climb, memo.station);
  // Training (GDD §3.2): the pose, onto the treadmill's belt, a book in hand at the shelf.
  const trainKind = st.train >= 0 ? sim.world.props[st.train].kind : '';
  f.doing = trainKind === 'weights' ? DOING.LIFT : trainKind === 'treadmill' ? DOING.RUN : trainKind === 'shelf' ? DOING.READ : DOING.NOTHING;
  if (trainKind === 'treadmill') {
    const tp = sim.world.props[st.train];
    trainAt.x = tp.x + tp.w / 2;
    trainAt.z = tp.z + tp.d / 2 + 0.1;
    trainAt.y = 0.14;
    trainAt.facing = Math.PI;
    f.trainAt = trainAt;
  } else f.trainAt = null;
  f.reps = trainReps(st.reps);
  f.puddles = st.puddles;
  f.puddlesRev = st.puddles.length * 4096 + (st.puddles[0] ?? 0);
  f.held = trainKind === 'shelf' ? MAGAZINE : held;
  f.outfit = itemOf(it.inv[SLOT.OUTFIT]);
  coachItems(f.held, f.outfit);
  f.sleeping = st.sleeping;
  view.draw(f, dt, now / 1000);
  const box = containersOf(sim.world)[it.open];
  const v = itemsView;
  v.items = it;
  v.boxTitle = it.open >= 0 ? boxTitle(sim, it.open) : '';
  v.boxHidden = box?.hidden ?? 0;
  if (st.solitary > 0) {
    PEEL_ACTION.verb = t('act.peel');
    PEEL_ACTION.what = t('act.potato');
  }
  v.action = st.ko > 0 || g.over ? null : st.solitary > 0 ? PEEL_ACTION : it.open >= 0 || st.talk >= 0 || st.train >= 0 || socialOpen() ? null : describeTarget(sim, target, climb, held, memo.station);
  v.sleeping = st.sleeping;
  v.deskTunnel = !!box?.mine && box.prop.kind === 'desk' && sim.world.ground.kind[box.prop.z * MAP_W + box.prop.x] === TILE.SHAFT;
  v.study = box?.prop.kind === 'shelf' && box.table === 'libraryShelf';
  itemsUI.update(v);
  // The tool button: a blow at the locked-on target, else what a strike would hit.
  const tt = memo.tool;
  const fight = busy ? null : describeAttack(sim);
  toolNow = fight ?? describeTool(sim, tt, held);
  // Each new target takes a new press: a held button never digs on into the next thing.
  toolKey = fight ? -2 - st.lock : tt ? (ACTION_IDS.indexOf(tt.action) + 1) * 100000 + tt.layer * 10000 + tt.tile : 0;
  if (tools.held && toolKey !== heldOn) tools.release();
  const fighting = st.lock >= 0 || memo.fighting;
  const training = st.train >= 0;
  tools.update(training ? null : toolNow, st.energy, !!(held && itemDef(held).tool) || training, busy || panel, st.health / maxHealth(st.str), fighting);
  // The target card, and the lock button while anyone is in range (worked out once a step).
  combatUI.update(targetInfo(sim), memo.canLock && !training, busy || panel || training);
  // Social life and work (P6): the talk, the job board (closed out of its reach), the file, the training card, machines at work.
  if (board.isOpen && nearestProp(sim.world, p, (q) => q.kind === 'jobBoard', STATION_REACH + UNIT / 2) < 0) board.close();
  talk.update(sim, busy);
  board.update(sim, busy);
  profile.update(sim, busy && !st.sleeping);
  trainCard.update(sim, busy);
  workChips.update(sim, projectAt, busy || st.layer !== LAYER.GROUND);
  const veilOn = st.sleeping || st.ko > 0;
  if (st.ko > 0 && !sleepVeil.classList.contains('ko')) sleepVeil.querySelector('span')!.textContent = t('sleep.knockedOut');
  sleepVeil.classList.toggle('ko', st.ko > 0);
  sleepVeil.classList.toggle('on', veilOn);
  solitaryPanel.update(st.solitary > 0 ? Math.ceil(st.solitary / STEPS_PER_MINUTE) : null, st.peeled);
  darkCell.classList.toggle('on', st.solitary > 0);
  // The solitary card takes the hint's place.
  if (st.solitary > 0 && hint.visible) hint.hide();
  // First time something is in reach: how to use it.
  if (target && !hint.visible && !hasSeen('interact') && hasSeen('walk')) hint.show([TOUCH ? t('hint.interactTouch') : t('hint.interactKeys')], 'hand');
  vignette.classList.toggle('on', st.lockdown);
  sound.siren(st.lockdown && !g.paused);
  const zone = sim.playerZone;
  hudState.routine = st.routine;
  // At Lights Out the badge says whether the player is in the cell right now.
  hudState.attended = ROUTINE[st.routine].id === 'lightsOut' ? zone === 'playerCell' : st.attended;
  hudState.heat = st.heat;
  hudState.lockdown = st.lockdown;
  hudState.seen = st.seen;
  hudState.solitaryMinutes = st.solitary > 0 ? Math.ceil(st.solitary / STEPS_PER_MINUTE) : null;
  hudState.cash = st.cash;
  // During the Work Period with a job that counts today: the quota on the badge (GDD §11).
  const job = sim.jobActive();
  if (ROUTINE[st.routine].id === 'work' && job >= 0) {
    const d = jobRooms(sim.world)[job].def;
    workHud.place = t(`zone.${d.zone}` as Key);
    workHud.quota = st.quota;
    workHud.of = d.quota;
    workHud.paid = st.paid;
    hudState.work = workHud;
  } else hudState.work = null;
  hud.update(clock, zone, hudState);
}

// The title shows the first prison drifting by.
view.setWorld(new Sim(PRISONS[0]).world);
requestAnimationFrame(frame);

// ------------------------------------------------------------------ flows
async function titleFlow() {
  for (;;) {
    const choice = await showTitle(
      {
        prisonName: t(`prison.${PRISONS[0].id}` as 'prison.center-perks'),
        muted: settings.muted,
        toggleSound: () => {
          settings.muted = !settings.muted;
          if (!settings.muted && settings.sfxVolume === 0) settings.sfxVolume = 0.8;
          applySettings();
          return settings.muted;
        },
      },
      click,
    );
    if (choice === 'settings') {
      await showSettings(settings, applySettings, click);
      continue;
    }
    startGame(PRISONS[0]);
    await new Promise<void>((resolve) => (quit = resolve));
    view.setWorld(new Sim(PRISONS[0]).world);
  }
}

titleFlow();
// Item icons are photographed once; do it while the title is up, not at the first slot drawn.
setTimeout(() => warmIcons(), 1200);
// The game started: the boot guard in index.html stands down.
(window as { __pe3dBooted?: boolean }).__pe3dBooted = true;
registerServiceWorker(() => {});
// Dev only: the running game, for probing from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game, __view: view, __renderer: renderer });
