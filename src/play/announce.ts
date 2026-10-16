import { buzz } from '../app/haptics';
import { itemDef, itemNumber } from '../content/items';
import { RECIPES } from '../content/recipes';
import { ROUTINE } from '../content/routine';
import { listOf, t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { jobRooms } from '../sim/systems/economy';
import { ownerOf } from '../sim/systems/items';
import { ALARM_CLOCK, DIRT, FIRECRACKER, underMyDesk, WALL_CHUNK } from '../sim/systems/structure';
import { clockSecs } from '../sim/systems/noise';
import { itemOf } from '../sim/systems/items';
import { tossFlight } from '../render/Noise';
import { BRIBE_REPORT_HEAT, CHOCOLATE_ENERGY, KO_STEPS, LOOK_AWAY_STEPS, MEAL_ENERGY, PAPER_HEAT, STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import { TOUCH, h } from '../ui/dom';
import { routineName, routinePlace } from '../ui/hud';
import { itemName } from '../ui/items';
import { guardSubject, inmateName, jobName } from '../ui/social';
import { press } from './buttons';
import { aimUI, banner, board, combatUI, itemsUI, profile, settings, sleepVeil, sound, tools, view } from './context';
import { play } from './game';
import { NEED } from './labels';
import { coachOnce, markTip, seenInteract, seenTip } from './tips';

/** Games whose player has been told about the cold already. */
const coldTold = new WeakSet<object>();

/** The last thing guards noticed, and when (real time): repeats are quiet for a moment. */
const lastSpotted = { reason: '', at: 0 };

/** Sound, vibration, banners and toasts for what the simulation reports. */
export function announce(e: SimEvent, sim: Sim) {
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
    case 'attended': {
      const id = ROUTINE[e.routine].id;
      if (id === 'lightsOut') break;
      sound.chime();
      buzz('attended');
      // The first meal and the first showers: how they pick the player up (GDD §2, §3.1).
      if (id === 'breakfast' || id === 'dinner') coachOnce('meal', 'hint.meal', { n: MEAL_ENERGY });
      if (id === 'showers') coachOnce('shower', 'hint.shower');
      break;
    }
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
      if (e.reason === 'searchlight') coachOnce('searchlight', 'hint.searchlight');
      break;
    }
    case 'caught':
      sound.thud();
      buzz('lockdown');
      itemsUI.closePanels();
      play.game?.pilot.stop();
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
      } else banner.toast(t('toast.shakedown', { cells: listOf(e.cells.map(String)) }), 'info', 4500);
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
      if (ownerOf(sim.world, e.container) < 0 && !seenTip('items')) {
        markTip('items');
        banner.toast(t('hint.items'), 'info', 5000);
      }
      break;
    case 'crafted':
      sound.craft();
      buzz('attended');
      itemsUI.toast(t('craft.made', { item: itemName(e.item) }));
      if (e.first) banner.toast(t('craft.newRecipe'), 'good');
      break;
    case 'cold':
      // The cold bites (P9, GDD §4.2): explained the first time in a game; after that the HUD's chip says it.
      if (e.on && !coldTold.has(sim)) {
        coldTold.add(sim);
        banner.toast(t('toast.coldOn'), 'bad', 6000);
      }
      if (e.on) buzz('missed');
      break;
    case 'tip': {
      // A recipe told (P8+): what it makes, from whom; the handbook has it now.
      const item = itemName(itemNumber(RECIPES[e.recipe].result));
      sound.chime();
      buzz('attended');
      itemsUI.markNewRecipe();
      banner.toast(e.who >= 0 ? t('toast.tipTalk', { who: inmateName(sim, e.who), item }) : t('toast.tipStudy', { item }), 'good', 5000);
      break;
    }
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
      const why = e.why === 'tired' ? 'toast.tired' : e.why === 'reinforced' ? 'toast.reinforced' : e.why === 'boulder' ? 'toast.boulder' : e.why === 'poster' ? 'toast.posterCell' : e.why === 'noRope' ? 'toast.noRope' : e.why === 'full' ? (e.action === 'eat' ? 'toast.notHungry' : 'toast.pocketsFull') : NEED[e.action];
      itemsUI.toast(t(why as Key));
      break;
    }
    case 'broke':
      sound.sting();
      itemsUI.toast(t('toast.broke', { item: itemName(e.item) }));
      break;
    case 'shocked':
      sound.zap();
      view.shock();
      buzz('lockdown');
      itemsUI.closePanels();
      play.game?.pilot.stop();
      banner.show(t('banner.shocked'), t('banner.shockedSub'), 'alarm', 3500);
      break;
    case 'blast':
      tools.release();
      sound.blast();
      buzz('lockdown');
      view.blast(e.tile);
      itemsUI.closePanels();
      play.game?.pilot.stop();
      banner.toast(t('toast.blast'), 'bad', 6000);
      break;
    case 'flood':
      // The sea pours into the tunnel (P12): the whole of it is lost.
      tools.release();
      sound.flood();
      buzz('lockdown');
      view.impact('dig', e.tile, LAYER.UNDER, true);
      itemsUI.closePanels();
      play.game?.pilot.stop();
      banner.toast(t('toast.flood'), 'bad', 6000);
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
      play.game?.pilot.stop();
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
    // 'escaped' is the session's: the step loop puts up the escape screen.
    // ---------------------------------------------------------------- security (GDD §5.4–5.6, §12)
    case 'power':
      if (!e.on) {
        sound.powerDown();
        buzz('giveWay');
        // Irongate's two generators (P12): the banner says which half went dead.
        const split = !!sim.world.def.grid;
        banner.show(t(split ? (e.gen === 1 ? 'banner.gen2Off' : 'banner.gen1Off') : 'banner.powerOff'), t(split ? (e.gen === 1 ? 'banner.gen2OffSub' : 'banner.gen1OffSub') : 'banner.powerOffSub'), 'routine', 3500);
        coachOnce('power', 'hint.power');
      } else {
        sound.powerUp();
        const split = !!sim.world.def.grid;
        banner.toast(t(e.by === 'guard' ? (split ? (e.gen === 1 ? 'toast.gen2Back' : 'toast.gen1Back') : 'toast.powerBack') : 'toast.powerOn'), e.by === 'guard' ? 'bad' : 'info');
      }
      break;
    case 'scanned':
      if (e.tripped) {
        sound.buzzer();
        view.tripArch();
        coachOnce('pouch', 'hint.pouch');
      } else {
        sound.blip();
        itemsUI.toast(t('toast.pouch', { n: Math.max(0, e.pouch) }));
      }
      break;
    case 'camera':
      if (e.blind) {
        sound.tape();
        itemsUI.toast(t('toast.taped'));
      } else banner.toast(t("toast.cameraBack"), "info");
      break;
    case 'aim': {
      sound.aim();
      buzz('missed');
      // In and out of a tower's reach: say it once in a while, not at every step back into it.
      const now = performance.now();
      if (now - lastAim > 8000) banner.toast(t('toast.sniperAim'), 'bad', 4000);
      lastAim = now;
      break;
    }
    case 'shot':
      sound.gunshot(e.hit);
      if (play.game) view.shot(e.tower, play.game.rec.sim.state.player.x / UNIT, play.game.rec.sim.state.player.z / UNIT, e.hit);
      buzz(e.hit ? 'lockdown' : 'strike');
      break;
    case 'takeover':
      if (e.on) {
        sound.takeover();
        buzz('lockdown');
        banner.show(t('banner.takeover'), t('banner.takeoverSub'), 'routine', 5000);
      } else banner.toast(t('toast.takeoverOver'), 'bad', 4500);
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
      if (!press.toolNow?.attack) tools.release();
      break;
    case 'koed': {
      // Knocked out by a thrown cup: the stars when it lands, not while it's in the air.
      const who = e.who;
      const g0 = play.game;
      const land = () => {
        if (play.game !== g0) return;
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
      play.game?.pilot.stop();
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
        play.game?.pilot.stop();
        coachOnce('train', TOUCH ? 'hint.trainTouch' : 'hint.trainKeys');
      }
      break;
    case 'sit':
      seenInteract();
      if (e.on) {
        sound.sit();
        play.game?.pilot.stop();
        if (e.use === 'rest') coachOnce('rest', 'hint.rest');
        else coachOnce('sit', 'hint.sit');
      }
      break;
    case 'meal':
      sound.eat();
      buzz('attended');
      floatAt(-1, t('float.meal', { n: MEAL_ENERGY }), 'gain');
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
        // A guard (P15): what talking to one is for.
        coachOnce(e.who >= sim.state.inmates.length ? 'guardTalk' : 'talk', e.who >= sim.state.inmates.length ? 'hint.guardTalk' : 'hint.talk');
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
      // A lawless prison (San Pancho): how scores are settled there, told once.
      if (sim.world.def.rules?.hostile) coachOnce('hostile', 'hint.hostile');
      break;
    case 'allyHit':
      sound.punch(e.ko, false);
      view.blow(e.by, e.who, e.ko);
      floatAt(e.who, `${e.dmg}`, 'ally');
      if (e.ko) floatAt(e.who, t('combat.ko'), 'ko');
      break;
    // Guard ways (P15): a bribe paid, a look away over (a guard dozing: the coach, see overlay).
    case 'bribe': {
      const name = guardSubject(sim, e.guard);
      if (e.kind === 'over') {
        sound.sting();
        banner.toast(t('toast.bribeOver', { name }), 'bad', 3500);
        break;
      }
      sound.buy();
      buzz('bell');
      floatAt(-1, `−$${e.price}`, 'cash');
      itemsUI.toast(e.kind === 'look' ? t('toast.bribeLook', { name, n: LOOK_AWAY_STEPS / STEPS_PER_MINUTE / 60 }) : t('toast.bribePaper', { n: PAPER_HEAT }));
      break;
    }
    case 'refused': {
      const now = performance.now();
      if (now - lastCant < 600) break;
      lastCant = now;
      sound.sting();
      itemsUI.toast(t(`refused.${e.why}` as Key, { n: BRIBE_REPORT_HEAT }));
      break;
    }
    // Noise and distractions (P14): a throw flies, lands with its clatter; a noise sends out its
    // wave and the guards sent to look get a "?"; a firecracker fizzes, then bangs; a clock rings.
    case 'tossed': {
      const flight = view.reducedMotion ? 0 : tossFlight(tilesTo(sim, e.to));
      lastFlight = flight;
      sound.whoosh();
      view.toss(e.item, e.to);
      const gain = gainAt(sim, e.to);
      setTimeout(() => sound.clatter(itemDef(e.item).thud ?? 0, gain), flight * 1000);
      if (e.item === FIRECRACKER) setTimeout(() => sound.fuse(gain), flight * 1000);
      if (e.hit >= 0) itemsUI.toast(t('toast.hitInmate', { name: inmateName(sim, e.hit) }));
      break;
    }
    case 'noise': {
      view.noise(e.kind, e.tile, e.reach, e.tiles, e.sent.length > 0, e.kind === 'thud' ? lastFlight : 0);
      if (e.sent.length) {
        aimUI.heard(e.sent.map((k) => sim.state.inmates.length + k));
        coachOnce('heard', 'hint.heard');
      }
      break;
    }
    case 'wound':
      sound.wind();
      itemsUI.toast(e.secs ? t('toast.wound', { n: e.secs }) : t('toast.clockStopped'));
      break;
    case 'bang': {
      const gain = gainAt(sim, e.tile);
      sound.bang(gain);
      view.bang(e.tile);
      if (gain > 0.5) buzz('giveWay');
      break;
    }
    case 'ringing':
      sound.ring(gainAt(sim, e.tile));
      break;
    case 'cantThrow': {
      const now = performance.now();
      if (now - lastCant < 600) break;
      lastCant = now;
      sound.sting();
      itemsUI.toast(t(`toss.${e.why}` as Key));
      break;
    }
  }
  if (e.type === 'pickup' && (e.item === DIRT || e.item === WALL_CHUNK)) coachOnce('evidence', 'hint.evidence');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How long the last thing thrown is in the air (s): its thud's wave waits for it to land. */
