import { CHOCOLATE_ENERGY, UNIT } from '../sim/tuning';
import { freezing } from '../sim/systems/weather';
import { buzz } from '../app/haptics';
import { foodWords } from './vending';
import { itemDef, itemNumber } from '../content/items';
import { RECIPES } from '../content/recipes';
import { type Key, t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { itemOf, ownerOf } from '../sim/systems/items';
import { underMyDesk } from '../sim/systems/structure';
import { LAYER } from '../sim/world/World';
import { touchWords, h } from '../ui/dom';
import { itemName } from '../ui/items';
import { banner, itemsUI, ratPanel, phonePanel, crewPanel, settings, sound, tools, view } from './context';
import { play } from './game';
import { NEED } from './labels';
import { press } from './reach';
import { coachOnce, markTip, seenInteract, seenTip } from './tips';
import { today } from '../sim/systems/calendar';
import { dayTime } from './warden';
import { inmateName } from '../ui/names';
import { cant, nightTired } from './announceKit';

/** Games whose player has been told about the cold already (and the heat, P17). */
const coldTold = new WeakSet<object>();
const hotTold = new WeakSet<object>();

/** When the sniper's aim was last told (real ms): repeats keep quiet for a while. */
let lastAim = -1e9;

/** Things and the walls (out of announce.ts, v2.34.2): picking up, dropping, crafting, the cold and heat, strikes and tools, what gives way, power, cameras, the sniper, a takeover, locks. */
export function announceWorks(e: SimEvent, sim: Sim) {
  switch (e.type) {
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
      ratPanel.close();
      phonePanel.close();
      crewPanel.close();
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
      // (A heatwave's sun, P17: its own toast, once a game too.)
      if (e.on && !(e.hot ? hotTold : coldTold).has(sim)) {
        (e.hot ? hotTold : coldTold).add(sim);
        banner.toast(t(e.hot ? 'toast.hotOn' : 'toast.coldOn'), 'bad', 6000);
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
    case 'strike':
      sound.strike(e.action, e.broke);
      view.impact(e.action, e.tile, e.layer, e.broke);
      buzz(e.broke ? 'giveWay' : 'strike');
      // (2.36: the first time a tool is put to something it'll wear out before getting through: the work isn't lost.)
      if (!e.broke && press.toolNow?.short) coachOnce('toolShort', 'hint.toolShort');
      if (e.broke) {
        const done = (
          {
            chip: 'toast.wallGone',
            cut: 'toast.fenceGone',
            unscrew: 'toast.grateGone',
            dig: e.layer === LAYER.GROUND ? 'toast.shaftDone' : '',
          } as Record<string, string>
        )[e.action];
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
      if (now - cant.at < 1800) break;
      cant.at = now;
      sound.sting();
      const why =
        e.why === 'tired'
          ? nightTired(sim)
            ? 'toast.tiredNight'
            : 'toast.tired'
          : e.why === 'reinforced'
            ? 'toast.reinforced'
            : e.why === 'boulder'
              ? 'toast.boulder'
              : e.why === 'poster'
                ? 'toast.posterCell'
                : e.why === 'noRope'
                  ? 'toast.noRope'
                  : e.why === 'noScent'
                    ? 'toast.noScent'
                    : e.why === 'storm'
                      ? 'toast.glideStorm'
                      : e.why === 'runUp'
                        ? 'toast.glideRunUp'
                        : e.why === 'full'
                          ? e.action === 'eat'
                            ? itemDef(itemOf(sim.state.items.inv[sim.state.items.hand])).food?.health
                              ? 'toast.notHurt'
                              : 'toast.notHungry'
                            : 'toast.pocketsFull'
                          : NEED[e.action];
      itemsUI.toast(t(why as Key));
      break;
    }
    case 'broke':
      sound.sting();
      itemsUI.toast(t('toast.broke', { item: itemName(e.item) }));
      break;
    case 'worn':
      // (2.36: never broken unannounced.)
      sound.sting();
      itemsUI.toast(t('toast.worn', { item: itemName(e.item), n: e.left }));
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
      // (Off a roof on a glider, P24: its own sound.)
      if (e.how !== 'glide') sound.climb();
      play.game?.pilot.stop();
      itemsUI.closeCraft();
      // Into or out of the tunnels: a blink of dark while the view changes.
      if ((e.layer === LAYER.UNDER || e.from === LAYER.UNDER) && !settings.reducedMotion) {
        const fade = h('div', 'layer-fade');
        document.body.append(fade);
        fade.addEventListener('animationend', () => fade.remove());
      }
      if (e.layer === LAYER.UNDER) coachOnce('tunnel', touchWords() ? 'hint.tunnelTouch' : 'hint.tunnel');
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
      itemsUI.toast(itemDef(e.item).food ? foodWords(e.item) : t('toast.ate', { n: CHOCOLATE_ENERGY }));
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
      banner.toast(t(e.quick ? 'toast.quickFix' : 'toast.repaired'), 'info', 4500);
      break;
    // 'escaped' is the session's: the step loop puts up the escape screen.
    // ---------------------------------------------------------------- security (GDD §5.4–5.6, §12)
    case 'power':
      if (!e.on) {
        sound.powerDown();
        buzz('giveWay');
        // Irongate's two generators (P12): the banner says which half went dead.
        const split = !!sim.world.def.grid;
        // P17: lightning (both halves at once: one banner) or the generator's service.
        if (e.by === 'storm') {
          // (In the snow a blizzard takes the power: no lightning.)
          if (e.gen !== 1) banner.show(t(freezing(sim) ? 'banner.blizzard' : 'banner.storm'), t('banner.stormSub'), 'alarm', 3800);
        } else if (e.by === 'maintenance') {
          if (e.gen !== 1) banner.show(t('banner.service'), t('banner.serviceSub', { time: dayTime(today(sim).until) }), 'routine', 3800);
        } else
          banner.show(
            t(split ? (e.gen === 1 ? 'banner.gen2Off' : 'banner.gen1Off') : 'banner.powerOff'),
            t(split ? (e.gen === 1 ? 'banner.gen2OffSub' : 'banner.gen1OffSub') : 'banner.powerOffSub'),
            'routine',
            3500,
          );
        coachOnce('power', 'hint.power');
      } else {
        sound.powerUp();
        const split = !!sim.world.def.grid;
        banner.toast(
          t(e.by === 'guard' ? (split ? (e.gen === 1 ? 'toast.gen2Back' : 'toast.gen1Back') : 'toast.powerBack') : 'toast.powerOn'),
          e.by === 'guard' ? 'bad' : 'info',
        );
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
      } else banner.toast(t('toast.cameraBack'), 'info');
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
      // (2.35: told again, with the block: a new id, those who've played have seen the old hint.)
      if (e.who >= 0) coachOnce('fight235', touchWords() ? 'hint.fightTouch' : 'hint.fightKeys');
      break;
  }
}
