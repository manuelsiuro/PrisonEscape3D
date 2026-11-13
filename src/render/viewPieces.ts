import type { Pitch } from '../content/prisons/types';
import { handlersOf } from '../sim/systems/k9';
import type { World } from '../sim/world/World';
import { DayEvents } from './DayEvents';
import { Delivery } from './Delivery';
import { Dogs } from './Dog';
import { GamesView } from './Games';
import { GetawayView } from './Getaway';
import { GroundsView } from './Grounds';
import { HolidaysView } from './Holidays';
import { KioskView } from './Kiosk';
import { LongView } from './Long';
import { CoolerView, MenuBoardView } from './MenuBoard';
import { NightsView } from './Nights';
import { OddJobsView } from './OddJobs';
import { PastimesView } from './Pastimes';
import { PhoneView } from './Phone';
import { Rats } from './Rat';
import { ReleaseView } from './Release';
import { SmuggleView } from './Smuggling';
import { LEAVES, Snowfall } from './Snow';
import { PitchView } from './Pitch';
import { VendingView } from './Vending';
import { Weather } from './Weather';

// The day's pieces in the picture (out of View.ts, v2.34.2): each its own view, made here in the
// order View made them (the ids of what they build break the draw order's ties); View draws them.

export class DayPieces {
  readonly snow = new Snowfall();
  /** The forest's needles and leaves drifting down (2.36). */
  readonly leaves = new Snowfall(LEAVES);
  /** The day (P17): rain, ripples and fog; the movie screen, the food fight, the inspectors. */
  readonly weather = new Weather();
  readonly events = new DayEvents();
  /** P42: the holidays' decor, sprays and fireworks; the holiday behind the title (the date's, as Settings have it). */
  readonly holidaysView = new HolidaysView();
  /** Delivery day's vehicle (P18; Irongate's helicopter is the island's). */
  readonly delivery = new Delivery();
  /** The guard dogs, their kennels, the trail (P19). */
  readonly dogs = new Dogs();
  /** The rats (P20), and where the player's shoulder is this frame. */
  readonly rats = new Rats();
  /** Smuggling (P21): the drone, the drops' beacons, visiting day. */
  readonly smuggling = new SmuggleView();
  /** Bluff & glider (P24): the checkpoint's booth, the glide's preview and flight. */
  readonly getaway = new GetawayView();
  readonly gamesView = new GamesView();
  readonly pastimesView = new PastimesView();
  readonly longView = new LongView();
  readonly pitchView = new PitchView();
  /** P31: the sports ground's track and court paint, the garden's crops. */
  readonly groundsView = new GroundsView();
  readonly nightsView = new NightsView();
  /** P34: the pay phone, Lou's car, the diversion's beacon. */
  readonly phoneView = new PhoneView();
  /** P35: the internet kiosk on the library wall, the family's drawings over the player's bed. */
  readonly kioskView = new KioskView();
  /** 2.32: the vending machine's front. */
  readonly vendingView = new VendingView();
  /** 2.33: the menu board's face, the water cooler's bubbles. */
  readonly menuView = new MenuBoardView();
  readonly coolerView = new CoolerView();
  /** P40: the odd jobs board on the canteen wall. */
  readonly oddJobsView = new OddJobsView();
  /** P36: the release desk's sign, tray and lamp. */
  readonly releaseView = new ReleaseView();

  /** The effects compiled before they're needed (View.warmDay). */
  get warming() {
    return [this.weather, this.events, this.delivery, this.gamesView, this.pastimesView];
  }

  /** A prison's: its pieces, their last prison's parts freed after the next frame (`later`). */
  setWorld(world: World, pitch: Pitch | null, later: (dispose: () => void) => void) {
    this.events.setWorld(world, later);
    this.delivery.setWorld(world, later);
    this.gamesView.setWorld(world, later);
    this.pitchView.setWorld(pitch, world.def.theme ?? 'suburban', later);
    this.longView.setWorld(later);
    this.groundsView.setWorld(world, later);
    this.pastimesView.setWorld(world, pitch);
    this.getaway.setWorld(world);
    this.phoneView.setWorld(world, later);
    this.kioskView.setWorld(world, later);
    this.vendingView.setWorld(world, later);
    this.menuView.setWorld(world);
    this.coolerView.setWorld(world);
    this.oddJobsView.setWorld(world, later);
    this.releaseView.setWorld(world, later);
    this.holidaysView.setWorld(world, later);
    this.dogs.setDogs(
      handlersOf(world).map((h) => {
        const d = world.def.guards[h].dog!;
        return { x: d.kennel.x, z: d.kennel.z, face: d.kennel.face ?? 5, coat: d.coat };
      }),
    );
    this.weather.setWorld(world);
  }

  /** Behind the title: none of a game's pieces (nobody's rat, no drone, no dice, no match, no stage). */
  blank(dt: number) {
    this.rats.group.visible = false;
    this.smuggling.clear();
    this.getaway.clear();
    this.gamesView.update(null, 0, false, false);
    this.pastimesView.update(null, 0, 0, 0, false, false);
    this.longView.update(null, 0, false, false);
    this.pitchView.update(null, 0, false);
    this.nightsView.update(null, 0, false, false);
    this.phoneView.update(null, dt, 0, 0, false, 0, false);
    this.kioskView.update(null, 0, false, 0, 1, false);
    this.oddJobsView.update(null, false);
    this.releaseView.update(null, 0, false);
  }
}