let lastFlight = 0;
/** How far a tile is from the player (tiles). */
function tilesTo(sim: Sim, tile: number): number {
  const p = sim.state.player;
  return Math.hypot((tile % 64) + 0.5 - p.x / UNIT, Math.floor(tile / 64) + 0.5 - p.z / UNIT);
}
/** How loud something at a tile sounds to the player: full close by, a whisper across the prison. */
const gainAt = (sim: Sim, tile: number) => Math.max(0.12, Math.min(1, 1.15 - tilesTo(sim, tile) / 16));

/** Once a second while it counts down: a wound alarm clock in the pockets ticks (never while time runs fast: asleep, out cold, fast-forward). */
export function tickTock(sim: Sim, speed: number) {
  const s = sim.state;
  if (speed !== 1 || s.step % STEPS_PER_SECOND !== 0) return;
  if (s.items.inv.some((v) => itemOf(v) === ALARM_CLOCK && clockSecs(v) > 0)) sound.clockTick();
}

/** When a cup was last thrown (real ms), and how long it's in the air (View's flight). */
let thrownAt = -1e9;
const THROW_FLIGHT_MS = 320;

/** A number (or word) floating up from someone (Cast id, -1 the player). */
const floatPoint = { x: 0, y: 0 };
function floatAt(id: number, text: string, kind: 'dealt' | 'taken' | 'ko' | 'cash' | 'gain' | 'ally') {
  const at = view.screenOf(id, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

/** When a refusal was last said, and the sniper's aim (real ms): repeats keep quiet for a while. */
let lastCant = 0;
let lastAim = -1e9;
